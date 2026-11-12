# Factory verification — 2026-11-11

Implemented within `factory/*`, `tests/test_factory.py`, and `agents/roles.json`.
No project commits, deployment, external messaging, configuration changes, or
credential changes were performed.

Command executed on macOS with Python 3.14:

```sh
python3 -m unittest discover -s tests -p test_factory.py -v
```

**34 tests passed in 34.147 seconds.** Exact test names/results are preserved in
[verification.txt](verification.txt). Disposable test repositories use Git fixture
commits; the project's HEAD and shared index remain unchanged by factory integration.
Also checked `python3 -m py_compile factory/*.py`, top-level/add/run/review CLI help,
and the uninitialized read-only dashboard status.

Evidence includes real Git worktrees, SQLite transactions, standalone mock
subprocesses, forced worker death, killed supervisors, recovered orphan checks,
expired lease fencing, malformed/command-bearing JSON rejection, bounded retries,
timeouts, active cancellation, pause/resume, dependency ordering and dependency
artifact visibility, stale contracts/skills, scope violations, self-approval
rejection, independent rejection, artifact tamper rejection, failed acceptance,
combined-check failures, conflicting integration, unchanged root HEAD/index,
sequential integration, partial-write rollback, a subprocess exit mid-integration,
crash after database commit, concurrent-edit protection, and repeated recovery.

Real `codex exec` flags were checked against the installed executable's help;
`--sandbox workspace-write`, JSON schema, last-message output, and stdin prompt
are wired through the explicit provider registry. **A live model execution was not
performed.** No claim is made about current service authentication, network access,
model availability, or live approval behavior. The real smoke-test command after
adding a scoped task is `python3 -m factory run --provider codex --once`.

Limits: trusted single-user local repository and reviewer identity labels; POSIX
process groups/flock, tested on macOS (Linux identity support is implemented but
not exercised here); no Windows support, automatic reviewer service, background
daemon, token/cost budget, disk log quota, worktree/evidence garbage collection,
symlink/submodule integration, or automatic conflict repair. Trusted checks run
as explicit operator-supplied argv; they are not OS-sandboxed by the factory.
Timeouts are bounded process deadlines with polling/Git setup overhead; combined
integration checks use per-check timeouts outside the worker time budget.

See [README.md](README.md) for every CLI command, recovery semantics, role/skill
requirements, sandbox boundaries, and the `status(root) -> dict` dashboard API.
