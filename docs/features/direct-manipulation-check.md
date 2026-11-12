# Direct manipulation verification — 2026-11-11

Coordinator implementation and local checks; this is not independent acceptance.

## Behavior

The permanent Select/Connect tool switch is removed. Each component has separate input/output Astryx controls, revealed on hover/focus/selection and while connecting. Connect by output then input, Enter on each handle, or dragging output to input. Escape or a lost/cancelled pointer discards the provisional wire. Unsupported cycles, self-connections and duplicate endpoint pairs do not create history.

Shift/Cmd/Ctrl-click toggles components. Shift-drag on blank canvas adds an intersected rectangle selection; blank drag pans. Select-all, arrow nudges, duplicate and delete operate on the group inside the focused canvas. Group movement previews positions, then commits once. Duplication includes internal connections; scenario events stay on originals. Deletion removes attached edges and direct/condition-target events; Undo restores the complete change.

The group inspector offers primitive config properties shared by the selected components. Mixed values remain explicit until edited. Apply validates with the real Python backend, rechecks identity/revision and active gesture, and commits one undo step. Untouched drafts refresh after movement; edited drafts retain stale-revision protection. Astryx action buttons stack to preserve full labels in the narrow inspector.

## Observed browser evidence

Disposable Python instance on8899, IAB1280×720, temporary tabs14–16. No user saved projects were changed.

- Native group pointer drag preserved App A/B relative spacing and left Balancer untouched; one undo restored positions.
- Capacity250 applied to both selected servers while Balancer stayed100; undo restored both.
- False stale-edit warning after moving an untouched group draft was reproduced, repaired, and absent on retest.
- Group duplicate produced two copies. Deleting them removed both; Undo restored both.
- Output→input click, Enter→Enter, and native pointer drag each created App A→App B. Escape after choosing output left the graph unchanged.
- Selected card button labels announce selection. Browser error log was empty at final keyboard-connection checkpoint.
- Screenshot inspection caught truncated group action labels; stacking repaired them. Final screenshot: local-evidence-omitted Ports remain clear beside the inspector. Connection checkpoint: local-evidence-omitted

The full regression suite passed109 Python tests and39 frontend command/review/workspace tests after the scenario draft repair. Twelve direct-manipulation/draft command tests passed, including real Python validation, atomic batch edits, invalid/stale changes, group history and WebMCP additive selection. TypeScript and existing command/integrity/history suites passed. Extended web/tests/webmcp.cjs adds a real-browser regression journey; it was syntax-checked, not run as a terminal browser in this session.

Physical trackpad pinch, marquee pointer interaction, pointer-cancel during a live wire, and continuous cursor-hover stability remain unverified on hardware. Automated command checks do not establish these. The independent persona/architecture gates remain open in experience-findings.md.

Temporary8899 server and root QA tabs were stopped/closed after verification. Other listeners were identified as separate projects and left intact.

## Scenario draft navigation repair

Scenario-event scratch state is retained in Workspace, shared between the experiment panel and events dialog, and excluded from project export/history until explicit Save. Cancel discards it; Restart replaces a stale draft with current events; replacing a project clears it. Save validates with Python, checks revision and exact draft identity again, then creates one history step. Cancellation or further draft edits during validation invalidate the old save.

Actual browser tab17 retained a third unsaved event after closing/reopening. A project-name edit preserved all three draft events and disabled Save with a stale warning. Restart/Add/Save produced three committed events; one Undo restored two. Screenshots: local-evidence-omitted and scenario-draft-undo.png. Three additional command tests cover navigation, stale/cancel/replacement and validation races. TypeScript/build and the frontend suite passed after this change; the109 Python suite passed earlier in this continuation and Python code did not change.
