# Independent QA / agent reliability review

**Disposition: acceptance remains open.** Frozen-artifact suite: **92 tests, 90 passed, 2 failed**, exit 1. No calibrated accuracy, live price correctness, or browser usability approval is claimed.

## Inspection identity and boundaries

Inspected 2026-11-11, approximately 14:09–14:20 UTC (11:09–11:20 São Paulo). HEAD: `468d1b5d22a2e769ee00e6b5c480201a0456a7ec`; implementation was predominantly untracked and workers changed it during review. HEAD does **not** identify the tested implementation.

To stop revision drift, copied actual source/tests at **14:18:42 UTC** to `[temporary-evidence-directory]`. Final full suite ran from this frozen copy; `inspection-manifest.json` contains per-file SHA-256 and `qa-test-output.txt` retains full stdout/stderr. These are temporary local evidence, not committed artifacts. Decisive results are reproduced below. Later shared-workspace changes need their own verification.

| Frozen file | SHA-256 |
| --- | --- |
| factory/autopilot.py | a3aad698d86f47cb0c811a9d467bf3d13721379690167ce976a670523bca493a |
| factory/core.py | 3240f6da98aa767ebe3cc61d97ca7dc4ac609fa6afd1c176c075ccea347ed0e5 |
| factory/planner.py | 97a1ab461804fceb5fea6d638c01ce6e33e3783543d78ff2101b772b0f17f990 |
| tds/server.py | 5f6ab76f54aa08fa812e9e3b39fcde6f94d7b5be2ac4a4868c1bd7c649ac1284 |
| tds/simulation.py | 8867a574172c6cdbab3530239ac266d6b35b76bb73487bcaf0321afb3ee1d746 |
| tds/calibration.py | 227a6a41789823bcdd4fe39843e4232a8c8cce1919f5671870d402d238c05efa |
| web/app.js | 860ead537fc102469d989a39ff1aec5a9a5b18ffafbb0edc25c6eab4580e8495 |
| tests/test_independent_qa.py | f1a3452b7760df696e9bdafcf8cc22149a8dd602a6f1cc0e2914787a75f0b030 |

Read AGENTS.md, PLAN, CONTRACT, ACCEPTANCE, QA and agent-reliability skills; inspected implementation, test bodies and actual screenshot, rather than worker summaries. Reviewer-authored repository writes are confined to this report and `tests/test_independent_qa.py`. No implementation/existing-test edits, user configuration changes, commits in the user repository, native subagents, external messages or cloud deployment. Existing factory tests and new probes create disposable Git fixture histories in temporary directories.

## Open prioritized findings

### P1 — Factory stdout/stderr can exhaust local disk

**Observed:** `factory/core.py:427–437` redirects child stdout/stderr directly to a regular file. The polling loop at `:462–467` bounds time and lease, but never bounds log bytes. `MAX_OUTPUT` is enforced on result JSON at `:506`, not execution logs. The same process runner serves workers, checks, planner and reviewer.

Regression `FactoryProbes.test_supervised_log_output_is_bounded` runs a short-lived child writing only 2 MiB + 1 byte; it returns successfully and retains all **2,097,153 bytes**, exceeding the probe's 2 MiB ceiling. A long-running noisy child can write far more before its timeout. No disk exhaustion was attempted.

**Fix:** define a retained-output budget, stream through a bounded reader/ring or truncate with an explicit evidence marker, and terminate/report overflow according to policy. Check short-lived children as well as the polling path. The probe uses the existing `MAX_OUTPUT` constant as a proposed ceiling; acceptance requires an explicit effective log budget, not that particular number. Links to F3/F4.

### P2 — Price application trusts a conflicting billing unit

**Observed:** `tds/server.py:189–201` checks currency but chooses applicability from numeric field names, without validating `record.unit`. A mocked cached record `{id:'qa', provider:'azure', hourly_cost:3, currency:'USD', unit:'GB-month'}` is applied with HTTP-equivalent **200**. The resulting project has `hourly_cost:3`; the simulator treats it as USD/hour although provenance still says GB-month. Regression: `IntegrationProbes.test_wrong_unit_price_is_not_applied_as_hourly` expects 400 and fails.

This is a malformed-cache/provider-boundary fixture, **not evidence that the live Azure adapter currently returns this conflicting combination**. The hourly adapter's normal unit filter does not make the apply boundary validate cached metadata.

**Fix:** validate normalized record schema, currency, dimensional unit and supported rate mapping before mutation; reject conflicts. Preserve provider/SKU/region/time and distinguish unsupported-unit records from applicable prices. Links to C1/C2 and wrong-unit acceptance.

### P2 — Users cannot complete pricing/calibration workflows through the UI

**Source-observed:** `web/app.js:60` offers refresh, source links and a price table, but no component selection or call to `/api/pricing/apply`. There is no calibration/observation workflow in the frontend. The backend endpoints and synthetic integration probes work for valid inputs, yet applying a published quote or importing measurements requires API calls or manual JSON editing. The screenshot shows only the initial architecture view; it does not prove these workflows.

**Fix:** add explicit component-targeted quote review/apply and measurement import/review/apply controls, show changed rates/units and evidence, invalidate prior runs, and offer rerun. If intentionally API-only, state that limitation in release scope; it does not close full product usability acceptance. Links to R5/U1/U5.

### P2 — Run completion can attach old results to a replacement workspace

**Derived from source, not browser-executed:** `web/app.js:47` captures a revision, awaits simulation, then always assigns `state.run`, `state.previous` and `state.runProject`. `loadProject` at `:20` resets run state, but provides no identity/generation fence. Reproduce by starting a long run for A, opening/new/importing B before completion, then receiving A's response. B's canvas is rendered using A's frames by node ID. A stale warning exists, but the old response still populates B's result/comparison state and overwrites its model label.

**Fix:** fence responses by workspace identity plus run generation; discard or retain a result in an explicitly named history entry when the workspace changed. Exercise this under delayed-response browser automation, including shared node IDs across presets. Links to U1 and stale-state acceptance.

### P2 — Imported result evidence can produce false confidence

**Source-observed:** `web/app.js:58` accepts a run when it merely has an array `frames` and truthy `summary`. It does not require nonempty/ordered frames, finite numeric summary, conservation, a supported format version, or a matching architecture snapshot. The file-controlled `results_stale` flag decides whether imported results are considered current. `:48` then formats imported metrics like ordinary engine results.

**Fix:** validate the bundle and result schema, preserve/import provenance as unverified external evidence, verify snapshot association, and avoid treating a supplied stale flag as proof of freshness. Add malformed/contradictory import browser fixtures. Links to U2/U5 and unsupported-claim acceptance.

### P2 — Planner can approve tasks that execution rejects

**Observed direct probe:** `validate_plan` (`factory/autopilot.py:17–62`) accepts a task with `id:'../invalid'`, `timeout:'forever'`, and `max_attempts:1000000` when the other required fields/scopes are valid. `Factory.add` later rejects these fields. `factory/planner.py:47–61` separately checks timeout but not ID/attempt bounds before recording an approved plan. Thus a model-produced plan can receive coordinator approval and fail during task registration, potentially after earlier tasks were registered. This does **not** bypass the execution validator or authorize arbitrary commands.

**Fix:** share complete task validation between planning and registration and preflight every task before persisting approval/partially registering a plan. Add invalid-plan cases and assert no partial approved/queued state. Links to F1/F4 and false-success review.

### P3 — AI review still requires reading an entire project JSON

**Source-observed:** `web/app.js:59` provides counts/warnings followed by full proposed project JSON. Counts cannot reveal a changed capacity, billing rate, async boundary or failure target; a large project burdens human review. Pricing and factory views were improved during inspection to tables/cards with optional raw details, so the earlier blanket JSON-overload concern is **resolved for those views**.

**Fix:** present a before/after change list with unit-bearing values, affected topology/events/cost assumptions and warnings; retain JSON as optional detail. Links to U5 and human-factors acceptance.

## Execution evidence

Environment: macOS Darwin arm64, Python **3.14.6**. No paid provider or live pricing refresh. New independent probes use seed **42**, a 5-second/2-rps fixture, temporary files and mock provider responses.

| Check | Observed result |
| --- | --- |
| Initial `python3 -m unittest discover -s tests -v` in restricted sandbox | 66 tests, exit 1: HTTP class setup could not bind loopback (`PermissionError`). This was an environment failure, not a product failure. |
| Existing services suite with loopback permission | 12 tests, all passed, exit 0. |
| Shared-workspace full suite during concurrent edits | 89 tests, 5 failures, exit 1, 64.845 s; included attempt cap, review crash, log bound, unit check, and an orphan-launch timeout. This is transitional evidence, not final revision acceptance. |
| Frozen copy: `python3 -m unittest discover -s tests -v > qa-test-output.txt 2>&1` | **92 tests, 2 failures, exit 1, 64.513 s.** Log bound and billing unit failures above; no errors/skips. All other 90 tests passed. |
| `node --check web/app.js` | Exit 0 (syntax only; no browser claim). |
| Existing backend `http://127.0.0.1:8765` | Health/catalog/presets/pricing/factory 200 with expected top-level shapes; traversal 404; hostile Host and cross-origin POST 403; malformed JSON and NaN 400. These probes did not save projects or refresh prices. |

Reproduce added probes with `python3 -m unittest discover -s tests -p test_independent_qa.py -v`. All 11 new tests remain ordinary assertions; failures are not skipped or marked expected to make acceptance green.

Decisive frozen failure output:

```text
FAIL: test_supervised_log_output_is_bounded
AssertionError: 2097153 not less than or equal to 2097152
FAIL: test_wrong_unit_price_is_not_applied_as_hourly
AssertionError: 200 != 400
Ran 92 tests in 64.513s
FAILED (failures=2)
```

Independent positive oracles: 10 foreground requests through 10 ms application + 5 ms edge + 25 ms database yield p95 40 ms; configured hourly rates 2+3 for five seconds yield experiment cost `25/3600` USD. Downstream fail/recover produces failures and resumed completions; each frame conserves foreground requests and edge transfers. Token fixture produces request charge $0.10 and token charge $0.006. Calibration train/holdout synthetic samples produce a simulatable proposal and 20 ms p50 while preserving metadata; this proves interoperability, **not real-world accuracy**. Nonfinite/deep metadata, boolean/string latencies and fractional concurrency are rejected.

## Resolved during inspection / remaining scope

Earlier observed pricing metadata and calibration metadata rejection, malformed nested API 500s, wrong-currency application, retry-cap overrun and review-commit crash loss were repaired by other workers. The frozen probes independently pass these paths. The frozen suite also passes orphan-worker and integration-supervisor recovery tests; the earlier shared-workspace launch timeout is not reproduced on that snapshot. Normal rejection/repair/dependency completion passes. No unresolved simulation count-conservation failure was found in exercised fixtures.

Opened `local-evidence-omitted` directly: initial failover architecture, events, units and illustrative/not-calibrated labels are visible. SHA-256: `7e03e6b1c672d3694f8c9f323129254c8dcc4a3d639023221b65511214671faa`. It contains no post-run interaction evidence. Computer-use inventory reported **“Local browser access is unavailable for this chat”**; no independent browser journey, assistive-technology check, responsive/zoom/contrast/reduced-motion measurement or import/race reproduction was performed. Coordinator browser QA is separate evidence and is not claimed here.

Live Codex planner/reviewer/worker operation, account-dependent pricing/quotas, pagination correctness across live providers, clean installed-package execution and empirical calibration remain unverified by this review. Frozen tests use mock worker/reviewer boundaries. Do not close U1–U5, C2/C3, Q2 or V1 solely from passing Python tests or the screenshot. Re-run affected regressions and exact-artifact integration checks after repairs; preserve these assertions and distinguish measured evidence from illustrative defaults.
