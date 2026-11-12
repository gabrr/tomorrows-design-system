---
name: architecture
description: Design or review local simulator and factory interfaces, model boundaries, and compatibility for Tomorrow’s Design System.
---

# Architecture

Bound context to docs/CONTRACT.md, docs/PLAN.md, affected module exports and their callers. Propose contract changes to the coordinator before altering shared interfaces; edit only assigned files.

Keep the stdlib Python HTTP app and factory separate. Use the user-directed React 19 / Astryx frontend and its typed module boundaries in docs/ASTRYX-INTERFACES.md. Python serves only built local bundles; installed users need no Node. The server binds 127.0.0.1:8765; simulation exports simulate(project) and validate(project). Keep model time independent of playback time. Frames, summaries and animated traffic must derive from the same engine state.

Define event ordering, units (seconds, milliseconds, USD), model version, seed behavior, foreground versus background completion, topology rejection and per-run budgets explicitly. A provider label must not imply provider-specific fidelity. Unsupported behavior needs a visible limitation or rejection. Keep persistence atomic and process execution behind a replaceable adapter. Separate proposed AI architecture from applied architecture.

Review boundaries using malformed projects, interrupted writes and unavailable adapters before proposing more infrastructure.

Sources: [SimPy scheduling](https://simpy.readthedocs.io/en/latest/topical_guides/time_and_scheduling.html), [Python subprocess](https://docs.python.org/3/library/subprocess.html). SimPy is a reference, not a required dependency.
