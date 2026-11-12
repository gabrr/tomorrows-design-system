# UI authority: Acetate Time System

User-directed change on 2026-11-11: match the overall Acetate Time System UI, not only its colors. This supersedes the initial warm-green visual brief. Keep Tomorrow's identity and architecture workflow.

Primary reference inspected: `[local-design-reference]/prototypes/ui-language/index.html`, `styles.css`, `README.md`; brand authority `[local-design-reference]/brand/acetate-brand-book.html`; table rules `brand/table-design.md`. Studio semantic theme source additionally inspected at `apps/acetate-studio/src/styles/tokens.css` and Docs/theme.md. Reference screenshot `brand/images/ui-reference/time-system-desktop-1360-2026-08-03.png` visually inspected. These local source paths are provenance, not runtime dependencies. The prototype calls itself a retained Time System reference; use it as requested instead of assuming it represents every current Studio screen.

## Foundations
- Canvas white #ffffff; pane #f7f7f5; selected #f0f3f3; Ink #101010, Graphite #212626, muted #646866, rule #d8d8d2, soft rule #ecece8.
- Black primary actions, white text. Horizon #2f6f7e / deep #174b59 for planned flows, comparison and interactive readings. Antique #8a642f warning/alternative; Evergreen #596b5b success; Oxblood #8b4a46 errors/failure. Color has written meaning, not decoration.
- Interface Söhne / Helvetica Neue / Arial system fallbacks; do not redistribute commercial fonts. Iowan Old Style / Baskerville / Georgia for temporal/editorial statements, never dense labels/tables. Tabular numbers.
- Radius roles: controls 10px, panes 16px, layers 22px, priority result stage 26px. A restrained spacing scale; hierarchy and grid before decoration.
- Phosphor Regular family, 20px default, 24px primary/mobile. At least 44px interactive targets. Reuse MIT licensed assets with retained attribution; no Acetate logo reuse.

## Components and composed behavior
- One primary product bar, one local component index. Contextual navigation only when task branches. Quiet secondary controls and segmented local tabs. Preserve access to every existing feature.
- Full readable graph canvas with deliberate panels, not a collection of marketing cards. Inspector is a contextual task panel. Larger radii do not justify wasting useful workspace.
- One consequential result may use Horizon Stage: opaque Ink, quiet label, one dominant measured/simulated value, concise interpretation, assumptions footer. Do not use black surfaces as decoration or for every metric.
- Forms keep label, unit, help and validation together. Errors identify the field/operation; retain usable state. Controls have hover, pressed, focus, disabled and busy states.
- Scrubber is central: visible selected simulated time, event markers, keyboard reading, exact metrics at that point. Simulation time and playback speed remain separate.
- Tables use stable shared columns, quiet horizontal rules, bounded status labels, fixed action lanes, readable values. Filter pricing by actual search and provider; price apply must preserve units/currency/provenance.
- Modals contain decisions; panels preserve surrounding work; one polite dismissible toast confirms completion. Solid modal surface, 40% dimmed backdrop, no backdrop blur. Mobile panels fit and scroll. Restore focus on close.
- AI review explains architecture and event changes in human terms; raw JSON only in optional details. Calibration imports identify measurements and present a reviewable proposal before applying.
- Motion: short responsive state changes and interruptible layers; transform/opacity, never disruptive table geometry. Time System references 90ms touch, 160ms state, 220ms selection, 320ms layer, 620ms projection. Reduced motion removes movement and retains all information. Respect reduced transparency and forced colors.
- If supporting dark/system appearance, semantic roles must cover all components, graph, charts, controls, overlays, tables and state feedback. Resolve before paint and tolerate unavailable storage.

## Acceptance
Visually inspect actual desktop and mobile screens against the reference and test keyboard focus, reduced motion, state continuity and all existing end-to-end workflows after restyling. Passing syntax checks alone do not establish UI parity. Do not claim missing vendor calibration is solved by polished presentation.

## Desktop canvas revision
The latest user direction supersedes the dashboard composition and mobile acceptance above. Preserve Time System tokens, geometry and feedback while giving the full desktop viewport to the architecture. Floating compact edge controls open task panels only as needed. An always-visible conversational composer supports building, changing and exploring; browser speech dictation is an explicit user action and reports capability/permission/service failures. Reviewable proposals can apply and simulate in one action. No numeric form is required for a natural-language request; assumptions remain visible.

## Screenshot polish repair (0.3.1)
The component library uses one shared search-field focus treatment rather than an outline on its inset input. Preset/search fields align at 44px; rail icons use the same licensed Phosphor Regular family at 20px inside 44px targets. Keep existing 10px control / 16px panel roles. Quiet counts and compact rows improve catalog scanning; scroll the list independently and reset it to its first result when the query changes. Escape restores the owning panel trigger; utility menus dismiss when pointer or keyboard focus leaves them. See UI-POLISH-REVIEW.md for image-grounded review and bounded runtime evidence.

## Product mark correction
The upper-left app mark now uses the official MIT-licensed Phosphor Regular `graph` asset, centered at 22px inside a simple 36px Ink tile. The improvised overlapping t/arrow typography was removed. Source: https://github.com/phosphor-icons/core/blob/main/assets/regular/graph.svg . This is a product UI mark, not a new Acetate logo.
