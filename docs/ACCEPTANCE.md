# Acceptance checks and evidence status

Snapshot: 2026-11-11. This is a check specification and research-owned evidence ledger, not a release approval. Baseline read of AGENTS.md, PLAN.md and CONTRACT.md found contracts/prompts but no implementation or tests in the inspected tracked/untracked file listing. Other workers may add files concurrently; their existence or completion is not asserted here. Runtime requirements below are **open / unimplemented in the inspected baseline**, pending coordinator integration and evidence in docs/VERIFICATION.md. No requirement is silently removed or newly deferred by this assignment.

Statuses: **done** requires observed evidence; **open** means required but unverified; **blocked validation** identifies a check attempted unsuccessfully. A future deferral must name its owner, reason and remaining acceptance; it is not a pass. Each runtime check must preserve revision, command/environment, fixture/seed, actual outcome, exit/test count and artifact path. Reviewer must inspect that exact artifact/revision; worker self-report is insufficient.

## Research-owned deliverables

| ID | Requirement and check | Status / evidence |
| --- | --- | --- |
| R1-DOC | Read project contracts and requested skill-creator; check ownership and source boundaries. | Done: source files read in this assignment; writes confined to skills/* and these two documents. |
| R1-SKILLS | Twelve requested role directories, each with name/description frontmatter, bounded context, project guidance and primary links; inspect every body for scope and misleading claims. | Done: twelve SKILL.md files created and manually reviewed. Executed dependency-free structural/reference check passed for all twelve (12 expected names; 143–218 body words each; relative references resolved). Behavior has not been independently forward-tested. |
| R1-VALIDATE | Run bundled quick_validate.py for each skill with a Python interpreter containing PyYAML. | Resolved by coordinator: all twelve skills passed the bundled quick_validate.py using PyYAML 6.0.3 in a disposable virtual environment; local-evidence-omitted records results. The earlier system-Python attempt lacked yaml; no global installation was needed. |
| R1-RESEARCH | Open primary documents and distinguish fetched documentation from live API tests, proposed tooling and measured findings. | Done: RESEARCH.md records 19 successfully fetched primary sources and failed-path replacements. No live price endpoint, paid API, calibration or Codex worker execution claimed. |
| R1-ACCEPT | Map all milestones and contract behaviors to executable/manual checks without claiming implementation completion. | Done as specification below. Runtime acceptance remains open. |

Bundled validation command (requires PyYAML; `set -e` prevents a later pass hiding an earlier failure):

```sh
set -e
for skill in skills/*; do
  python3 [installed-skills]/.system/skill-creator/scripts/quick_validate.py "$skill"
done
```

The dependency-free check performed here parses the simple two-field frontmatter, verifies folder/name agreement and nonempty descriptions, checks all twelve expected names, rejects scaffold placeholders, verifies relative Markdown references resolve, and confirms bounded body size. It is a structural fallback only; it does not prove YAML compatibility, link availability, skill behavior or product acceptance.

## Runtime requirement matrix

All rows below are **open**. Commands are target invocations, not recorded passing runs. Tests named by the contract may be absent until their owning workers deliver them.

| ID / milestone | Required executable or manual check | Pass condition / evidence to retain |
| --- | --- | --- |
| F1 / R2 | `python3 -m unittest discover -s tests -p 'test_factory.py' -v`; inspect cases, not just exit. | Durable tasks include IDs/dependencies/acceptance/scope/context/leases/heartbeats/attempts/timeouts/evidence; invalid transitions rejected. Positive test count and output required. |
| F2 / R2 | Fake-adapter fault injection: kill supervisor/worker between lease, spawn, output and integration; restart persisted state. | No lost accepted result, stale completion acceptance or unmanaged duplicate worker; orphan handling and bounded retry observed. |
| F3 / R2 | Inject malformed/truncated JSONL, no final artifact, nonzero exit, hanging child, log flood, expired lease and repeated result. | Each becomes an explicit bounded state; timeout/cancel cleans descendants; duplicate results idempotent; evidence retained. |
| F4 / R2 | Exercise pause/cancel/resume, dependency failure, resource/context/attempt limits and explicit session resume. | No new dispatch while paused; cancel terminates work; restart preserves state and budgets. Context-version mismatch rejected. |
| F5 / R2,R6 | Inspect adapter invocation and actual worker diff/worktree; attempt forbidden-path edit; independent review then sequential integration. | Standalone CLI only, replaceable adapter, assigned scope enforced, no self-approval; trusted checks gate exact integrated artifact. No test weakening. |
| S1 / R3 | `python3 -m unittest discover -s tests -p 'test_simulation.py' -v`; repeat fixed fixture/seed/model. | Reproducible output, stable ties/horizon, finite bounded work; seed/model present. No claim of calibration from repetition. |
| S2 / R3 | Hand-oracle idle/single-server/overload/finite-queue/failure-recovery/branch/cache-miss/async fixtures. | Counts reconcile; latency/availability/queue semantics match declared model; foreground completion distinct from background jobs. Evidence includes expected calculation. |
| S3 / R3 | Timestamp, sampled window and metric triggers; simultaneous fail/recover, traffic/latency/scale and invalid target. | Deterministic documented trigger frequency and ordering; all five event types affect engine state; unsupported cases rejected. |
| S4 / R3 | Validate malformed fields, cycles/unsupported topology, dangling/duplicate IDs, negative/nonfinite values, impossible budgets and unknown behavior. | Errors are actionable; no invented realism, infinite event loop or process exhaustion. |
| S5 / R3 | Compare every frame’s component/edge flows and event state against summary and raw event trace. | Monotone simulated time, count conservation and consistent engine source. Approximately one frame/second; no playback-driven model changes. |
| C1 / R3,R5 | Offline synthetic rate: hourly r, duration 3600 s, monthly hours 730; also missing rate, currency mismatch and zero duration. | Experiment infrastructure charge r and monthly charge 730*r under declared assumptions; unknown distinct from zero; exclusions visible. |
| C2 / R5 | Fixture tests per AWS/GCP/Azure and OpenAI/Anthropic/Google/OpenRouter adapter or manual snapshot path. Inject pagination, malformed schema, unit mismatch, timeout and stale cache. | Exact SKU/model/region/unit/term/source/time retained; overrides auditable; failed refresh preserves last good record. Unsupported providers visibly open, not claimed live. |
| C3 / R5 | Optional explicit live refresh smoke check through POST /api/pricing/refresh using permitted existing access. | Record actual endpoint, date and parsed snapshot; docs fetch alone insufficient. No credential changes; unavailable access reported. Live pricing not required for offline core operation. |
| U1 / R4 | Browser: create/add/move/connect/configure/delete nodes; edit workload/events; run, inspect, scrub/play/pause and compare. | Entire user task works; graph and metrics match API result; playback speed does not affect results; stale responses cannot overwrite newer run. |
| U2 / R4 | Save, reload page, list/reopen/update/delete project; export/import comparison snapshots. | Architecture, seed, scenario, monthly assumptions and compared result provenance survive; malformed import rejected; prior comparison retained. |
| U3 / R4,R6 | Keyboard-only and single-pointer alternatives to dragging; focus, modal Escape/return, errors/status announcements, text/color states; contrast measurements. | Relevant WCAG 2.2 AA checks pass with recorded browser/assistive-tech details. Canvas has an operable accessible alternative. Automated scan alone insufficient. |
| U4 / R4,R6 | Narrow viewport, 200% zoom, touch/coarse pointer, reduced-motion preference, mid-animation interruption and playback pause. | Controls remain reachable; feedback persists without continuous motion; simulation state unchanged; animations do not block actions. |
| U5 / R4,R6 | Independent comprehension review on rendered UI with estimated/unknown/stale costs, pending jobs and worker review states. | Reviewer can identify assumptions, units, simulation time and accepted versus completed status; misleading precision corrected. Screenshots and findings retained. |
| B1 / R4,R6 | Start `python3 -m tds`; query /api/catalog, /api/presets, /api/projects, /api/pricing, /api/ai and /api/factory; validate/simulate a preset. | Contract response shapes/units, broad catalog categories with model limitations, localhost:8765 and web/ served with no required build. Factory empty state graceful. |
| B2 / R4,R6 | Invalid JSON/oversized body/wrong methods/path traversal/cross-origin writes/Host checks; interrupted project save. | Predictable JSON errors, validation 400, no arbitrary file/command access, local writes protected and previous project survives failed atomic save. |
| A1 / R5 | POST /api/ai/generate with successful, unavailable, malformed and invalid-topology adapter fixtures. | Valid proposal/explanation/warnings; never implicitly applied/executed; missing provider/access honest; existing project unchanged until explicit apply. |
| Q1 / R6 | `python3 -m unittest discover -s tests -v` on integrated revision; review test discovery count and requirement coverage. | Meaningful independent oracles, no skips/threshold reductions hiding gaps; all failures preserved. Passing subsets do not close unrelated rows. |
| Q2 / R6 | Clean local install/run using release instructions and optional providers unavailable; run simulator, persistence and factory entrypoints. | Reproducible instructions, platform/Python recorded, no required paid dependency; factory dashboard reflects actual state. No cloud deployment. |
| Q3 / R6 | Independent exact-artifact review plus license/dependency/secret/runtime-artifact inspection. | Actual diff/code/UI reviewed, evidence linked in VERIFICATION.md, unsupported features and unresolved findings explicit. |
| V1 / model fidelity | Measurement calibration protocol in RESEARCH.md: recorded trace, fit/holdout, errors/tolerances, uncertainty and applicability. | No accuracy claim until measurements support it. Open; no calibration dataset/result provided. Catalog breadth cannot close this row. |

No runtime row is marked done from another worker’s progress or inferred file presence. Coordinator owns final integrated evidence and any explicit deferral decision.
