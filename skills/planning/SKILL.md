---
name: planning
description: Decompose Tomorrow’s Design System milestones into bounded tasks, dependencies, ownership, and evidence-based acceptance.
---

# Planning

Read docs/PLAN.md and docs/CONTRACT.md, then only the affected interfaces and current acceptance evidence. Use docs/ACCEPTANCE.md for check definitions; a planned check is not a passing result.

Produce tasks with ID, goal, dependencies, assigned paths, contract/context version, acceptance checks, evidence destinations, and explicit time/context/retry budgets. Split implementation, independent review, and integration; do not give the implementer self-approval. Prefer a small runnable vertical slice, while retaining every deferred requirement in the milestone ledger. Broad catalog coverage never implies calibrated simulation fidelity.

Plan standalone CLI workers only. The durable factory owns leases and restart state; chat history is not a task database. Assign shared-interface edits to the coordinator and serialize integration. No deployment, external messaging, credential changes, or native subagents. Return unresolved dependencies and the next executable check.

Source: [Codex noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode) supports scripted workers; task decomposition and acceptance rules above are project requirements.
