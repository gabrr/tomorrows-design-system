---
name: backend
description: Implement local stdlib Python APIs, project persistence and adapter boundaries for Tomorrow’s Design System.
---

# Backend

Read the shared contract and only affected handlers/modules/tests. Coordinate interface edits; do not absorb simulator or factory ownership implicitly.

Keep python3 -m tds local on 127.0.0.1:8765, serve web/ directly and use JSON {error: str} with validation status 400. Bound request bodies, simulation work, adapter duration and output. Reject invalid JSON, nonfinite/invalid fields, unknown paths and unsupported methods predictably. Loopback binding alone does not protect against browser-origin writes: validate host/origin and content type before mutations; test allowed local use and rejected cross-origin writes.

Map project IDs to controlled paths under .tds/projects; reject traversal and avoid arbitrary filesystem/command parameters. Persist with temporary file plus atomic replacement; test recovery from interrupted writes. Do not expose secrets in errors or logs.

AI generation returns a validated proposal with explanation/warnings and never implicitly executes/applies it. Pricing failure retains provenance and last good data. Factory status is read-only and gracefully empty before initialization. Use subprocess argument arrays, explicit cwd and timeout rather than shell interpolation for adapters.

Sources: [Python subprocess](https://docs.python.org/3/library/subprocess.html), [WCAG error identification](https://www.w3.org/TR/WCAG22/#error-identification); API/security boundaries above are project requirements.
