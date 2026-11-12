# Astryx migration — observed verification, 2026-11-11

## Implementation

The user-directed replacement uses actual published @astryxdesign/core and theme-neutral 0.7.13, React 19 and TypeScript. Upstream was inspected at commit 938558ab717d7a8188879074da0ea1ef304fc953 (its checkout declares 0.7.14; published dependencies are pinned separately). Reset/core/theme CSS is bundled locally. MIT license is shipped. Legacy app/style/canvas/theme runtime files were removed; wheel packaging includes only built assets, the domain icon and contract resource.

Standalone Codex CLI roles completed public-library research, public-requirements planning, the initial source architecture review, and AI/utilities implementation. Reports are local-evidence-omitted,planner,architecture}.md and local-evidence-omitted These are historical reports against the pre-migration tree where noted; old source links refer to commit 7a96e16. Coordinator implemented editor/results/shell and integrated the approved AI/utilities work. Architecture-review was added as a distinct factory role.

Automatic approval review blocked the original source-bearing planner request, two source-bearing implementation delegations, and the requested final source architecture acceptance. It cited unauthorized source disclosure to an external Codex process. The planner was subsequently completed with public upstream and user requirements only. Blocked implementation scope was completed locally by the coordinator. No bypass was attempted and no final independent architecture approval is claimed.

## Control inventory

| Surface | Actual Astryx components | Verification |
| --- | --- | --- |
| Project/actions | Card, TextInput, Button, IconButton | Rename/save/open browser journey; save ordering tests |
| Tools and rail | ToggleButton, IconButton, Tooltip | Persistent pressed semantics; undo and pan-menu browser checks |
| Library | Card, TextInput, Selector, Button, Badge | 150 entries, custom listbox/options, Escape, search/add/undo |
| Diagram nodes | ClickableCard | Stable keyed host IDs across frames; failure state at 25s |
| Graph links | Domain SVG hit geometry | Keyboard activation implemented; geometry is explicit domain exception |
| Inspector | TextInput, NumberInput, Switch, Collapsible | Newly added cache inspector; typed fields and units |
| Scenario | NumberInput, Selector, Switch, Card | Two-event draft cancellation preserves original timestamp |
| Playback | Card, Slider, Selector, NumberInput, IconButton | Real-engine run, seek25, play and frame selection |
| Results | Card, Text, Table, Collapsible, TextArea | Sample-aware results, empty sample reasons/deltas; collapsed raw JSON |
| AI composer/thread | Card, TextArea, Button, ToggleButton, Banner | Disabled empty submission and surfaces; request/dictation unit tests |
| Workspace menu | DropdownMenu, IconButton | Real menu/menuitem semantics and navigation |
| Utilities | Dialog/DialogHeader, Table, FileInput, Selector | Projects, settings, pricing empty state, calibration and factory |
| Reviews | Collapsible, Table, Banner, Button | Calibration real-backend review/cancel; proposal validation tests |
| Notices/validation | Banner; component status APIs | Save/run/import notices; contradictory evidence alert |
| Import bridge | Hidden platform file input | Explicit exception; real chooser export/import roundtrip |

App CSS owns layout and domain graph geometry/status, not a substitute control skin. No visible native select remains. Graph move previews and committed project revisions are separate. The pure result validator and bounded history are used directly by the new store and tests.

## Checks actually completed

- `python3 scripts/check.py`: 109 Python tests passed; TypeScript passed; 7 review/AI/quote/calibration/dictation tests and 10 workspace tests passed; all existing 44 integrity assertions, 3 provenance checks, tiny-price assertions and 8 history checks passed; production build succeeded. The first sandboxed attempt could not bind the HTTP test port; the authorized loopback-capable rerun passed. Subsequent frontend changes were typechecked, rebuilt and reran the actual domain/workspace checks.
- Clean 0.4.0 wheel built and installed into an isolated target; verified bundle/license contents and exclusion of tooling, source, legacy runtime and QA evidence. Actual installed HTTP server served JS/CSS/icon/favicon/license and completed a simulation with **no Node on PATH**. Temporary server shut down in finally.
- In-app Chromium browser against disposable port8899 data: custom selector/listbox/options and keyboard dismissal; search/cache add, inspector and undo; two-event scenario draft cancellation; real60s failover run; seek25 showed App A down and traffic20 req/s routed to App B; play and retained frame selection; selected tool states; stable Run and node host IDs across frame updates; observed pointer cursor on Run host and child after async updates; project rename/save/open; workspace menu; light/dark appearance; pan menu; real-backend synthetic calibration source/5+5 partition/20ms mean/0ms heldout error review/cancel; honest empty pricing state; readonly factory; export/import; explicit unverified external label; contradictory count evidence rejected with recovery choices. A second real engine run at0rps displayed unavailable availability/latencies and unavailable comparisons, not fabricated zero values. Browser console had no captured errors/warnings at the final check.
- Screenshots inspected: local-evidence-omitted, astryx-final-results.png, astryx-final-dark.png. Earlier migration captures are retained separately. No screen-reader or physical microphone test is implied.

## Coverage and limits

The old0.3 DOM-ID browser scripts are retained under web/tests/legacy as historical coverage references, not silently presented as current runs. Current ui-verification.cjs ports primary control/desktop/roundtrip/calibration journeys. sample-metrics.cjs preserves the sixteen real-engine successful/failed/pending/zero-latency and empty/repeated comparison cases with new selectors. Asynchronous save/run/import/review fences now test the actual Workspace implementation in frontend/tests/workspace.test.ts and features/utilities/review.test.mjs, instead of reaching into a legacy global.

Updated CI installs locked frontend dependencies, builds, then runs current browser suites against disposable data. Those **new CI Playwright scripts have syntax checks but have not been executed locally or in hosted CI in this session**; local browser evidence above comes from the controlled in-app browser. The full sixteen-case new browser suite, hosted matrix, broad cursor paths, cross-browser/assistive technology behavior and physical speech service remain unverified. No final independent architecture acceptance was obtained. This is a completed implementation migration with bounded verification, not a claim of perfect UX or production simulation accuracy.

Temporary app/browser/worker processes created for verification are stopped before handoff; unrelated local services are preserved.
