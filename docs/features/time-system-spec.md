# Tomorrow’s · Time System adaptation specification

Status: design requirements for implementation and independent review; no implementation, visual parity, accessibility conformance or calibrated accuracy is asserted here.

## Authority and adaptation boundary

Follow [UI-SYSTEM.md](../UI-SYSTEM.md), [CONTRACT.md](../CONTRACT.md) and [PLAN.md](../PLAN.md). Reference sources read: `[local-design-reference]/prototypes/ui-language/index.html`, its `styles.css`, and `[local-design-reference]/brand/table-design.md`. These are local design provenance, not runtime dependencies. The retained prototype is a light financial-planning interface library; adapt its composed behavior to architecture experiments, rather than reproducing its financial content or showcase page.

Source baseline: `web/index.html`, `web/style.css`, `web/app.js`. Preserve the component catalog/search, presets, graph editing, inspector, scenario/events, simulation, playback, previous-run comparison, projects/save/import/export, pricing, AI and read-only factory status. Current sources use the earlier green palette, small dense type, a three-column workspace and modal workflows. Pricing exposes cached records/refresh without quote application; calibration has no UI; AI review shows counts and project JSON. These observations describe source, not rendered usability. [QA-REVIEW.md](../QA-REVIEW.md) supplies historical findings and required integrity cases; it is not a current acceptance certificate.

Keep Tomorrow’s name and existing mark. Do not copy Acetate logos, financial scenarios, account/profile navigation, celebration machinery or font files. Use dependency-light native controls and local assets; the reference’s Three.js demo and table guide’s Mantine instruction belong to Acetate, not this application.

## Foundations, geometry and surfaces

| Role | Light theme / adaptation rule |
| --- | --- |
| Workspace canvas | White `#ffffff`; optional quiet graph grid using soft rules, never a green wash |
| Grouped pane / selection | `#f7f7f5` / `#f0f3f3`; selected controls also have a border or indicator |
| Text | Ink `#101010`, Graphite `#212626`, muted `#646866`; essential text must remain readable |
| Boundaries | Rule `#d8d8d2`, soft rule `#ecece8`; one intentional enclosing boundary, quiet horizontal separators |
| Primary action | Ink with white text; one primary action per decision area |
| Interactive reading / planned path | Horizon `#2f6f7e`, deep `#174b59`; comparison cursor, selected time and planned flow |
| Warning / alternative | Antique `#8a642f`; state explicitly whether the signal means warning or comparison alternative |
| Success / failure | Evergreen `#596b5b` / Oxblood `#8b4a46`; always pair with text/glyph |
| Radius | Controls 10px, panes/nodes 16px, task layers 22px, priority result stage 26px; circles only for appropriate markers/thumbs |

Use spacing steps 4, 8, 12, 16, 24, 32px as adaptation starting values. Prefer 16px pane padding, 12–16px table cells and 8px control gaps; let labels/content grow. Keep useful graph area before adding whitespace. Do not import the prototype’s 690px hero, 520px stage minimum, large section spacing or display-sized headings into the workspace.

Use `"Helvetica Neue", Arial, sans-serif` for interface text, retaining the reference’s sans hierarchy without commercial Söhne. Use `"Iowan Old Style", Baskerville, Georgia, serif` only for an optional temporal interpretation or editorial statement. No Tiempos dependency. Start body/controls at 14px with 20px line height, secondary labels at 12–13px, panel headings at 16–18px and workspace title at 20–24px; essential information must not shrink to the current 8–10px labels. Use medium primary identifiers, regular secondary text, restrained uppercase eyebrows, tabular numerals and monospace only for IDs/code. Large result values may be 32–48px, with visible units.

Use Phosphor Regular icons at 20px, 24px for primary/mobile controls, with retained MIT attribution if assets are introduced. Keep text names for consequential actions; icon-only controls require accessible names. Interactive targets are at least 44×44px even where the reference uses smaller compact buttons, sliders or badges.

Map the reference’s surfaces deliberately:

- Canvas: architecture work area; pane: catalog, inspector, scenario and tables. Nodes are coherent panes, not promotional cards.
- Compact glass: optional persistent product navigation only; ensure legibility over the graph and provide an opaque fallback. Data, forms and review layers stay solid. Shadows indicate elevated layers, not every row/node.
- Horizon Stage: at most one consequential result, such as selected simulated p95 or monthly estimate. Use opaque Ink, quiet label, dominant value, concise interpretation and footer with model/seed/assumptions. It must say “Simulated” or “Estimate” as applicable. Other metrics remain on ordinary surfaces; do not make navigation or forms black stages.

## Navigation and architecture workflow

One product bar contains Tomorrow’s identity, editable project name/save state, Projects, Save and the primary Run simulation action. Put AI, Pricing, Measurements, Import, Export, Factory and Appearance in visible secondary actions or a labeled workspace menu when space is limited. Preserve every route; do not invent multi-user account controls. The current second action strip may become this quiet utility group, not another primary navigation hierarchy.

The catalog is the local index: searchable, categorized component buttons with count and no-match recovery. Keep the graph central, inspector contextual, and Scenario / Results & comparison as segmented local tabs. Tabs expose selected state and corresponding panels. Selecting a node/connection preserves pan, zoom and selected time; opening a review preserves the workspace underneath.

Maintain the complete journey: choose preset or add components → connect source/target → configure component/edge/workload → edit events → Run → inspect selected frame → compare → save/export. Configuration retains capacity, concurrency, queue limit, service/network latency, provider/region, pricing, monthly hours/traffic multiplier and advanced parameters. Show catalog model limitations beside relevant configuration. Preserve async delivery, routing weights and branch behavior in human-readable summaries.

Graph selection uses a visible border/focus indicator, with labeled state, utilization and queue depth. Failures use Oxblood plus a failure label; missing telemetry reads “Unavailable,” not zero. Planned connections, active traffic and failed components have separate labeled meanings. Provide a component/connection list and telemetry table equivalent to the canvas, including endpoints, async state and units. Keep full long labels available without requiring hover.

## Controls, layers and feedback

Black primary: Run simulation, or Apply within a review. Bordered secondary: Save/Review/Retry. Pane-filled tertiary: Fit view/step time. Ghost: Cancel/Close. Destructive: Delete with named consequence. Every control defines hover, pressed, focus-visible, selected where relevant, disabled with reason, and busy with operation text; busy must not look like completed success. Preserve form width while labels change.

Labels, value, unit, help and errors stay together. Use native numeric/select/checkbox controls; a switch is only for an immediate binary setting with an accessible checked state and adequate hit area. Validation identifies the field and correction using text, `aria-invalid` and associated help. Keep entered values on failure; focus the first invalid field after submission. Advanced JSON stays optional; ordinary review never depends on reading it.

Use panels for expanding tasks and modals for contained decisions. Layers follow the reference order: base 0, sticky 20, menu/popover 40, tooltip 50, toast 70, panel 80, modal 90. Follow UI-SYSTEM’s override of the prototype’s translucent dialogs: solid modal, 40% Ink dimming, no backdrop blur. Limit height to the viewport, scroll content, keep title/close/actions reachable and clear of safe-area insets. Modal focus enters, stays contained, closes with Escape/Cancel and returns to its trigger or a logical surviving control. Cancel must leave the project unchanged. Explain unsaved review edits before discarding them.

Use one polite dismissible toast for completed operations, without moving focus. Persistent validation, staleness, missing source and failure messages stay beside the affected region. Tooltips work on focus/hover and dismiss with Escape; essential assumptions belong inline or in labeled details/popovers. Do not announce every playback tick. Routine simulation completion needs no animated celebration or pulsing texture.

## Timeline, scrubber and exact readings

Adapt the reference’s active horizon to **Selected simulated time: 15.0 / 60 s**. Keep it beside a central range scrubber, Previous frame / Next frame, Restart, Play/Pause and separately labeled Playback speed (0.5×, 1×, 2×, 4×). Scrubbing pauses playback and updates the graph, inspector and exact frame table from the same retained frame. Use actual frame timestamps, not an assumed one-second interval or frame index presented as seconds. Replay and speed never recompute simulation results or change seed/events.

Keep elapsed track/progress in Horizon, with a visible thumb and 44px interaction region. Arrow keys move one retained frame, Home/End move to first/last, and Page Up/Down move a documented larger step. Expose the actual timestamp through the range’s accessible value text. Provide direct selected-time input that resolves to the nearest retained frame and displays the resolved timestamp. Keep explicit step controls on mobile.

Event markers open the corresponding event review. Prevent overlapping labels by stacking/grouping with an event list; never drop events on mobile. Distinguish scheduled exact timestamps, seeded sampling windows and metric-trigger definitions. A trigger has no guaranteed firing timestamp: show its condition until observed, then the engine-reported event time. Editing keeps action, target, time/window/condition, threshold and value with correct units; Save scenario applies the draft, Cancel discards it. Fail/recover do not require meaningless values. Scale values use the selected parameter’s unit, not always req/s.

Expose requests, completed, failed, foreground pending/in flight and background jobs separately. Show simulated availability as percent, latency percentiles in ms, experiment cost in USD and monthly estimate with operating hours/traffic multiplier. Label missing values “Unknown” or “Unavailable”; never coerce them to zero or append units to an ambiguous dash. Round display only; exact detail/export preserves returned precision. No uncertainty band or accuracy percentage without supporting evidence.

## Data, tables and comparison

Use one shared grid for header/body, identity anchored left, stable numeric columns and a fixed 48–64px action lane. For Tomorrow’s cost/comparison tables, align numeric values and their headings right as in the Time System exact-reading table; price identity/provider/source remain left. Use native captions, column/row headers and quiet horizontal rules. Two-line records start around 64–72px with 12px vertical/12–16px horizontal padding; allow wrapping/growth. Badges may be about 24px high but actions retain 44px targets. No full-row status wash, hover-only actions or animated row geometry.

Pricing tables expose real search/provider filters with matching counts and clear controls; no fake sort/pagination. If records are limited, disclose the limit and offer a usable way to inspect the remainder. Keep a stable header inside a bounded scroller and ensure its last row is reachable. Mobile may reflow records into labeled groups with actions beside identity; exact comparison tables may scroll horizontally in a labeled region. Never shrink columns until essential values become unreadable.

Distinguish initial loading, refresh over retained data, first-use empty, no matches, per-record rejection, local-server failure, provider/network offline and missing permission/capability. Keep cached records with their age and failure reason; refresh preserves filters, scroll, drafts and selection. Recovery buttons name the actual action, e.g. Retry pricing or Clear provider filter.

Comparison shows current/previous run identities, model versions, seeds, architecture snapshots, workloads, duration and cost assumptions. List changed assumptions before interpreting deltas; label availability differences in percentage points, latency in ms and costs in USD. A lower simulated latency is not proof of production improvement. Preserve original evidence and identify stale/unverified runs rather than silently treating them as a comparable baseline.

## Pricing quote: review then apply

1. Open Pricing sources or the selected component’s Review price action. Select the target by name and ID, provider and model/SKU/region. Search actual cached records; refresh is separate from application and reports partial catalogs, source failures and retrieval time.
2. Review a readable quote: existing → proposed rates, exact USD billing unit, input/output token rates separately, hourly/request mappings where supported, source URL/provider/SKU/region/retrieved time and warnings. Explain monthly hours, traffic/token assumptions and which fields will change. Do not imply a cost prediction was computed when only a rate was quoted.
3. Use `/api/pricing/apply` with the captured project, node ID, provider and record ID as the proposal boundary defined in CONTRACT. Receiving its returned project is not user approval. Validate it and show the reviewed diff before explicit **Apply price to [component]** updates local state.
4. Block unsupported/missing currency, conflicting dimensional units, malformed records and missing targets, with a visible reason. A numeric `hourly_cost` attached to “GB-month” must not become USD/hour. Generic cloud prices with no explicit supported mapping remain inspectable, not automatically applicable. Preserve exact provenance and units; source presence does not establish live correctness.
5. Apply only to the unchanged reviewed workspace/quote. Mark prior results stale, retain them as evidence and offer Run again. Cancel or failed validation leaves existing rates intact. Manual/account overrides remain explicitly identified estimates/overrides; refresh does not silently overwrite them.

## Measurement import and calibration: review then apply

Provide Measurements from the workspace and selected component. Explain the input before file selection: CONTRACT’s measurement JSON, mapped node ID, source, optional measured-at and explicitly measured capacity, and at least ten finite service-time samples in ms per record. Service time excludes network and queue time. Show parse/size/schema errors and unknown targets without mutating the project; preserve usable input for correction. Do not promise CSV or tracing integrations absent a defined contract.

Submit the captured project and validated measurements to `/api/calibration`. Review each target’s source/date, sample count, current → proposed service latency/capacity, returned service mean, holdout mean absolute error in ms and all warnings. If train/holdout details are not returned, say “Not supplied”; never invent a confidence score. Capacity changes require explicit measured capacity and are never inferred from latency. Optional observation comparison uses `/api/observations/compare` with visible metric values and absolute tolerances; a passed comparison covers only those checks.

**Apply calibration proposal** validates and applies the reviewed proposal atomically under the workspace fence. Cancel leaves the architecture unchanged. Retain source/calibration metadata, mark existing runs stale and offer rerun. Label calibrated components and evidence scope; unmeasured components remain illustrative. Synthetic samples, low holdout error or one matched metric do not establish vendor or whole-system accuracy.

## AI proposal review

Show capability/provider availability in plain language, editable prompt, Generate, progress and recoverable errors. `/api/ai/generate` returns a validated proposal, explanation and warnings; generation never applies, runs, deploys or executes the proposal.

Before Apply, show grouped before → after changes: added/removed/renamed components; connections/endpoints/routing/async boundaries; capacities, service/network latency and queue/concurrency; billing/provider/region/model; workload, duration/seed/monthly assumptions; events, targets and trigger/window/value changes. Values carry units, additions/removals are written, and counts supplement the actual diff. Include returned warnings and limitations; keep full JSON in optional details. Explicit **Apply proposal** updates only the reviewed workspace, invalidates prior results and offers a new run. A changed workspace requires a fresh proposal/review, not a generic “replace anyway” confirmation.

## Workspace and evidence integrity

Fence every workspace-dependent asynchronous completion (run, save/open/import, event draft, AI, quote and calibration) by workspace identity plus monotonically changing workspace generation/revision; simulation also needs a run-request generation. Capture the submitted snapshot. Project ID or shared node IDs alone are insufficient. A response for replaced A must never populate B’s graph, inspector, model label, comparison, save status or pending review, even if node IDs match. Superseded requests cannot clear a newer operation’s busy state. An old result may be discarded with explanation or retained under its explicitly named original snapshot, never attached as B’s current result. Same-workspace edits make retained results stale until rerun.

Validate imports before replacement: bounded file/structure size, supported workspace format version, valid project/topology and known node associations; nonempty ordered finite frame timestamps within duration; finite, correctly typed/ranged summaries and telemetry; foreground conservation (`requests = completed + failed + pending`, using frame in-flight semantics where applicable); separate background counts; result seed/duration/model metadata and association with its architecture snapshot. Reject contradictory evidence and unsupported versions with a field/reason. Never trust imported `results_stale: false` as freshness proof, or silently substitute the current project for a missing run snapshot.

Treat imported runs as **Unverified external evidence** even when schema-valid. Distinguish schema validation, snapshot association, local rerun and empirical calibration; none establishes the others. Preserve original provenance and values; never fabricate missing metadata. Allow an explicit architecture-only import after explaining rejected run evidence, without presenting a partially accepted bundle as fully validated. Failed/cancelled import preserves the current workspace and comparison. Render imported strings as text and permit only validated http/https source links.

Factory remains read only: distinguish worker exit, review pending/failed, trusted checks passed/failed and integrated acceptance. A green process exit or task count must not imply accepted work. Show unavailable status distinctly from an empty factory; retain error/evidence references.

## Themes, responsive behavior and access

Offer Light / Dark / System in Appearance; default System. The local prototype establishes light values only. Dark is a Tomorrow’s semantic adaptation requiring rendered review, not a claim about Acetate dark parity. Proposed dark starting roles: canvas `#101010`, pane `#212626`, selected `#303b3d`, text `#f7f7f5`, muted `#b9bdbb`, rule `#59615f`, soft rule `#343b39`; Horizon/focus `#76a8b2`, warning `#d4b17b`, success `#abc0ad`, failure `#dda8a3`. Keep primary action Ink/white with a visible boundary; the priority stage remains opaque Ink with a boundary against dark surroundings.

Theme every surface, graph grid/node/edge/arrowhead/label backing, chart, slider, native input, menu, overlay, table, toast, status and focus ring through semantic roles. Resolve appearance before paint, set native color scheme, follow OS changes only in System and tolerate unavailable preference storage. Theme changes preserve selection, drafts, playback time and data. With reduced transparency use opaque navigation; forced colors uses system canvas/text/highlight, visible borders and labeled/shape distinctions instead of shadows or texture.

Use 1000px and 760px as reference-informed starting breakpoints, adjusted when real content collides. Above 1000px keep catalog / graph / inspector with flexible graph width; below it move inspector into a contextual panel and catalog into a compact reachable index. At 760px and below use a single workspace column, horizontal component browsing/search or a labeled catalog sheet, full-width graph and stacked experiment controls. Keep Run and selected time discoverable; utility actions remain reachable by a labeled menu. Panels become viewport-bounded sheets with scroll and safe-area padding; long reviews do not clip Apply/Cancel. Do not hide uncertainty labels to gain space. At 320px CSS width and 200% zoom, reflow ordinary content without page-wide horizontal scrolling; graph/table regions retain deliberate navigation.

Provide skip-to-workspace, landmarks and logical focus order. All actions work with keyboard and single-pointer input: add/select nodes; arrow move (5px, Shift 20px) and numeric position fields; source/destination selectors for connections; pan buttons/Fit view/zoom; event forms instead of marker dragging. Escape exits connect mode. Restrict canvas shortcuts to canvas context, never text inputs. Avoid trapping touch page scroll outside explicit graph manipulation. Confirm node deletion with connected-edge/event consequences when no undo exists; do not promise restoration absent implementation.

Tabs use roving focus with arrows/Home/End and linked tab panels; buttons/menus expose expanded/selected states. Aim for WCAG 2.2 AA contrast: 4.5:1 ordinary text, 3:1 large text and meaningful control/focus boundaries; verify actual pairings in both themes rather than assuming token names ensure contrast. Focus must remain visible and unobscured by sticky controls. Test long names, PT-BR-length copy, touch and screen-reader readings of exact values.

Motion follows the reference roles: 90ms touch, 160ms control response, 220ms selection, 320ms layer; 620ms projection only for an optional presentation transition, never a delay in metrics. Use interruptible transform/opacity transitions; pointer manipulation follows input immediately without spring lag. Honor reduced motion at startup and on change: no automatic playback, animated traffic, pulsing markers, shimmer, smooth scrolling or moving layers; explicit playback may advance static frames with textual progress. Motion settings never alter the seeded simulation or remove information. No new animation library is required.

## Required independent acceptance evidence

Implementation review must record actual desktop/mobile light/dark screens against the local reference, complete keyboard/modal journeys, zoom/contrast/forced-color/reduced-motion checks and preserved end-to-end workflows. Include quote unit-conflict rejection and cancel/apply; malformed measurement and calibration cancel/apply; readable AI changes and stale proposal rejection; delayed A→B run/save/proposal responses with shared node IDs; invalid/contradictory import evidence and forged freshness; previous-run comparison and export/import continuity. Test failures/offline/cache states with recoverable drafts.

Run `python3 scripts/check.py` for repository checks and preserve failures; passing it cannot establish visual parity, usability or empirical accuracy. The requirements above remain subject to independent acceptance. This document does not approve its own work or close the historical QA findings.
