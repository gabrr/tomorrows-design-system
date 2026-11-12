# Contributing

Tomorrow’s Design System is an early-stage local architecture simulator. Improvements to everyday editing, model validation, accessibility and reproducible experiments are welcome.

## Run and develop

Use Python 3.11+ for the app. Frontend development additionally needs Node.js 22.13+:

```sh
npm ci --ignore-scripts
npm run build
python3 -m tds --port 8766
```

The Python backend has no runtime package dependencies. Built frontend assets are committed so a source checkout can run without Node.

Run the trusted checks before proposing a change:

```sh
python3 scripts/check.py
```

For a UI-only iteration, use `npm run typecheck`, `npm run check:ui` and `npm run build`, then complete the relevant browser journey. CI runs the full checks and browser suites against disposable local data. Never use browser test scripts against designs you want to preserve.

## Keep changes reviewable

- Explain the user goal and the behavior before and after the change.
- Keep simulation outcomes independent of playback and animation.
- Preserve evidence validation, revision fences, cancellation, undo and provenance.
- Use actual Astryx components for ordinary UI controls. Domain graph geometry is a documented exception.
- For model changes, provide reproducible reference cases, units and explicit limitations. Do not turn estimates into claims of measured accuracy.
- For UI changes, record the edit/run/recovery journey and inspect the rendered result. Screenshots and WebMCP success each provide only part of the evidence.
- Rebuild `web/assets/` after changing frontend source.

Read [AGENTS.md](AGENTS.md), [the contract](docs/CONTRACT.md) and the relevant module boundaries first. The standalone development factory is optional; ordinary contributions do not require Codex or another paid AI service.

## Report a useful issue

Describe what you were trying to do, steps to reproduce, expected and actual behavior, browser/OS, and a minimal synthetic architecture if needed. Include whether a reading is missing, estimated, stale or incorrect. Remove credentials, personal data and private infrastructure details from screenshots and JSON.

For feature requests, start with a concrete task—for example, moving two workers together or comparing a cache with no cache. Explain how you work around the limitation today. See the current [experience findings](docs/features/experience-findings.md) before opening a duplicate.
