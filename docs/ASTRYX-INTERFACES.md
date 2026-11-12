# Astryx migration implementation boundaries

Accepted after standalone public-library research, public-requirements planner, and source architecture review. Exact implementation dependency baseline: published core/theme-neutral 0.7.13 (upstream inspected commit 938558ab717d7a8188879074da0ea1ef304fc953 declares 0.7.14). Published declarations and typecheck are authoritative for executable code. Every standard control is actual Astryx, not legacy HTML styled to resemble it. Custom graph geometry is the explicit domain exception.

## Shared modules (coordinator-owned)
- `domain/types.ts`: Project, Node, Edge, Event, Run, CatalogEntry, Fence, WorkspaceState.
- `domain/evidence.js`: exact extracted existing runtime validators and readable diff/format helpers, no DOM/React. Exports clone, uid, humanize, fmt, money, checkProject, validateResult, architecture, canonical, projectChanges, describeValue, costRateEvidence, metricUnavailableReason, priceReason, validateMeasurements, nearestFrame.
- `domain/history.js`: existing bounded immutable edit history.
- `services/api.ts`: `api<T>(path, options?)`, `write<T>(path,body,method='POST')`; throws actionable errors on non-2xx/invalid JSON.
- `workspace/store.ts`: `workspace` singleton command owner; `useWorkspace()` React snapshot hook. State fields defined in WorkspaceState. No feature directly mutates state/project.
- `ui/index.tsx`: actual Astryx reexports plus application compositions below; library reset/core/theme CSS only once in main. App CSS may position layouts and domain graph; do not override component interaction painting or global cursor styles.

## Workspace commands
`get()` snapshot; `set(partial)` UI-only partial (never project/revision); `edit(fn: (draft:Project)=>void, label='Edit design', group?:string)` clone/commit/history/monotonic revision, stop playback; `replace(project)` explicit whole-workspace replacement with new identity, clear runs/history and invalidate async; `fence()`; `isCurrent(fence,exact=true)`; `requireCurrent(fence)`; `apply(project,fence,label='Apply reviewed proposal')` validate id/fence, reject active gesture, one history action; `select(selection)`; `add(type,x?,y?)`; `removeSelected()` (undoable; no native confirm); `duplicateSelected()`; `undo()`; `redo()`; `run()` Promise<void>; `save()` Promise<void>; `openProject(id)` Promise<void>; `loadPreset(index)`; `newProject()`; `importFile(file)` Promise<void> (validates bundle and returns rejection choice in state); `importArchitectureOnly()`; `exportFile()`; `pinBaseline()`; `clearBaseline()`; `seek(index)`; `seekTime(seconds)`; `notify(text,error=false)`; `init()`; `setGesture(active)`.
Graph uses local transient drag coordinates; committed project is unchanged until pointer release. Gesture cancellation discards preview. `workspace.setGesture(true)` protects Apply; false on up/cancel/unmount. Stable keyed hosts, no hover-driven render/remount, no global document gesture listeners. Selection/connect completed by Canvas feature using workspace commands. UI panels may use workspace.set; modals have local form drafts and must capture/check fences for asynchronous review/apply.

## Shared UI compositions
All imported from `../../ui` relative to feature depth as appropriate (actual path `frontend/src/ui/index.tsx`).
- `Action`: `{label:string,onClick?:()=>void,action?:()=>Promise<void>,disabled?:boolean,busy?:boolean,variant?:'primary'|'secondary'|'ghost'|'destructive',icon?:ReactNode,size?:'sm'|'md'|'lg',id?:string,className?:string}` delegates Astryx Button.
- `IconAction`: same with required icon and label, optional `selected:boolean`; delegates Astryx IconButton (or ToggleButton composition), tooltip from label.
- `Input`: actual Astryx TextInput reexport (label,value,onChange; type/search; hasClear; isLabelHidden).
- `Numeric`: actual Astryx NumberInput reexport (label,value,onChange,min,max,step,isIntegerOnly,isWheelEnabled).
- `Select`: actual Astryx Selector reexport, label/options/value/onChange,presentation='popover' where used; no visible native select.
- `Area`: actual Astryx TextArea reexport.
- `Disclosure`: `{title:string,children:ReactNode}` actual Collapsible composition.
- `ModalShell`: `{title,open,onClose,children,width?}` actual Dialog + DialogHeader, accessible focus and Escape library-owned. No browser confirm/alert/prompt.
- `DataGrid`: `{label:string,columns:string[],rows:ReactNode[][]}` actual Table data API with stable column keys.
- `Message`: `{text:string,error?:boolean}` Astryx Banner.
- `Text, Card, Badge, Switch, Slider, TabList, Tab, DropdownMenu, Button, IconButton, Tooltip, Theme` reexport real Astryx.
Icons: lucide-react, same family as Neutral. Keep stable hosts during async, playback and hover; no interactive element nesting. All actions must have hover/pressed/focus/disabled/busy states delegated to Astryx; error state via Banner/status, not color alone.

## Feature ownership and exports
- Editor worker: only `features/editor/**`. Exports `Canvas`, `LibraryPanel`, `InspectorPanel`, `ScenarioPanel`, `Playback` from `features/editor/index.tsx`; editor-only CSS may be imported there. All existing editable node/config/edge fields, advanced JSON, position, connect alternatives, exact/window/condition events, defaults/catalog/model limits, workload/monthly assumptions and retained-frame controls.
- AI/utilities worker: only `features/ai/**` and `features/utilities/**`. Exports `AIWorkspace` from ai/index.tsx; `UtilityDialogs` from utilities/index.tsx. AI text/voice, pending-draft refinement, validation/fences, explicit Apply/Apply & simulate. Dialogs for projects, pricing target/filter/page/review/apply/cache refresh, calibration import/review/apply, factory readonly, settings appearance (provided `mode,onModeChange` props), events delegated editor ScenarioPanel where needed, import rejection choice. No telemetry sent to AI. API modules above.
- Results/layout worker: only `features/results/**` and `features/layout/**`. Exports `ResultsPanel` and `WorkspaceChrome` respectively. Chrome has toolbar title/save/run, Astryx menu, panel rail, undo/redo, zoom/fit actions. Canvas fit dispatch custom DOM event `tds:fit` (only bounded app event) or expose workspace camera fit helper via model bounds. Results include unavailable-sample logic, baseline/previous deltas, unit-bearing diff, cost/provenance/assumptions/event logs, full architecture/edge telemetry reading (fresh only). Chrome appearance opens settings modal. Experiments panel tab composition coordinator-owned.
- Coordinator owns App/main, app layout CSS, types/store/services/domain/ui helpers, build/packaging, integration/acceptance tests. Never change other workers' files. Report missing interfaces rather than invent incompatible ones. Do not weaken existing validation/tests.

## Acceptance journeys
Build by AI text/voice and by add/drag/connect; edit, cancel and undo; schedule/trigger events; run/playback/step/time; compare/pin/release; save/open/new/delete; export/import full bundle and reject contradictory evidence with architecture-only choice; pricing/calibration review/apply; readonly factory; light/dark/system; operation errors/retry; keyboard/dismiss/focus; stable pointer cursor/host during hover and playback. No production calibration or private quota claims.

## Direct canvas operations

`Selection` includes a normalized multi-node selection. `domain/graph.ts` owns selection extraction and topology preflight; Python remains authoritative for full project validation. `Workspace.connect`, `moveNodes` and `patchNodes` centralize mutation, revision and gesture guards. Canvas owns only provisional wire/drag/marquee state; ports are sibling Astryx controls, never nested buttons. Group inspector validates shared primitive edits before committing. WebMCP select supports additive selection; duplication/deletion use the same group commands.
