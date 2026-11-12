# UI system — Astryx (0.4.0)

The user's explicit Astryx replacement supersedes the Acetate adaptation (historical specification: features/ui-system-pre-astryx.md). Use published @astryxdesign/core and theme-neutral 0.7.13 with React 19. Installed public type declarations define valid APIs. Import reset, core, theme CSS in that order; use the real Theme provider for light/dark/system, including portal contents.

Use the shared UI façade in frontend/src/ui/index.tsx: Button/IconButton/ToggleButton, TextInput/NumberInput/TextArea, Selector, Switch, Slider, Dialog/DialogHeader, Table, Banner, Card and Collapsible. No native visible select, prompt, alert or confirmation dialog. Hidden file-picker bridge and domain SVG paths are explicit exceptions. Lucide provides consistent icons; project icon uses Network rather than the old letter mark. Do not guess internal class names or override component cursor, focus or state paint.

Desktop minimum target width is 1100px. The graph fills the viewport. Compact edge controls summon one context panel; the conversation and playback remain floating. Keep dense results scrollable and collapse raw JSON by default. Library search owns a stable input. Dialogs own focus and Escape; global shortcuts defer to overlays and text editing. Keyboard alternatives exist for move, connect, zoom, pan, fit and delete.

Canvas node and toolbar host identities must survive selection, frame changes and asynchronous completion. Never rebuild interactive DOM with innerHTML. Live drag coordinates stay outside committed project; cancellation discards previews and release commits once. Playback uses returned sample timestamps and never changes simulation results. Reduced motion disables traffic animation.

Busy, disabled, selected, validation, empty, stale, unavailable and failed states must be explicit. AI, rate and calibration changes require review and a current identity/revision fence. Missing samples remain unavailable; genuine zero latency/cost remains zero. External imported evidence always carries an unverified label. See ASTRYX-INTERFACES.md and ASTRYX-VERIFICATION.md.
