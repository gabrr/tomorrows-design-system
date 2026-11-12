---
name: frontend
description: Implement the dependency-light local editor, playback, metrics, persistence and comparison UI against the shared JSON contract.
---

# Frontend

Bound context to the contract, assigned frontend/ files and relevant UX acceptance rows. Use React 19, TypeScript and the pinned published Astryx package. Read docs/ASTRYX-INTERFACES.md. Build reproducible local bundles with npm ci and npm run build; Python runtime consumers need no Node.

Maintain one project state and explicit loading/error/result states. Validate API responses before rendering; use textContent for untrusted labels/messages. Requests use the contract routes and surface {error: str}. Keep AI proposals reviewable before apply. Save/import/export must preserve scenario seed, events, monthly assumptions and architecture configuration; reject malformed imports with actionable errors.

Render traffic and component state from returned frames. Scrub/play/pause change presentation time only. Cancel obsolete playback and ignore stale run responses; comparing snapshots must identify their input/model/price provenance and avoid overwriting the prior result. Display availability as a formatted ratio, latency in ms and cost in USD with assumptions. Missing metrics never become zero by formatting.

Use actual Astryx controls and states, never restyled native lookalikes. Read installed public declarations before using props. Keep persistent controls and graph nodes keyed and stable; committed project state, gesture previews and run evidence have separate lifecycles. Provide keyboard alternatives to canvas gestures, visible focus and reduced motion. Test an actual edit-run-scrub-save-reload-compare journey and error recovery. Screenshots alone cannot prove functionality.

Sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [Playwright assertions](https://playwright.dev/docs/test-assertions); see [UX guidance](../ux-design/SKILL.md) only for interaction work.
