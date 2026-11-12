---
name: qa
description: Review actual artifacts and execute requirement-linked simulator, API, UI and factory checks independently.
---

# Qa

Load docs/ACCEPTANCE.md, affected requirements and raw artifacts at the exact revision under review. Do not infer completion from worker prose, screenshots of code, or test-file existence.

Run the available suites and record command, exit status, test count, revision, fixture/seed and failures. Confirm discovery ran meaningful tests; zero collected is not a pass. Add reference expectations independent of implementation. Preserve failing tests and prior evidence; never lower thresholds or skip a requirement to obtain green output.

For simulation inspect numeric conservation, failure/recovery behavior and reproducibility; for APIs inspect invalid input, local persistence and write protections; for UI execute edit/run/playback/compare and accessibility paths. For factory inject crash, lease expiry, partial/malformed output, duplicate completion, cancellation and stale-review cases. Mock provider boundaries for deterministic failure tests, then separately label any live smoke check.

Independent review checks real generated files/diff and rendered screens, unsupported assumptions, misleading precision, stale context and user comprehension. A structured worker response or exit code cannot self-certify acceptance. Report pass/fail/not-run separately and retain unimplemented/deferred requirements.

Sources: [Playwright assertions](https://playwright.dev/docs/test-assertions), [OpenAI repair-loop validation](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex).
