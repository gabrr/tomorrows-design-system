# Browser edition

Public workspace: **https://tomorrows-lab.netlify.app/**

The static Netlify build runs the existing `tds.simulation` Python implementation
in a dedicated Web Worker using pinned Pyodide 314.0.8. It does not expose the
local Python HTTP server, execute Codex, or depend on the owner's computer.
The package includes the real catalog, presets, validator, calibration logic
and simulator; there is no separate approximation of the simulation in JavaScript.

The browser edition supports manual architecture editing, connection gestures,
presets, workloads, timed and conditional events, simulation, animated playback,
results, comparisons, cost projections, calibration and JSON import/export.
Defaults retain the local edition's illustrative-model limitations.

Projects and up to 100 completed runs are retained in same-origin IndexedDB on
the visitor's device. The Save action confirms after the transaction commits.
Clearing site data removes this storage. It is not cross-device sync or cloud
backup; use JSON export for a portable copy. Simulation work can be cancelled
by terminating the worker; the next request starts a fresh engine.

AI design proposals, browser dictation for AI prompts, the development factory
and live provider catalog refresh are local-edition features. The hosted UI
replaces the AI composer with manual-workflow guidance and a local-install link.
Configure component prices explicitly for hosted cost experiments. No model API
keys or account credentials are needed or included in this build.

## Build and verify

Requires Node 22+, npm and Python 3.11+ at build time:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build:hosted
npm run test:hosted
```

`dist/` contains only frontend assets, icons, generated public catalog/preset
JSON, the selected Python modules and the pinned Python runtime and licenses.
It does not copy `.tds`, agent state, recordings, personal projects or evidence.
Runtime assets are served from the same site; there is no third-party runtime
CDN dependency. An initial network download is required; offline installation
and service-worker caching are not implemented.

`netlify.toml` declares the reproducible static build. The first production
deployment uses a manually uploaded `dist/` archive. Continuous Git deployments
are not connected automatically. Future releases can upload the rebuilt archive
to the existing Netlify project, or explicitly connect the repository in Netlify.

## Verification

- All four presets match CPython simulation results in WebAssembly, comparing
  complete outcomes at 11 significant digits to allow floating-point rounding.
- IndexedDB save/read/delete, retained runs, cancellation/restart, validation,
  body limits and explicit unsupported-feature errors are covered by tests.
- Browser QA uses the deployed UI to run the failover preset, scrub to second
  25 and observe App A down / App B receiving 20 requests per second.
- TypeScript and the existing frontend checks pass. The existing Python suite
  was run; HTTP service checks were rerun with loopback permission and pass.
