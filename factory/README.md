# Local code factory

This standard-library Python package supervises **standalone `codex exec` processes**.
It does not use native subagents, side chat APIs, cloud deployment, or commits.
Python 3.10+, Git, and POSIX process groups/flock are required. The `codex` executable
must already be installed and authenticated for real execution. Nothing edits user
configuration or credentials. `mock` is a subprocess fault fixture, not a model.

Run from the repository root:

```sh
python3 -m factory --help
python3 -m factory init --concurrency 2 --total-seconds 3600
python3 -m factory status
python3 -m factory add demo --role backend --actor codex-backend \
  --scope factory/demo.txt \
  --acceptance 'factory/demo.txt contains hello followed by a newline' \
  --check '["python3","-c","from pathlib import Path; assert Path(\"factory/demo.txt\").read_text() == \"hello\\n\""]' \
  --prompt 'Create factory/demo.txt with hello followed by a newline. Change only that file.'
python3 -m factory run --provider codex --once
```

Task creation requires explicit scope, acceptance, one or more check argv lists,
prompt (or `--prompt-file`), approved role, and worker actor. Scope entries are exact
relative files; only a trailing `/` grants an entire subtree. Paths containing
`.git`, `.factory`, traversal, symlinks, and submodules are rejected. Approved
role templates and permissions live in `agents/roles.json`; their skill references
must exist. Checks are trusted code explicitly supplied by the task creator. Never
paste unreviewed model-suggested commands into `--check`. No command uses a shell.
Model JSON cannot add commands, checks, permissions, or approval decisions.

Inspect the actual patch, worktree, `context.json`, `evidence.json`, acceptance logs,
and worker logs under `.factory/attempts/demo/1/`. An external reviewer then records
a decision under a **different actor and different approved reviewer role**:

```sh
python3 -m factory review demo --actor human-reviewer --role qa --approve \
  --notes 'Inspected artifact.patch, actual demo.txt and acceptance-0.log; content matches acceptance.'
python3 -m factory integrate demo
```

`review --reject` blocks the task. Approval binds to the patch SHA-256 and requires
successful recorded acceptance checks. Worker self-approval is rejected. Reviewer
notes should address actual artifacts, unsupported assumptions, contradictions,
context overload, user comprehension, and misleading precision. Identity labels
are local accountability records, not authenticated multi-user identities; the
factory assumes a trusted local operator. It does not automatically impersonate
or launch reviewers. The worker cannot advance itself through the normal API.

Integration is serial, creates a separate candidate worktree with the **current
combined local changes**, three-way applies the reviewed patch, reruns the same
trusted checks, and detects concurrent workspace edits before applying. It writes
only the patch's validated scoped files, leaves Git HEAD and the shared index
unchanged, and creates no commits. Conflicts/check failures preserve the verified
artifact, logs, and root workspace for inspection. Failed candidates are retained.
A durable fsynced before/after journal rolls back partial integration on recovery;
if a third party edited a journaled path after a crash, recovery stops for manual
inspection rather than overwriting that edit. Atomic rename and SQLite FULL/WAL
are used; the filesystem must support their normal local durability semantics.

```sh
python3 -m factory pause
python3 -m factory resume
python3 -m factory cancel demo
python3 -m factory resume demo
python3 -m factory recover
```

Pause stops new claims and integration; active attempts can finish. Cancel ends
an active worker/check process group and fences its completion. Resume a cancelled,
failed, or blocked task only within its original attempt budget and with unchanged
pinned contracts. Exhausted budgets or stale context require an explicitly new
task; retries never silently increase budgets. `recover` kills identifiable orphan
process groups with expired leases, fences the old owner, retries within the bound,
and resolves incomplete integration journals. Repeat recovery is idempotent.
It does not expire healthy leases or automatically restart a background daemon.
Providers/checks start behind a pipe gate: ownership is durably recorded before
execution is released. A supervisor crash before registration closes the gate.
Recovery also terminates recorded orphan groups from combined integration checks.

State transitions:

```text
proposed -> ready -> running -> review -> verified -> integrated
               ^       |         |          |
               |       +---------+          +-- integration failure stays verified
               |       retry     rejection -> blocked
               +-- explicit resume within original budgets
running -> failed (exhausted attempts), blocked (stale context), or cancelled
```

Dependencies must reference already-added tasks (`--depends ID`, repeatable), which
prevents cycles. Claims wait for all dependencies to be integrated. Each attempt
pins the current complete local input as a Git tree plus source revision, SHA-256
input patch/content hashes, contract/role/skill hashes, and bounded prompt context.
This includes uncommitted integrated dependency files. Existing local changes are
inputs, never attributed to the worker. Changing pinned contracts/templates/skills
blocks execution/review/integration; create a fresh task after reconciling them.
Approved context files are bounded to 128 KiB, the explicit task prompt to 64 KiB,
and the complete generated prompt to 256 KiB; oversized context fails explicitly.

By default `run` drains immediately claimable tasks in the current process and
exits when none are available (it does not wait for future dependency integration).
`--once` claims at most one task. Separate supervisors start **only** with an explicit
argument:

```sh
python3 -m factory run --provider codex --workers 2 --once
```

SQLite claims enforce configured concurrency across all supervisors. Each attempt
reserves its timeout against the remaining cumulative execution budget, preventing
concurrent oversubscription; actual elapsed attempt time is charged after completion.
`--timeout` includes worker and acceptance execution; process polling and bounded
Git/setup operations can add scheduling overhead. Combined integration checks have
per-check task timeouts and are outside the cumulative worker budget. Money/token
budgets are unsupported. Logs are private local evidence, not uploaded; their disk
size is not currently quota-limited. Avoid secrets in prompts/check argv/artifacts.
The Codex adapter explicitly requests `workspace-write`, inherits the configured
approval policy, and never passes bypass, additional-write-directory, or approval
suppression flags. This does not turn mock/custom adapters or trusted checks into
OS security sandboxes. Unidentifiable orphan PIDs are never signalled blindly.

For deterministic local testing, use `--provider mock --mock-file fixture.json` at
add time, and `run --provider mock --once`. The JSON fixture supports `files`
(relative paths to string contents), `sleep`, `kill_self`, `exit_code`, `malformed`,
and an optional explicit `result`. A task's provider is immutable; the selected
registry provider only claims matching tasks. Real results must match
`factory/result.schema.json`, including actual evidence file paths. Evidence hashes,
patches, manifests, return codes, timings and logs remain in `.factory`; it must be
Git-ignored before init. Nothing automatically deletes worktrees or evidence.

The coordinator dashboard imports `from factory import status` and calls
`status(root) -> dict`. An uninitialized repository yields an empty initialized=false
status. This entry point never claims tasks, launches processes, or runs recovery.
Dashboard connections open SQLite in read-only mode.

Verification:

```sh
python3 -m unittest discover -s tests -p test_factory.py -v
```

Tests use real SQLite transactions, Git worktrees, mock subprocesses, forced worker
and supervisor death, and a subprocess crash halfway through integration. They do
not contact a model service. Live Codex availability/authentication/approval/network
policy must be checked separately using the explicit real `run --once` path.
