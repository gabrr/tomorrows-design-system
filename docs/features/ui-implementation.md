# Sample-aware readings repair · attempt 4

Worker `worker-time-system-interface`, 2026-11-11. Ready for independent review; **acceptance remains pending**. This focused repair retains the restored attempt 3 architecture tables, explicit time/step controls, connection hit target, import integrity, proposal workflows, themes and laptop layout. Only `web/` and this document were changed; no commits or backend changes.

## Correction

Result presentation now checks the relevant sample counts before formatting. Availability requires `summary.requests > 0`; p50/p95/p99 and the Horizon p95 stage require `summary.completed > 0`. Empty populations display **Unavailable** with a readable **No observations** reason. Availability remains 0% when requests exist but all fail or remain pending. Successful samples with actual zero latency retain **0 ms**. Each metric's comparison requires observations and a finite value in both runs; otherwise it explains why comparison is unavailable. Cost estimates retain their independent comparisons because they do not require successful request samples. Engine numbers, exported evidence and import-validation rules remain unchanged.

## Actual verification

Fresh backend from **this attempt 4 worktree**: `TDS_DATA_DIR=<new temporary directory> python3 -B -m tds --port 8943`, with `TDS_UI_URL=http://127.0.0.1:8943`. No previous-attempt port was reused. Initial sandbox bind/Chromium launch were denied; permitted local execution succeeded. The Chromium failure log is retained in `web/sample-browser-sandbox-evidence.txt`. Backend stopped after checks. No dependencies installed or live providers invoked.

- `python3 scripts/check.py`: **107 tests, 85.092 seconds, exit 0**; `web/sample-trusted-check-evidence.txt`.
- `node web/tests/sample-metrics.cjs`: **16 real engine/browser runs passed, exit 0**, Chromium **151.0.7922.34**. Four fixture families: successful service, all-failed, all-pending, successful zero latency. Each tests observed traffic, zero traffic, observed traffic following zero traffic, and a repeated observed run. Assertions verify exact displayed percentiles/availability, unavailable reasons, comparisons in both empty-population directions and valid 0 ms. No run response mocking or altered engine totals. `web/sample-browser-check-evidence.txt`, `web/evidence/sample-metrics.json`, and all sixteen `web/evidence/sample-*-run.json` files retain engine results/readings. Test development initially tried editing the hidden Scenario tab; the corrected test explicitly opens it. The failed navigation log is `web/sample-browser-iteration-evidence.txt`.
- Existing `web/tests/ui-verification.cjs`: **28 checks passed, exit 0**, same fresh backend/Chromium. `web/sample-regression-browser-evidence.txt`, `web/ui-evidence.json`. This includes **1360×768 and 1200×764** initial/post-run playback reachability, unobscured stepping/time/scrub controls, usable graph height, architecture telemetry tables, pricing/calibration review/apply, AI review, workspace fences, import labeling, themes and selected accessibility paths. `web/evidence/laptop-layout.json` records this backend identity and current geometry; laptop captures were refreshed.
- Integrity probes: **44 passed, exit 0**, `web/sample-integrity-check-evidence.txt`, `web/integrity-evidence.json`. Per-rate provenance: **3 engine-backed cases plus legacy fallback passed, exit 0**, `web/sample-rate-check-evidence.txt`, `web/evidence/rate-provenance.json`.
- Syntax and whitespace checks passed; `web/sample-final-check-evidence.txt`. `web/sample-evidence-manifest.json` records current source/test/evidence SHA-256 hashes and restored source identities. Prior review manifest/logs are retained as historical evidence, not current acceptance.

Visually inspected `web/evidence/sample-zero-traffic.png` and `web/evidence/sample-all-failed.png`: the result stage and percentile cards show unavailable readings/reasons, zero traffic has unavailable availability and comparisons, and all-failed availability is 0%. Additional all-pending/successful/zero-latency captures are regular files alongside these.

## Limits

Synthetic seeded workloads establish UI/engine integration, not production accuracy. Chromium only; no screen-reader audit, other browser engine, comprehensive accessibility certification, live pricing/AI generation or empirical calibration. Existing broader-workflow fixtures and limits remain as documented below. No self-approval; independent acceptance is required.

---

The following attempt 3 and attempt 2 reports are retained historical context. Their check counts, ports and hashes do not identify attempt 4.

# Independent-review repair handoff · attempt 3

Worker: `worker-time-system-interface`, 2026-11-11. Implementation is ready for independent review; **no self-approval or acceptance claim**. This repair changed only `web/` and this document. No commits, native subagents, external messages, deployment, credentials or user configuration changes.

## Four findings addressed

- Imported results reconcile all four final background counts against summary counts, enforce integer node/connection telemetry counters, reject decreasing cumulative background counts, and validate observed action types and their node/global targets. Existing matching-snapshot, finite-frame, conservation, external/unverified labeling and workspace fences remain intact. Actual synchronous and asynchronous seeded engine output is accepted; fabricated background totals, fractional counters and nonexistent event targets are rejected.
- Canvas panning excludes `.edge-hit` as well as `.edge` and nodes. A real pointer click outside the visible stroke but inside the expanded target now selects the connection and retains its inspector.
- Playback includes explicit Previous frame / Next frame buttons and a selected-time number input. Time entry resolves to the nearest actual retained timestamp, ties earlier; the resolved timestamp replaces the entered value. Stepping pauses playback. Range arrows step one frame, Home/End select boundaries, Page Up advances ten and Page Down goes back ten; accessible help documents these keys. Stepping controls remain available on mobile.
- The expandable **Architecture list & exact frame telemetry** provides native captioned tables, row/column headers, full component identities, connection endpoints, sync/async delivery, configured network latency/weight and selected-frame telemetry with units. Foreground totals and background job totals are separate. Values use retained precision; missing telemetry says Unavailable. Tables update with frame selection and identify stale/external evidence. Keyboard-operable row buttons select the same component/connection in the inspector. Bounded labeled horizontal scrollers retain readable tables on narrow screens.

The existing Acetate Time System adaptation, pricing/calibration review/apply, readable AI changes, semantic themes, editor/events, persistence, comparison and factory workflows were preserved. The prior design research and local references were reused as requested. Tables sit after the temporal dock and experiment detail; expanding them does not move the initial dock below the graph.

## Verification of this attempt

Fresh disposable backend from **this attempt 3 worktree**, port **8929**, temporary `TDS_DATA_DIR`; neither previous port 8771 nor reviewer port 8917 was used. Initial sandbox loopback bind was denied; the same local-server operation then ran with sandbox permission. No provider network refresh or CLI generation was requested. Backend stopped after verification.

- Required `python3 scripts/check.py`: **104 tests passed, 79.476 seconds, exit 0**; `web/review-trusted-check-evidence.txt`. Final `node --check web/app.js`, `node --check web/theme.js` and `git diff --check` also passed; `web/review-final-check-evidence.txt`.
- `node web/tests/integrity.cjs`: **44 checks passed, exit 0**, real seeded synchronous/async simulator output plus contradictory fixtures. `web/review-integrity-check-evidence.txt`, `web/integrity-evidence.json`. Includes irregular timestamp nearest-frame/tie checks and all newly reported evidence failures.
- `node web/tests/rate-provenance.cjs`: **3 engine-backed provenance cases passed, exit 0**, with legacy fallback assertion. `web/review-rate-check-evidence.txt`, `web/evidence/rate-provenance.json`. Published token prices do not certify an unchanged hourly estimate; manual changes remain estimates.
- Existing expanded Playwright script: **28 checks passed, exit 0**, Chromium **151.0.7922.34**, `TDS_UI_URL=http://127.0.0.1:8929`. `web/review-browser-check-evidence.txt`, `web/ui-evidence.json`. Actual edit/events/run/scrub/save/reopen/compare/import/calibration, synthetic pricing/AI review/apply, delayed workspace responses, themes and selected accessibility paths remain covered. New tests click the expanded connection hit stroke, enter/step time, compare table values with an exported actual run, select connections by keyboard and step on mobile. Native details-toggle and numeric-format assertions were corrected during test development; recorded in `web/review-iteration-evidence.txt`.
- **1360×768 and 1200×764**, initially and after run: all Restart/Play/Previous/Next/Scrub/Time-entry/Speed targets are unobscured without scrolling. Graph heights remain **267.6 / 263.6 px**; scrub bottoms **714.4 / 710.4 px**. `web/evidence/laptop-layout.json` records bounds and fresh server identity. Captures `web/evidence/laptop-{1360,1200}-{initial,results}.png` were refreshed from this attempt.
- Visually inspected `web/evidence/laptop-1360-results.png`, `web/evidence/review-mobile-time-controls.png` and `web/evidence/review-architecture-telemetry.png`. Current desktop/mobile themes, result and review captures were copied to regular files `web/evidence/review-*.png`. `web/review-evidence-manifest.json` identifies final implementation/test hashes and current evidence files. Older `visual-evidence.json` and prior repair logs are historical, not the current artifact identity.

Reproduce browser checks with an existing local Playwright module: `PLAYWRIGHT_MODULE=<installed-playwright-path> TDS_UI_URL=http://127.0.0.1:<fresh-port> node web/tests/ui-verification.cjs`. No dependencies were installed. The complete trusted-check output is retained; passing process exits do not imply independent acceptance.

## Limits

Only Chromium and selected keyboard, contrast, forced-colors, reduced-motion and responsive paths were exercised. No screen-reader audit, other browser engines, comprehensive WCAG conformance, live published-price verification, live AI provider, empirical production calibration or whole-system accuracy is claimed. Synthetic calibration demonstrates interoperability. Wide exact tables scroll horizontally; mobile workspace remains vertically scrollable. Large graphs still use pan/zoom. Independent acceptance remains required.

---

The following is the restored attempt 2 handoff, retained as historical context. Its ports, hashes and check counts must not be used as evidence of attempt 3.

# Time System interface implementation handoff

Worker: `worker-time-system-interface`. Repair of the restored partial implementation, 2026-11-11. **Independent acceptance is pending; this is not approval.** No commits, backend/test changes outside `web/`, cloud deployment, external messages or configuration changes were made by this worker.

## Implementation

The restored browser-ready vanilla JavaScript implementation adapts the overall Time System: semantic light/dark/system surfaces resolved before paint with storage-safe fallback; Ink primary actions, Horizon temporal readings, explicit status colors; Helvetica Neue/Arial dense interface and restrained editorial result typography; 10/16/22/26px geometry; component index, contextual inspector, segmented experiment tabs, solid review dialogs, readable tables, keyboard focus, 44px native controls, reduced motion/transparency and dismissible notices. The local Phosphor Regular icons retain `web/icons/PHOSPHOR-LICENSE.txt`. No Acetate logos or commercial font assets are included.

Design provenance is retained in `docs/UI-SYSTEM.md` and `docs/features/time-system-spec.md`, based on the actual local Acetate prototype CSS/HTML and brand/table references. This repair used that existing research rather than restarting it. Implementation evidence is distinct from a visual parity or accessibility certificate.

Pricing searches/filters the complete cached record list with real pagination and a target-node selector. Unsupported currency/units remain unavailable with a reason. `/api/pricing/apply` returns a proposal; the review lists exact rates, billing units, provenance and changes before a separate local Apply. Calibration accepts service measurement JSON, calls `/api/calibration`, shows per-target service means, heldout error, source and changed settings, then separately applies the reviewed proposal. Cancellation and obsolete-workspace fences preserve current work. AI status is readable, with grouped before/after changes and optional collapsed JSON.

Workspace identity, revision and request generations fence delayed operations. Imported results require ordered finite frames, matching architecture metadata, summary/telemetry types and request conservation. Valid imported runs remain external/unverified regardless of the file's stale flag; rejected evidence can be explicitly discarded through architecture-only import. Editor, events, simulation, playback, save/reopen, import/export, previous-run comparison and read-only factory workflows remain available.

## Focused repair

Playback now precedes scenario/results detail in DOM and visual order, so long detail cannot push pause or scrub below the graph. Laptop graph height responds to viewport height; pan controls use one row when space permits. A desktop notice floats over the library footer rather than resizing the graph or covering playback. Mobile retains its scrollable layout. Scenario/results details remain reachable below the dock; they are not permanently hidden. Inspector and component library retain independent scrolling.

At 1360×768 the actual graph canvas is 267.6px high and the scrubber ends at y=714.4. At 1200×764 these values are 263.6px and y=710.4. These readings hold initially and after a run with a visible notice. Tests check both viewport bounds and `elementFromPoint` for unobscured Restart, Play, Scrub and Speed. Screenshots were visually inspected at both laptop sizes; node labels keep their existing typography and pan/zoom remains available.

Cost provenance now uses optional engine `rate_sources`, `provenance_summary` and `defaulted_rates`. Each rate carries its own source classification and units. A token quote does not certify the illustrative hourly rate. Later manual changes display as estimates. Older results without per-rate metadata explicitly say verification is unavailable and rates are estimates; raw recorded metadata remains visible. Quote reviews also explain this boundary.

## Reproduction and actual evidence

Fresh disposable backend: `TDS_DATA_DIR=$(mktemp -d /tmp/tds-ui-attempt2.XXXXXX) python3 -m tds --port 8893`, started from this attempt worktree. Port 8771 was not used. The backend used installed repository code and temporary local data only; it was stopped after verification.

Browser command: `PLAYWRIGHT_MODULE=<existing-local-playwright-module> TDS_UI_URL=http://127.0.0.1:8893 node web/tests/ui-verification.cjs`. No browser/runtime dependency was installed. The existing regression script uses installed Playwright directly. Evidence:

- `web/repair-browser-check-evidence.txt` and `web/ui-evidence.json`: 24 passing checks including two semantic contrast reports; no page errors. Covers real edit/events/run/scrub/save/reopen/compare/import/calibration, mocked pricing/AI review/apply, delayed run/save/AI completions, stale proposal rejection, failed price refresh retention, theme/storage/keyboard/forced-colors/reflow and laptop bounds/occlusion.
- `web/evidence/laptop-layout.json`: measured rectangles, backend URL and viewport identities. `web/evidence/laptop-{1360,1200}-{initial,results}.png`: actual viewport captures.
- `web/repair-integrity-check-evidence.txt` and `web/integrity-evidence.json`: 28 passing boundary probes using actual seeded simulator output, including contradictory imports, conservation, metadata association, unit conflicts, measurements and workspace fences. Reproduce: `node web/tests/integrity.cjs`.
- `web/repair-rate-check-evidence.txt` and `web/evidence/rate-provenance.json`: three passing actual-engine source-classification cases, plus an older-result fallback assertion. Reproduce: `node web/tests/rate-provenance.cjs`.
- `web/visual-evidence.json`: final implementation hashes and preserved screenshot hashes/paths. Current desktop/mobile light/dark, review and accessibility-mode captures are regular files under `web/evidence/`; prior temporary captures are not needed to inspect this handoff.
- `web/repair-trusted-check-evidence.txt`: first trusted check attempted under the sandbox; 99 tests executed with one HTTP class-setup error because loopback bind was denied. This is retained as an environment failure, not a passing run.
- `web/repair-trusted-check-permitted-evidence.txt`: required `python3 scripts/check.py` rerun with loopback permission: **104 tests passed in 84.349 seconds, exit 0**; the script also completed its JavaScript syntax check.

## Limits

Browser verification uses Chromium and synthetic cached pricing/AI fixtures. No live pricing refresh, paid provider/account operation or real Codex generation was performed. Calibration uses synthetic service samples and establishes API interoperability only. Per-rate published classification reflects recorded metadata and matching values, not independent source verification. No empirical production fidelity, vendor calibration, whole-system accuracy or independent UI approval is claimed.

Checks cover selected real journeys and boundary fixtures, not every graph size, device, browser or accessibility technology. Forced-colors rendering, selected semantic contrast pairs and native control targets were exercised; no screen-reader audit or comprehensive WCAG certification was performed. Large graphs still require pan/zoom; laptop results/scenario detail scrolls below the always-reachable initial playback dock. Prior retained evidence files describe the previous attempt and must not substitute for the fresh repair files above.
