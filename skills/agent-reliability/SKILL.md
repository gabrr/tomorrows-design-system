---
name: agent-reliability
description: Review factory worker reliability, bounded context, evidence quality, misleading UI and real artifact acceptance.
---

# Agent Reliability

Load the assigned task, contract version, relevant diff and raw evidence. Budget context explicitly: include goal, owned paths, dependency interfaces, acceptance and unresolved assumptions; summarize history with artifact references. Split before context/time/output budgets are exhausted. Never treat a summary as a replacement for decisive raw evidence.

Tag claims as observed, derived, assumed or unknown. Record evidence path, revision, command/fixture and limitations. Detect contradictory context versions and expired leases; reject stale completions. Validate structured responses and changed paths outside the model. Exit success, confident prose and a JSON schema match are not proof of correctness.

Inspect the real artifact: execute generated code, review the diff, open the UI and follow a complete user task. Challenge misleading status badges, invented precision, inaccessible canvas controls and simulated results presented as measurements. Ask whether the user can tell estimates, unknown values, worker progress, review and integrated acceptance apart.

Supervisor design needs persisted attempts, deadlines, heartbeats, resource budgets, bounded retries/backoff, cancellation and orphan cleanup. Resume only with task-specific context; do not use an ambiguous latest session across workers. A separate reviewer supplies findings; trusted coordinator checks decide acceptance. Do not weaken tests or self-approve. No native subagents, cloud deployment, external messages or credential changes.

Sources: [Codex JSONL/schema/resume](https://learn.chatgpt.com/docs/non-interactive-mode), [AWS retry guidance](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/), [OpenAI artifact validation loop](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex). Budget/evidence protocol is a project design.
