# 0.4.1 — sampled traffic and clearer change reviews

## Visible traffic

Component cards show arrivals per simulated second. Connection labels show routed calls per simulated second. Both use differences between cumulative counters over the actual adjacent retained-frame interval, including partial seconds. Arrivals include rejected calls; these rates are distinct from successful completions and utilization.

A missing prior sample, missing/reset counters or invalid interval shows unavailable rather than zero. A zero rate remains a valid observation. Editing the architecture suppresses current graph rates until rerun. Replay labels the sampled interval and playing/paused state; Results labels the entire run. Opening Results fits the unobscured canvas once, while replay seeks do not repeatedly move the camera. Crowded connection labels may be omitted; component arrivals remain visible.

## Review the decision before applying

Concrete setting changes appear first, followed by affected-item inventory and Apply controls. The complete before/after diff, proposal JSON and advisory notes remain available. Validation, revision/freshness checks, explicit application and undo behavior are unchanged.

## Bounded Factory snapshots

The snapshot helper checks at most 5,000 paths, 16 MiB per regular file and 128 MiB total regular-file bytes before blob staging. It rejects nested repositories, symlinks/submodules and special files, then stages only the admitted literal NUL-delimited paths. Membership and metadata changes reject the attempt. The full hash map remains in local context/artifact evidence; the prompt carries its exact digest/count/path plus pinned contracts and input identities.

Project ignore rules exclude generated evidence and film assets from ambient untracked input without deleting files or hiding tracked edits. New ignored inputs/outputs need deliberate coordinator handling; no explicit admission API is added. These guards protect a trusted local repository from accidents, not adversarial writers. A during-stage race may already have written admitted blobs. Normal file/directory replacement refactors need a follow-up compatibility fixture: the current special-file guard may reject a tracked file replaced by a directory. Do not bypass the guard with recursive force-adds or silently raise limits.

## Verification and limits

The change includes simulation-backed rate fixtures, proposal grouping regressions and disposable Git boundary tests. On the sanitized public candidate, TypeScript, all 85 Node UI cases, integrity/rate/price/history scripts and four new Factory boundary/retention tests passed (Python 3.11). The earlier full 67 factory-related cases and real-browser workflows passed on the byte-identical source revision. Hosted CI and a fresh installed-package check remain pending for this public candidate. Native WebMCP availability depends on the browser. Simulation models and costs remain illustrative until calibrated; catalog breadth does not establish production accuracy.
