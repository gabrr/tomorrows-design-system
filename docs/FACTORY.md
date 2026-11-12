# Standalone code factory

The factory runs locally on macOS/Linux (POSIX process groups and file locks). It launches separate Codex CLI processes, not Codex native subagents. A source checkout, Python 3.11+, Git and authenticated Codex CLI are required. The application itself runs without Codex.

## Unattended planning and delivery

Write a concrete feature brief in a file, then:

```sh
python3 -m factory.planner --brief docs/features/brief.md --run
```

The planning worker inspects the repository and proposes bounded tasks. An independent coordinator reviews that plan against the brief, repository and human-factors guidance. The trusted caller fixes allowed path scopes and checks; AI cannot supply replacement check commands or expand those paths. By default workers may change `tds/`, `web/` and `docs/features/`, with `python3 scripts/check.py` as the acceptance command. Override path boundaries explicitly with repeated `--scope`. The factory does not commit or deploy changes.

A rejected or malformed plan is retained with findings and automatically returned to the planner, for at most three planning revisions within the shared wall-clock allowance. Delivery uses independent QA review and bounded repair attempts; exhausted attempts or budgets become visible blockers, not completion. Execution attempts and review repairs both respect the task attempt cap.

For a prepared plan:

```sh
python3 -m factory.autopilot agents/example-plan.json
```

The plan declares version, allowed scopes, approved role per task, dependency order, acceptance, prompt, trusted argv checks, concurrency, execution budget and maximum repairs. `agents/example-plan.json` is an example template, not a standing background job. Use a separate checkout/state directory for a different approved plan; changing the plan in place cannot silently replace the running factory's mandate.

The unattended loop claims runnable tasks, launches isolated workers, validates structured results and file scopes, runs trusted checks, obtains a separate reviewer decision tied to the patch hash, and integrates verified changes sequentially after combined checks. Worker claims use SQLite transactions and leases. Each attempt gets pinned context and a source/input snapshot, including accepted uncommitted dependency changes. Agent output is separate from its input snapshot.

## Explicit operational commands

```sh
python3 -m factory init --concurrency 2 --total-seconds 7200
python3 -m factory status
python3 -m factory run --workers 2
python3 -m factory pause
python3 -m factory resume
python3 -m factory cancel TASK_ID
python3 -m factory recover
```

`run` executes already-created tasks; it does not invent a backlog or approve work. Use `autopilot` for the review/integration loop. `pause` stops new claims/integrations and allows active attempts to finish; `cancel` terminates the selected active process group. Recovery checks leases and journal state, preserving concurrent manual edits. Status is also shown read-only in the app's Factory view.

For individual task creation/review/integration, consult `python3 -m factory --help` and subcommand help. Actor labels are local audit identifiers, not authenticated security identities. CLI review is a trusted operator action; it records independent inspection rather than proving that an external human or model performed it. Autopilot performs a distinct read-only reviewer invocation and preserves its output.

## Evidence and limits

`.factory/` is ignored by Git. It stores SQLite state, role/context hashes, worker logs, result JSON, artifact patches, checks, reviews, source snapshots and integration journals. Do not remove active worktrees or their state. Preserve evidence before intentionally resetting a project factory. Time, concurrency and retained-output budgets are enforced; provider token/cost quotas are not enforced. The approved plan deadline persists across supervisor restarts. Reviewer attempts use unique evidence directories. CLI rate limits or authentication problems fail an attempt within its bounded retry budget. A worker success message is never sufficient acceptance.

The factory is a trusted local development tool, not a hostile-code sandbox or multi-tenant service. Its subprocesses retain the selected CLI sandbox and approval policy. It does not bypass approvals or give instructions from downloaded skills authority over operating-system permissions. Verification includes real subprocess kills, supervisor interruption, malformed output, stale context, conflicting integration, journal rollback/recovery, bounded repair and no-self-approval checks.

## Coordinator feedback and repair continuity

`python3 -m factory feedback TASK_ID --actor coordinator --message "Concrete artifact finding and required correction"` records an audited clarification without changing scope, acceptance checks or identity. It reaches the next review or attempt; a running CLI process does not receive live stdin injection. Context additions are bounded. Rejected work is restored as unaccepted repair input after checksum/scope verification, so workers can fix findings without recreating unaffected code. The final cumulative patch still needs trusted checks and independent acceptance.

An operator can explicitly extend a task attempt cap with `python3 -m factory amend-budget TASK_ID --actor coordinator --max-attempts 4 --reason "New independently reproduced finding requires one additional repair"`. The amendment records its reason and preserves attempt history, identity, scope and trusted checks. This is an audited exception, not an automatic retry reset.


## Snapshot input budgets and retained manifests

The shared snapshot helper admits at most 5,000 paths, 16 MiB per regular file and 128 MiB total regular-file bytes (including unchanged tracked files; tracked deletions count as paths with zero bytes). Before `git add` can create blobs it enumerates tracked and nonignored untracked paths in the temporary revision index, rejects nested repositories, symlinks/submodules and other special files, and checks these fixed caps. It stages only that explicit list using literal NUL-delimited pathspecs. Membership and device/inode/mode/size/mtime/ctime are rechecked before and after staging; concurrent changes fail the attempt and require an explicit retry. This protects a trusted local repository from accidents, not hostile concurrent writers. A detected race may already have written admitted blobs to Git's object store, but a late unrelated file is never included by a second broad `add -A`. The main index is not changed.

Project-local ignore rules keep retained `artifacts/`, `output/`, generated film frames/encodings/review packets/frozen snapshots, generated production `public/` bundles/evidence metadata and scoped film video/audio out of ambient untracked input. Files stay on disk; tracked files and their edits remain included. Actual renderer source outside those generated directories stays eligible. These rules are operational hygiene, not deletion, history cleanup or a privacy boundary. New ignored task outputs also are not captured automatically: use a tracked fixture or a coordinator-approved source destination; an explicit bounded evidence/input/output admission API is not implemented. Staging a new ignored file in the main index does not opt it into the separate snapshot index. Do not force-add entire evidence directories or silently raise limits to make an attempt pass.

`context.json` and the retained artifact context still contain every `input_hashes` entry. The worker prompt omits only this full map and instead gives its exact count, `../context.json` path, `input_hashes` field and SHA-256 of the UTF-8, sorted-key compact JSON map with `ensure_ascii=True` (the default in `factory.core.encoded`), alongside unchanged pinned contract hashes, input tree/patch identities, owned scopes and role/interface context. Required reading is the pinned contract and skill files. The input manifest is audit metadata: consult only relevant entries when needed and never bulk-load the full hash map. Full context remains available for a bounded evidence read. Lease, contract, artifact and integration integrity checks continue using the retained full context; the prompt summary is not a replacement for validation.

Tracked file/directory replacement refactors use explicit index deletions plus regular leaves. A tracked file now replaced by a directory is removed with literal NUL-delimited `git update-index --force-remove -z --stdin`; the directory is never an argument to `git add`. Old tracked descendants blocked by a new regular parent are likewise deletions. Seed tracked membership and replacement-directory/blocking-parent metadata remain in pre/post checks, so late children cannot enter recursively. Both directions are tested against an independent Git tree oracle and exact patch reconstruction, including newline/pathspec names. Limits and special-mode/race guards are unchanged.
