---
name: simulation-validation
description: Verify seeded simulation semantics and design measurement calibration without claiming unmeasured real-world accuracy.
---

# Simulation Validation

Load the contract, engine/model version, affected tests and a minimal project fixture. Preserve the fixture, seed, expected result and actual output with each claim.

Verify stable ordering for equal timestamps, explicit horizon boundaries, monotone time, bounded queue/concurrency, and requests = completed + failed + pending for foreground requests. Track asynchronous jobs separately. Test timestamp, sampled-window and metric-condition triggers including one-shot/retrigger policy; reject unsupported cases clearly. Include recovery, overload, cache miss, branching, asynchronous work and invalid topology cases. Do not assume a graph drawing proves routing semantics.

Use hand-computable fixtures first: zero traffic; a single deterministic server below capacity; overload with finite queue; failure then recovery; hourly-cost conversion. Analytical queue formulas apply only with matching arrival/service/stationarity assumptions. Seed repetition verifies reproducibility, not calibration.

Calibration requires recorded measurements, workload/environment metadata, fit/holdout separation, declared error metrics/tolerances, sensitivity and residual/uncertainty reporting. Multiple seeds estimate sampling variability, not unknown model bias. Keep illustrative defaults labeled until this evidence exists.

Sources: [SimPy event order](https://simpy.readthedocs.io/en/latest/topical_guides/time_and_scheduling.html), [Sandia verification and validation](https://www.sandia.gov/research/publications/details/verification-validation-and-predictive-capability-in-computational-engineer-2003-02-01/), [NIST calibration](https://www.nist.gov/publications/calibration-and-uncertainty-analysis-predictions-computational-models). The calibration protocol is a project proposal, not demonstrated accuracy.
