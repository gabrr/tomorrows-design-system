# Architecture

The local Python HTTP service binds loopback and serves the browser workspace and JSON APIs. Architecture state is portable JSON. Atomic project persistence is separate from immutable simulation evidence. The discrete-event engine is independent of animation and AI; the browser reads sampled frames and never calculates replacement outcome metrics.

The component catalog declares behavior and limitations for each supported type. Graph structure describes dependencies and component configuration supplies capacity, latency, concurrency and rates. The scenario supplies workload and disruptive events. Results capture the model version, random seed, original project, metric frames, applied events and cost assumptions. Calibration evidence is required before treating illustrative performance defaults as production predictions.

The pricing subsystem fetches bounded public catalogs or accepts explicit manual rates, preserves original units, source and retrieval time, and never substitutes one access provider's AI prices for another. AI proposals use an adapter and structured output, run read-only, and pass the same validation as manual scenarios. Neither system can silently change the architecture.

The development factory is a separate durable process. A coordinator reviews artifacts and acceptance; planner/delivery schedules bounded tasks; workers use standalone Codex CLI processes in isolated worktrees. Trusted configured checks and independent review guard acceptance. Role skills, source and context versions form part of evidence. The human-factors reviewer checks artifacts and user workflows rather than trusting agent summaries.

Local HTTP defends against cross-origin writes and DNS rebinding, constrains file identifiers, bounds input and simulation workloads, and avoids arbitrary command execution from browser requests. Development workers retain their CLI sandbox policies. Source code and installed tools are trusted local inputs; this is not a hardened multi-tenant execution platform.

## Frontend 0.4.0
React 19 uses useSyncExternalStore with an immutable Workspace command layer. Domain validation and bounded history remain independent of rendering. Editor, AI, utilities, results and shell have separate modules; shared interfaces are in ASTRYX-INTERFACES.md. Transient gesture previews never become committed history until release. Identity/revision/generation fences prevent delayed operations or stale reviews from replacing current work. Real Astryx components own control state and portals. The Python package ships only prebuilt static UI assets, never node_modules, source tooling or browser evidence.
