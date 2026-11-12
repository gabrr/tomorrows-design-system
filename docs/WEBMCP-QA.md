# WebMCP and visible QA

The app registers15 native tools at the root once, outside React render/effect lifecycles. It feature-detects document.modelContext and supports the older navigator.modelContext API where exposed. Registration failures roll back registered tools; page hide disposes registrations and a restored page registers again. Unsupported browsers show an honest status and retain normal UI operation. No runtime shim, hidden test bridge or global state-mutating test API is installed.

Authoritative references inspected 2026-11-11: [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), [WebMCP draft](https://webmachinelearning.github.io/webmcp/). This evolving draft is not claimed to be universally supported. In this session the in-app Chromium browser exposed **document.modelContext**, discovered all15 tools and executed the real tool callbacks.

## Commands and parity

- Inspect the current workspace, catalog search and pending-review token.
- Open existing panels/dialogs, select/add/duplicate/remove a canvas element.
- Prepare a complete architecture proposal, validate through /api/validate, display changes, explicitly apply or cancel the current review.
- Undo/redo, run the real local simulation, seek a retained timestamp, pin/release comparison and save locally.

Every mutation takes an expected identity/revision from a current inspection, validates runtime arguments, respects gesture/dialog guards and rejects overlapping agent mutations. Failures return an explicit error and fresh fence, never a success-shaped empty response. Duplicate/remove additionally require expectedSelection copied from inspection: selection can change without a project revision, so the revision fence alone cannot protect the target. Errors include the current selection. Bulk edits, connections and scenario changes use shared validated commands and one undo step. Direct multi-selection and connection handles are also implemented; see their separate interaction evidence.

The shared ArchitectureReviews service backs both the optional Review architecture JSON UI and the preparation/apply/cancel tools. The new review never applies, runs or saves implicitly. Undo increments the revision, so obsolete reviews cannot become valid again. Cancellation/supersession and aborted validation cannot publish a later applicable review. Pending reviews expose their IDs for mixed human/agent collaboration.

Tool results include current data/provenance and a visual-check reminder. Labels and configuration are explicitly untrusted content. No paid AI generation, pricing refresh, factory execution, saved-project deletion, arbitrary paths or arbitrary network fetches are exposed. The agent's existing authorization and privacy obligations still apply; tool availability is not permission to transmit user data.

## Visual checkpoints and actual evidence

Observed on disposable port8899 data in the controlled in-app browser:

1. Native tool discovery returned15 tools with schemas and read-only/untrusted annotations.
2. Tool preparation changed App A and B from100 to250 req/s in a visible review; underlying graph stayed at100. Human Apply committed both in one history step, leaving Balancer unchanged. Tool Undo restored both; a stale Add was explicitly rejected.
3. The real simulation tool produced1200 requests,1154 completed,45 failed,1 pending. Seeking25s visibly showed App A down and the selected timeline timestamp25.
4. Agent activity showed completed and failed operations, while the header preserved unsaved status. Visual inspection found clipped Table header/rows caused by inherited Card/Dialog edge bleed inside an overflow wrapper. Resetting the published container-padding variables at that wrapper fixed it; final table and wrapper top/height matched exactly, with a readable screenshot.
5. In the opposite direction, optional architecture JSON UI prepared a100->300 req/s edit for both servers. Native inspection found the pending review ID. WebMCP Apply committed it in one history step, and visible toolbar Undo restored100. Browser console had no captured errors/warnings at that check.
6. Native Add while a modal was open was rejected rather than bypassing the normal dialog boundary.

Screenshots: local-evidence-omitted and webmcp-agent-activity.png. Ten new automation tests exercise the actual Workspace/ArchitectureReviews modules, real Python topology validation/simulation, UI-command equivalence, stale/invalid requests, cancellation/supersession, aborted simulations, concurrent mutations, modal boundaries, registration rollback and bounded payload-free activity. Fake registries are used only in unit tests to test unavailable/failure handling, not as proof of browser support.

## Coordinator limits

Only the listed native tools/journeys were exercised end-to-end; the remaining tool behaviors have shared-command/unit coverage, not exhaustive browser coverage. Cross-browser WebMCP compatibility, assistive technology and physical trackpad/microphone behavior are not established. The user subsequently authorized scoped source/synthetic-screenshot sharing. Three independent standalone CLI reviews completed on 2026-11-12 and found defects; these are source/saved-image walkthroughs, not live browser tests. Repairs are under coordinator browser verification and need an incremental independent review. See docs/features/experience-findings.md for required unfinished manual interactions and the evidence/repair loop. Temporary QA tabs are closed after checks; the user-facing service remains available intentionally.

## Trusted check evidence

The full check completed109 Python tests, TypeScript, existing integrity/provenance/price/history checks and the frontend suites. The final frontend rerun passed7 review tests,10 automation tests and10 workspace tests after simulation AbortSignal handling was added. Log evidence is local-evidence-omitted CI now includes web/tests/webmcp.cjs for shared UI review/table geometry and optional native consumer APIs; that new Playwright script was syntax checked but not executed locally. Native in-app browser evidence above is the actual end-to-end run.

Aborting a simulation cancels the browser request and prevents a late result from attaching to the workspace. The stateless Python calculation may still finish server-side; this is not a promise to interrupt engine computation.
