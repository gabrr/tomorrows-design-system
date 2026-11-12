---
name: user-simulation
description: Test bounded architecture-design journeys as a specific simulated user, combining shared WebMCP commands with observed UI checkpoints and actionable feedback.
---

# Simulated user testing

Use a distinct persona and concrete goal, not the implementer's task list. Read only the current requirement, relevant interaction contract, previous findings and tool inventory. Keep context bounded; capture a compact checkpoint before changing chats. Never invent user research or claim a source walkthrough was a live test.

Before browser use, discover the page's current WebMCP tools. Use those tools for supported actions through the real Workspace commands. Read the current fence before mutation. A failed tool result is not success; inspect current state and recover. Do not bypass review, modal, gesture, dirty-work or stale-revision guards through raw JavaScript or test-only globals. Never invoke paid AI, refresh provider catalogs, mutate factory jobs or operate on non-disposable designs merely to complete a test.

At each meaningful state change inspect the rendered UI: after adding/connecting, a group edit review, apply/cancel, simulation/failure time, comparison and recovery. Take a screenshot for layout claims. Use actual pointer/keyboard tests for handles, hover, drag, focus, Escape, dialogs and trackpad behavior; command-level tests cannot establish those. Record tool execution time and interaction count only when measured; do not invent speedup claims.

Builder persona: add A/B/C, connect A->B and A->C, move B while wiring, navigate, inspect, run a failure and recover from a mistaken connection. Operator persona: select multiple nodes, move as a group, edit common/mixed fields, duplicate the selected subgraph, delete with dependent edges/events and undo, then compare revised and stale results. Both must test cancellation and an invalid action.

Findings must include: unique ID, persona, user goal, reproduction steps, expected/observed behavior, evidence type (source, unit, browser-tool, pointer/keyboard, screenshot), artifact path, severity, impact and acceptance steps. Unperformed checks remain unverified. No approval based solely on screenshots or tool return values.

Feed findings into docs/features/experience-findings.md. The researcher separates standards/platform constraints from assumptions. Planner and UX/architecture specialists produce scoped fixes and acceptance. Implementer repairs. A separate reviewer reruns the failed journey against the new revision. Coordinator accepts only with actual evidence and no unresolved required findings; otherwise records feedback and assigns repair. A blocked specialist is not replaced with a fabricated report or a fake approval.

Standalone CLI source-sharing approval is currently unresolved; do not execute those assignments or send project source/screenshots to an external provider until that is resolved. Existing app WebMCP calls are local commands in an already authorized disposable QA session, not permission to share repository source.
