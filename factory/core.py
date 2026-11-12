"""SQLite leases, immutable evidence, isolated execution and journaled integration.

Only user-supplied checks run. Model output is data. POSIX process groups and
flock are required; root is a trusted local Git repository (not a hostile tenant).
"""

import base64
import ctypes
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import signal
import sqlite3
import stat
import struct
import subprocess
import sys
import time
import threading
import uuid

from .providers import provider
from .validation import task_limit_errors


STATES = ('proposed', 'ready', 'running', 'review', 'verified', 'integrated',
          'failed', 'blocked', 'cancelled')
MAX_OUTPUT = 2 * 1024 * 1024
MAX_SNAPSHOT_FILES = 5000
MAX_SNAPSHOT_FILE_BYTES = 16 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024


class FactoryError(RuntimeError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def atomic_json(path, value):
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with tmp.open('w') as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)
    fsync_dir(path.parent)


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def git(root, *args, env=None, input=None):
    result = subprocess.run(['git', '-C', str(root), *args], input=input,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=env, timeout=60)
    if result.returncode:
        raise FactoryError('git ' + args[0] + ': ' + result.stderr.decode(errors='replace')[:2000])
    return result.stdout


def relative_path(value, directory=False):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        raise FactoryError('Paths must be nonempty relative POSIX paths')
    path = PurePosixPath(value.rstrip('/') if directory else value)
    if path.is_absolute() or any(x in ('..', '.', '.git', '.factory') for x in path.parts):
        raise FactoryError('Unsafe path: ' + value)
    if str(path) != value.rstrip('/') or str(path) == '.':
        raise FactoryError('Noncanonical path: ' + value)
    return str(path) + ('/' if directory and value.endswith('/') else '')


def safe_file(root, name, internal=False):
    if internal and isinstance(name, str) and name.startswith('.factory/attempts/'):
        relative_path(name[len('.factory/'):])
    else:
        relative_path(name)
    path = root / name
    # Neither symlink leaves nor parent symlinks may escape a worktree or root.
    for part in [path, *path.parents]:
        if part == root:
            break
        if part.is_symlink():
            raise FactoryError('Symlink is outside supported factory scope: ' + name)
    if path.exists() and not path.is_file():
        raise FactoryError('Expected regular file: ' + name)
    return path


def in_scope(name, scope):
    return any(name == item or (item.endswith('/') and name.startswith(item)) for item in scope)


def proc_identity(pid):
    try:
        if sys.platform.startswith('linux'):
            data = Path(f'/proc/{pid}/stat').read_text()
            # comm may contain spaces and parentheses; starttime is field 22.
            boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            return 'linux:' + boot + ':' + data[data.rfind(')') + 2:].split()[19]
        if sys.platform == 'darwin':
            lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
            buffer = ctypes.create_string_buffer(136)
            if lib.proc_pidinfo(pid, 3, 0, buffer, 136) == 136:
                fields = struct.unpack('=12I16s32s6I2Q', buffer.raw)
                return 'darwin:' + str(fields[-2]) + ':' + str(fields[-1])
            return ''
        result = subprocess.run(['ps', '-o', 'lstart=', '-p', str(pid)],
                                capture_output=True, timeout=5)
        return result.stdout.decode().strip() if result.returncode == 0 else ''
    except (OSError, subprocess.TimeoutExpired):
        return ''


def kill_group(pid, identity):
    # Never signal a recycled PID or arbitrary session. Workers lead their group.
    if pid and identity and proc_identity(pid) == identity:
        try:
            if os.getpgid(pid) == pid:
                os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


class Factory:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.home = self.root / '.factory'
        self.dbpath = self.home / 'state.sqlite3'

    def init(self, concurrency=1, total_seconds=3600):
        if not isinstance(concurrency, int) or isinstance(concurrency, bool) or not 1 <= concurrency <= 32:
            raise FactoryError('concurrency must be 1..32')
        if not math.isfinite(total_seconds) or total_seconds <= 0:
            raise FactoryError('total_seconds must be finite and positive')
        git(self.root, 'rev-parse', '--verify', 'HEAD')
        if git(self.root, 'rev-parse', '--show-toplevel').decode().strip() != str(self.root):
            raise FactoryError('Use the Git repository root')
        if subprocess.run(['git', '-C', str(self.root), 'check-ignore', '-q', '.factory/state.sqlite3']).returncode:
            raise FactoryError('Add .factory/ to .gitignore before initialization')
        if self.home.is_symlink():
            raise FactoryError('.factory must not be a symlink')
        self.home.mkdir(mode=0o700, exist_ok=True)
        os.chmod(self.home, 0o700)
        with self.connect(create=True) as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS tasks(
                  id TEXT PRIMARY KEY, state TEXT NOT NULL, payload TEXT NOT NULL,
                  attempts INTEGER NOT NULL DEFAULT 0, owner TEXT, lease REAL,
                  heartbeat REAL, pid INTEGER, process_identity TEXT,
                  started REAL, budget REAL, elapsed REAL NOT NULL DEFAULT 0,
                  error TEXT, artifact TEXT, review TEXT, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS events(
                  seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  at REAL NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
            ''')
            columns = {r['name'] for r in db.execute('PRAGMA table_info(tasks)')}
            if 'budget' not in columns:
                db.execute('ALTER TABLE tasks ADD COLUMN budget REAL')
            for key, value in [('paused', False), ('concurrency', concurrency),
                               ('total_seconds', total_seconds)]:
                db.execute('INSERT OR IGNORE INTO settings VALUES (?,?)', (key, encoded(value)))
        return self.status()

    @contextmanager
    def connect(self, create=False, readonly=False):
        if not create and not self.dbpath.exists():
            raise FactoryError('Factory not initialized; run init')
        db = sqlite3.connect(self.dbpath.as_uri() + '?mode=ro', uri=True, timeout=30, isolation_level=None) if readonly else sqlite3.connect(self.dbpath, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        if not readonly:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def event(self, db, task_id, kind, detail):
        db.execute('INSERT INTO events(task_id,at,kind,detail) VALUES(?,?,?,?)',
                   (task_id, time.time(), kind, encoded(detail)))

    def settings(self, db):
        return {r['key']: json.loads(r['value']) for r in db.execute('SELECT * FROM settings')}

    def roles(self):
        path = safe_file(self.root, 'agents/roles.json')
        value = json.loads(path.read_text())
        if value.get('schema_version') != 1 or not isinstance(value.get('roles'), dict):
            raise FactoryError('Invalid approved role registry')
        return value['roles']

    def manifest(self, role):
        roles = self.roles()
        if role not in roles or roles[role]['permissions'].get('sandbox') != 'workspace-write':
            raise FactoryError('Role is not an approved workspace-write template')
        paths = ['AGENTS.md', 'docs/PLAN.md', 'docs/CONTRACT.md', 'agents/roles.json']
        paths += roles[role].get('skills', [])
        hashes = {}
        size = 0
        for name in paths:
            data = safe_file(self.root, name).read_bytes()
            size += len(data)
            hashes[name] = digest(data)
        if size > 128 * 1024:
            raise FactoryError('Context exceeds 128 KiB; reduce approved context explicitly')
        return {'source_revision': git(self.root, 'rev-parse', 'HEAD').decode().strip(),
                'hashes': hashes, 'bytes': size, 'role_template': roles[role]}

    def context_valid(self, task):
        try:
            # HEAD can advance through unrelated commits; content hashes must stay pinned.
            current = self.manifest(task['role'])
            return current['hashes'] == task['context']['hashes']
        except (FactoryError, OSError, ValueError, KeyError):
            return False

    def add(self, *, task_id, role, actor, scope, acceptance, checks, prompt,
            dependencies=(), timeout=300, max_attempts=2, lease_seconds=15,
            provider_name='codex', mock=None):
        limit_errors = task_limit_errors(task_id, timeout, max_attempts, lease_seconds)
        if limit_errors:
            raise FactoryError('; '.join(limit_errors))
        if not isinstance(actor, str) or not actor.strip() or not isinstance(prompt, str) or not prompt.strip():
            raise FactoryError('Explicit actor and prompt are required')
        actor = actor.strip()
        if len(prompt.encode()) > 64 * 1024:
            raise FactoryError('Prompt exceeds 64 KiB')
        if not scope or not isinstance(scope, (list, tuple)):
            raise FactoryError('Explicit nonempty scope required (directory entries end in /)')
        scope = [relative_path(p, directory=True) for p in scope]
        for name in scope:
            safe_file(self.root, name.rstrip('/') + '/__scope_probe__' if name.endswith('/') else name)
        if not isinstance(acceptance, str) or not acceptance.strip():
            raise FactoryError('Explicit acceptance description required')
        if not isinstance(checks, list) or not checks:
            raise FactoryError('At least one trusted check argv required')
        for argv in checks:
            if not isinstance(argv, list) or not argv or not all(isinstance(s, str) and s and '\x00' not in s for s in argv):
                raise FactoryError('Each check must be a nonempty argv list of strings')
        provider(provider_name)
        context = self.manifest(role)
        task = {'id': task_id, 'role': role, 'actor': actor, 'scope': scope,
                'acceptance': acceptance, 'checks': checks, 'prompt': prompt,
                'dependencies': list(dependencies), 'timeout': timeout,
                'max_attempts': max_attempts, 'lease_seconds': lease_seconds,
                'provider': provider_name, 'context': context}
        if mock is not None:
            if provider_name != 'mock':
                raise FactoryError('Mock payload requires mock provider')
            task['mock'] = mock
        with self.transaction() as db:
            for dep in dependencies:
                if not db.execute('SELECT 1 FROM tasks WHERE id=?', (dep,)).fetchone():
                    raise FactoryError('Unknown dependency: ' + dep)
            try:
                db.execute('INSERT INTO tasks(id,state,payload,updated) VALUES(?,?,?,?)',
                           (task_id, 'proposed', encoded(task), time.time()))
            except sqlite3.IntegrityError as exc:
                raise FactoryError('Task already exists') from exc
            self.event(db, task_id, 'proposed', {'context': context})
            self.promote(db)
        return self.task(task_id)

    def promote(self, db):
        for row in db.execute("SELECT * FROM tasks WHERE state IN ('proposed','ready')").fetchall():
            task = json.loads(row['payload'])
            states = [db.execute('SELECT state FROM tasks WHERE id=?', (dep,)).fetchone()[0]
                      for dep in task['dependencies']]
            target = 'ready' if all(s == 'integrated' for s in states) else 'proposed'
            if any(s in ('failed', 'blocked', 'cancelled') for s in states):
                target = 'blocked'
            if row['state'] != target:
                db.execute('UPDATE tasks SET state=?,updated=? WHERE id=?', (target, time.time(), row['id']))
                self.event(db, row['id'], target, {'dependencies': states})

    def task(self, task_id):
        with self.connect() as db:
            row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if not row:
                raise FactoryError('Unknown task: ' + task_id)
            value = dict(row)
            for key in ('payload', 'artifact', 'review'):
                value[key] = json.loads(value[key]) if value[key] else None
            return value

    def status(self):
        if not self.dbpath.exists():
            return {'initialized': False, 'paused': False, 'tasks': [], 'counts': {}}
        with self.connect(readonly=True) as db:
            tasks = []
            for row in db.execute('SELECT * FROM tasks ORDER BY updated,id'):
                task = json.loads(row['payload'])
                tasks.append({key: row[key] for key in ('id', 'state', 'attempts', 'lease', 'heartbeat', 'elapsed', 'error', 'updated')}
                             | {key: task[key] for key in ('role', 'actor', 'scope', 'dependencies', 'provider')})
            settings = self.settings(db)
            return {'initialized': True, **settings, 'tasks': tasks,
                    'counts': {s: sum(t['state'] == s for t in tasks) for s in STATES}}

    def claim(self, provider_name='codex'):
        provider(provider_name)
        now = time.time()
        with self.transaction() as db:
            config = self.settings(db)
            self.promote(db)
            running = db.execute("SELECT * FROM tasks WHERE state='running'").fetchall()
            spent = db.execute('SELECT COALESCE(SUM(elapsed),0) FROM tasks').fetchone()[0]
            # Reserve each active attempt's entire allowance to avoid aggregate
            # time-budget oversubscription by concurrent claimers.
            spent += sum(r['budget'] or 0 for r in running)
            if config['paused'] or len(running) >= config['concurrency'] or spent >= config['total_seconds']:
                return None
            for row in db.execute("SELECT * FROM tasks WHERE state='ready' ORDER BY updated,id").fetchall():
                task = json.loads(row['payload'])
                if task['provider'] != provider_name:
                    continue
                if row['attempts'] >= task['max_attempts']:
                    db.execute("UPDATE tasks SET state='failed',error='attempt budget exhausted',updated=? WHERE id=?", (now, row['id']))
                    self.event(db, row['id'], 'failed', {'reason': 'attempt budget exhausted'})
                    continue
                if not self.context_valid(task):
                    db.execute("UPDATE tasks SET state='blocked',error='stale context',updated=? WHERE id=?", (now, row['id']))
                    self.event(db, row['id'], 'blocked', {'reason': 'stale context'})
                    continue
                owner = uuid.uuid4().hex
                budget = min(task['timeout'], config['total_seconds'] - spent)
                db.execute("UPDATE tasks SET state='running',owner=?,lease=?,heartbeat=?,started=?,budget=?,attempts=attempts+1,error=NULL,artifact=NULL,review=NULL,pid=NULL,process_identity=NULL,updated=? WHERE id=?",
                           (owner, now + task['lease_seconds'], now, now, budget, now, row['id']))
                self.event(db, row['id'], 'running', {'owner': owner, 'attempt': row['attempts'] + 1})
                task.update(owner=owner, attempt=row['attempts'] + 1,
                            execution_budget=budget, previous_error=row['error'],
                            repair_artifact=json.loads(row['artifact']) if row['artifact'] and row['review'] and not json.loads(row['review']).get('approve') else task.get('partial_artifact'))
                return task
        return None

    def heartbeat(self, task_id, owner):
        with self.transaction() as db:
            row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if not row or row['state'] != 'running' or row['owner'] != owner or row['lease'] < time.time():
                return False
            task = json.loads(row['payload'])
            now = time.time()
            db.execute('UPDATE tasks SET lease=?,heartbeat=?,updated=? WHERE id=?',
                       (now + task['lease_seconds'], now, now, task_id))
            return True

    def finish(self, task, *, artifact=None, error=None, blocked=False, partial=None):
        with self.transaction() as db:
            row = db.execute('SELECT * FROM tasks WHERE id=?', (task['id'],)).fetchone()
            if row['state'] != 'running' or row['owner'] != task['owner'] or row['lease'] < time.time():
                return False
            current_spec = json.loads(row['payload'])
            if partial is not None:
                payload = current_spec
                payload['partial_artifact'] = partial
                db.execute('UPDATE tasks SET payload=? WHERE id=?', (encoded(payload), task['id']))
            if artifact is not None:
                state = 'review'
            elif blocked:
                state = 'blocked'
            else:
                state = 'ready' if row['attempts'] < current_spec['max_attempts'] else 'failed'
            now = time.time()
            db.execute('UPDATE tasks SET state=?,error=?,artifact=?,owner=NULL,lease=NULL,pid=NULL,process_identity=NULL,elapsed=elapsed+?,started=NULL,updated=? WHERE id=?',
                       (state, error, encoded(artifact) if artifact else None,
                        max(0, now - row['started']), now, task['id']))
            self.event(db, task['id'], state, {'error': error, 'attempt': row['attempts']})
            self.promote(db)
        return True

    def worktree(self, path, revision):
        git(self.root, 'worktree', 'add', '--detach', str(path), revision)

    def snapshot_inputs(self, workspace, env, admitted=()):
        """Metadata-only accident guard; never hash or stage candidate payloads."""
        names = set(admitted)
        for entry in git(workspace, 'ls-files', '--stage', '-z', env=env).split(b'\0'):
            if not entry:
                continue
            mode, name = entry.split(b'\t', 1)
            if mode.split(b' ', 1)[0] not in (b'100644', b'100755'):
                raise FactoryError('Snapshot rejects symlinks and submodules before staging')
            names.add(name.decode('utf-8'))
        names.update(n.decode('utf-8').rstrip('/') for n in git(
            workspace, 'ls-files', '--others', '--exclude-standard', '-z', env=env).split(b'\0') if n)
        if len(names) > MAX_SNAPSHOT_FILES:
            raise FactoryError(f'Snapshot file-count budget exceeded: {len(names)} > {MAX_SNAPSHOT_FILES}')
        metadata = {}
        total = 0
        for name in sorted(names):
            relative_path(name)
            path = Path(workspace) / name
            # A replaced parent must not let lstat follow a symlink out of root.
            for parent in reversed(path.relative_to(workspace).parents):
                if parent == Path('.'):
                    continue
                ancestor = Path(workspace) / parent
                if ancestor.is_symlink() or (ancestor / '.git').exists():
                    raise FactoryError('Snapshot rejects symlink/nested repository: ' + name[:200])
            try:
                info = path.lstat()
            except FileNotFoundError:
                metadata[name] = None  # Tracked deletion remains in the admitted plan.
                continue
            if not stat.S_ISREG(info.st_mode):
                raise FactoryError('Snapshot rejects nested repository or special file: ' + name[:200])
            if info.st_size > MAX_SNAPSHOT_FILE_BYTES:
                raise FactoryError(f'Snapshot per-file byte budget exceeded: {name[:200]} ({info.st_size} > {MAX_SNAPSHOT_FILE_BYTES})')
            total += info.st_size
            if total > MAX_SNAPSHOT_BYTES:
                raise FactoryError(f'Snapshot total byte budget exceeded: {total} > {MAX_SNAPSHOT_BYTES}; at {name[:200]}')
            metadata[name] = (info.st_dev, info.st_ino, info.st_mode, info.st_size,
                              info.st_mtime_ns, info.st_ctime_ns)
        return metadata

    def snapshot_patch(self, workspace, revision, index_path):
        env = os.environ.copy()
        env['GIT_INDEX_FILE'] = str(index_path)
        git(workspace, 'read-tree', revision, env=env)
        admitted = self.snapshot_inputs(workspace, env)
        if self.snapshot_inputs(workspace, env, admitted) != admitted:
            raise FactoryError('Snapshot inputs changed before staging; retry explicitly')
        if admitted:
            # Literal, NUL-delimited paths handle spaces, newlines and pathspec syntax.
            paths = b''.join(name.encode('utf-8') + b'\0' for name in admitted)
            git(workspace, '--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-',
                '--pathspec-file-nul', env=env, input=paths)
        if self.snapshot_inputs(workspace, env, admitted) != admitted:
            raise FactoryError('Snapshot inputs changed during staging; retry explicitly')
        # Retain the post-staging mode check as defense in depth.
        for entry in git(workspace, 'ls-files', '--stage', '-z', env=env).split(b'\0'):
            if entry and entry.split(b' ', 1)[0] not in (b'100644', b'100755'):
                raise FactoryError('Symlinks and submodules are not supported')
        patch = git(workspace, 'diff', '--cached', '--binary', '--no-ext-diff', '--no-renames', revision, '--', env=env)
        names = git(workspace, 'diff', '--cached', '--name-only', '-z', '--no-renames', revision, '--', env=env)
        return patch, [n.decode('utf-8') for n in names.split(b'\0') if n]

    def validate_scope(self, names, scope):
        for name in names:
            relative_path(name)
            if not in_scope(name, scope):
                raise FactoryError('Out-of-scope change: ' + name)

    def prompt(self, task):
        context = dict(task['context'])
        hashes = context.pop('input_hashes', None)
        if hashes is not None:
            context['input_manifest'] = {
                'path': '../context.json', 'field': 'input_hashes',
                'sha256': digest(encoded(hashes).encode('utf-8')), 'count': len(hashes),
                'encoding': 'UTF-8 JSON, sorted keys, compact separators',
            }
        return ('Approved role template:\n' + task['context']['role_template']['template'] +
                '\nAct as worker ' + task['actor'] + '. Do not approve your own work. No commits.\n'
                'Never use native subagents, side chat APIs, external messaging, cloud deployment, or change user configuration/credentials.\n'
                'Only edit these scope entries (trailing / denotes subtree): ' + encoded(task['scope']) +
                '\nRead the pinned contract and skill files identified in this context envelope: ' + encoded(context) +
                '\ninput_manifest is audit metadata, not required bulk reading. Consult only relevant entries when needed; never bulk-load the full input_hashes map. ' +
                '\nAcceptance: ' + task['acceptance'] + '\nTrusted checks: ' + encoded(task['checks']) +
                '\nTask ' + task['id'] + ':\n' + task['prompt'] +
                ('\nUnaccepted work from a prior attempt has been restored as repair input. Preserve working parts, correct the previous error and review/coordinator findings, and complete missing evidence; independent acceptance is still required.' if task.get('repair_artifact') else '') +
                ('\nPrevious attempt failed: ' + str(task.get('previous_error'))[:2000] + '\nInspect retained attempt evidence before repeating the same approach. Keep file reads and output bounded.' if task.get('previous_error') else '') +
                '\nReturn only the required result JSON. Evidence paths must be actual regular files in this worktree.\n')

    def run_process(self, argv, workspace, log_path, timeout, task=None, stdin_text=''):
        start = time.monotonic()
        identity = ''
        process_record = None
        process_path = log_path.with_suffix('.process.json')
        with log_path.open('wb') as log:
            # Input is a file, avoiding blocked pipe writes with large prompts.
            with log_path.with_suffix('.stdin').open('w+b') as incoming:
                incoming.write(stdin_text.encode())
                incoming.seek(0)
                gate_read, gate_write = os.pipe()
                gate = [sys.executable, str(Path(__file__).with_name('process_gate.py')), str(gate_read), *argv]
                try:
                    process = subprocess.Popen(gate, cwd=workspace, stdin=incoming,
                                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                               pass_fds=(gate_read,), start_new_session=True)
                except BaseException:
                    os.close(gate_write)
                    raise
                finally:
                    os.close(gate_read)
                exceeded = threading.Event()
                reader_errors = []
                def drain():
                    retained = 0
                    try:
                        while True:
                            chunk = process.stdout.read1(65536)
                            if not chunk:
                                break
                            remaining = max(0, MAX_OUTPUT - retained)
                            if remaining:
                                log.write(chunk[:remaining])
                                retained += min(len(chunk), remaining)
                            if len(chunk) > remaining:
                                exceeded.set()
                    except (OSError, ValueError) as error:
                        reader_errors.append(str(error))
                        exceeded.set()
                reader = threading.Thread(target=drain, daemon=True)
                reader.start()
                try:
                    identity = proc_identity(process.pid)
                    if not identity and process.poll() is None:
                        raise FactoryError('Cannot establish safe process identity for recovery')
                    if task:
                        with self.transaction() as db:
                            changed = db.execute("UPDATE tasks SET pid=?,process_identity=? WHERE id=? AND owner=? AND state='running' AND lease>=?",
                                                 (process.pid, identity, task['id'], task['owner'], time.time())).rowcount
                            if not changed:
                                raise FactoryError('Worker lost lease before process launch')
                    process_record = {'pid': process.pid, 'identity': identity, 'active': True,
                                      'supervisor_pid': os.getpid(), 'supervisor_identity': proc_identity(os.getpid()),
                                      'task_id': task['id'] if task else None,
                                      'owner': task['owner'] if task else None}
                    atomic_json(process_path, process_record)
                    os.write(gate_write, b'G')
                    os.close(gate_write)
                    gate_write = None
                    interval = min(1.0, task['lease_seconds'] / 3) if task else 0.2
                    while process.poll() is None:
                        if exceeded.is_set():
                            raise FactoryError('process output budget exceeded')
                        if time.monotonic() - start >= timeout:
                            raise FactoryError('process timeout')
                        if task and not self.heartbeat(task['id'], task['owner']):
                            raise FactoryError('Worker cancelled or lease lost')
                        time.sleep(interval)
                    # Terminate descendants even if a parent exits successfully.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    reader.join(timeout=2)
                    if exceeded.is_set() or reader_errors:
                        raise FactoryError('process output budget exceeded or log read failed')
                    return {'argv': argv, 'returncode': process.returncode,
                            'seconds': time.monotonic() - start, 'log': str(log_path.relative_to(self.root))}
                finally:
                    if gate_write is not None:
                        os.close(gate_write)
                    if process.poll() is None:
                        kill_group(process.pid, identity)
                        if process.poll() is None:
                            # We still own this Popen; identity lookup failure is no reason to leak it.
                            try:
                                os.killpg(process.pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                        process.wait()
                    reader.join(timeout=2)
                    process.stdout.close()
                    if process_record:
                        process_record['active'] = False
                        atomic_json(process_path, process_record)
                    if task:
                        with self.transaction() as db:
                            db.execute('UPDATE tasks SET pid=NULL,process_identity=NULL WHERE id=? AND owner=?', (task['id'], task['owner']))

    def checks(self, task, workspace, attempt_dir, prefix, deadline=None):
        results = []
        for i, argv in enumerate(task['checks']):
            timeout = min(task['timeout'], max(0.001, deadline - time.monotonic())) if deadline else task['timeout']
            result = self.run_process(argv, workspace, attempt_dir / f'{prefix}-{i}.log', timeout,
                                      task=task if 'owner' in task else None)
            results.append(result)
            if result['returncode']:
                raise FactoryError('Acceptance check failed: ' + encoded(result))
        return results

    def result(self, task, workspace, result_path):
        if result_path.stat().st_size > MAX_OUTPUT:
            raise FactoryError('Worker result too large')
        value = json.loads(result_path.read_text())
        if (not isinstance(value, dict) or set(value) != {'schema_version', 'task_id', 'summary', 'evidence'} or
                type(value['schema_version']) is not int or value['schema_version'] != 1 or value['task_id'] != task['id'] or
                not isinstance(value['summary'], str) or not value['summary'].strip() or
                not isinstance(value['evidence'], list) or not value['evidence']):
            raise FactoryError('Malformed worker result schema')
        hashes = {}
        for entry in value['evidence']:
            if (not isinstance(entry, dict) or set(entry) != {'kind', 'path', 'description'} or
                    entry['kind'] not in ('artifact', 'test', 'analysis') or
                    not isinstance(entry['description'], str) or not entry['description'].strip()):
                raise FactoryError('Malformed evidence entry')
            path = safe_file(workspace, entry['path'])
            hashes[entry['path']] = digest(path.read_bytes())
        return value, hashes

    def input_snapshot(self, task, attempt_dir):
        # Root integration writes hold this same DB lock. Capture between
        # integrations, never halfway through their multi-file journal apply.
        with self.transaction() as db:
            row = db.execute('SELECT * FROM tasks WHERE id=?', (task['id'],)).fetchone()
            if row['state'] != 'running' or row['owner'] != task['owner'] or row['lease'] < time.time():
                raise FactoryError('Lease lost before input snapshot')
            revision = task['context']['source_revision']
            input_index = attempt_dir / 'input.index'
            baseline, names = self.snapshot_patch(self.root, revision, input_index)
            env = os.environ.copy()
            env['GIT_INDEX_FILE'] = str(input_index)
            task['baseline_tree'] = git(self.root, 'write-tree', env=env).decode().strip()
            input_files = {n.decode() for n in git(self.root, 'ls-files', '-z', env=env).split(b'\0') if n}
            input_hashes = {n: digest(git(self.root, 'cat-file', 'blob', task['baseline_tree'] + ':' + n))
                            if n in input_files else None for n in set(names) | set(task['context']['hashes'])}
            if any(input_hashes[n] != h for n, h in task['context']['hashes'].items()):
                raise FactoryError('stale context in input snapshot')
            task['context'] = {**task['context'], 'input_tree': task['baseline_tree'],
                               'input_patch_sha256': digest(baseline), 'input_hashes': input_hashes}
            if not self.context_valid(task):
                raise FactoryError('stale context')
            now = time.time()
            db.execute('UPDATE tasks SET heartbeat=?,lease=? WHERE id=?',
                       (now, now + task['lease_seconds'], task['id']))
            return baseline

    def run_once(self, provider_name='codex'):
        task = self.claim(provider_name)
        if task is None:
            return None
        attempt_dir = self.home / 'attempts' / task['id'] / str(task['attempt'])
        workspace = attempt_dir / 'worktree'
        attempt_dir.mkdir(parents=True)
        deadline = time.monotonic() + task['execution_budget']
        try:
            # Include current local source and integrated dependency artifacts,
            # even when the coordinator has intentionally created no commits.
            # A Git tree is a content-addressed snapshot, not a commit.
            baseline = self.input_snapshot(task, attempt_dir)
            atomic_json(attempt_dir / 'context.json', task['context'])
            self.worktree(workspace, task['context']['source_revision'])
            if baseline:
                git(workspace, 'apply', '--binary', '-', input=baseline)
            (attempt_dir / 'input.patch').write_bytes(baseline)
            repair = task.get('repair_artifact')
            if repair:
                repair_patch = safe_file(self.root, repair['patch'], internal=True).read_bytes()
                if digest(repair_patch) != repair['sha256']:
                    raise FactoryError('Rejected artifact changed before repair')
                self.validate_scope(repair['files'], task['scope'])
                git(workspace, 'read-tree', task['baseline_tree'])
                if repair_patch:
                    git(workspace, 'apply', '--3way', '--binary', '-', input=repair_patch)
                atomic_json(attempt_dir / 'repair-input.json', {'patch': repair['patch'], 'sha256': repair['sha256']})

            command = provider(provider_name).command(task, workspace, attempt_dir)
            prompt_text = self.prompt(task)
            if len(prompt_text.encode()) > 256 * 1024:
                raise FactoryError('Context exceeds 256 KiB prompt budget; reconcile input explicitly')
            record = self.run_process(command, workspace, attempt_dir / 'worker.log',
                                      max(0.001, deadline - time.monotonic()), task, prompt_text)
            if record['returncode']:
                raise FactoryError('Worker exited: ' + str(record['returncode']))
            value, evidence = self.result(task, workspace, attempt_dir / 'result.json')
            # Capture only worker changes, excluding the pinned context baseline.
            artifact = self.capture(task, workspace, attempt_dir)
            before_checks = artifact['sha256']
            checks = self.checks(task, workspace, attempt_dir, 'acceptance', deadline)
            artifact = self.capture(task, workspace, attempt_dir)
            if artifact['sha256'] != before_checks:
                raise FactoryError('Acceptance checks modified task artifacts')
            if not self.context_valid(task):
                raise FactoryError('stale context')
            artifact.update(result=value, evidence=evidence, checks=checks, worker=record,
                            context=task['context'],
                            workspace=str(workspace.relative_to(self.root)))
            atomic_json(attempt_dir / 'evidence.json', artifact)
            self.finish(task, artifact=artifact)
        except (Exception, KeyboardInterrupt) as exc:
            partial = None
            if workspace.is_dir() and task.get('baseline_tree'):
                try:
                    partial = self.capture(task, workspace, attempt_dir)
                    partial['incomplete_reason'] = str(exc)[:2000]
                    atomic_json(attempt_dir / 'partial-evidence.json', partial)
                except (FactoryError, OSError, ValueError):
                    pass  # Unscoped/unsafe changes remain isolated, never adopted.
            self.finish(task, error=str(exc), blocked='stale context' in str(exc) or 'Context exceeds' in str(exc), partial=partial)
            if isinstance(exc, KeyboardInterrupt):
                raise
        return self.task(task['id'])

    def capture(self, task, workspace, attempt_dir):
        # Diff the pinned complete input tree; existing local changes are inputs,
        # never claimed as worker output. The shared index is untouched.
        revision = task['baseline_tree']
        index_path = attempt_dir / 'artifact.index'
        patch, names = self.snapshot_patch(workspace, revision, index_path)
        self.validate_scope(names, task['scope'])
        for name in names:
            safe_file(workspace, name)
        patch_path = attempt_dir / 'artifact.patch'
        patch_path.write_bytes(patch)
        return {'patch': str(patch_path.relative_to(self.root)), 'sha256': digest(patch), 'files': names}

    def salvage(self, task_id, *, actor):
        """Recover scoped incomplete work from an older supervisor as unaccepted input."""
        if not isinstance(actor, str) or not actor.strip():
            raise FactoryError('Salvage requires an explicit coordinator actor')
        row = self.task(task_id)
        if row['state'] not in ('ready', 'blocked', 'failed') or row['review'] or not row['attempts']:
            raise FactoryError('Only an inactive, unreviewed incomplete attempt can be salvaged')
        attempt_dir = self.home / 'attempts' / task_id / str(row['attempts'])
        marker = safe_file(self.root, str((attempt_dir / 'worktree' / 'AGENTS.md').relative_to(self.root)), internal=True)
        if not marker.is_file():
            raise FactoryError('Incomplete attempt worktree is missing')
        context = json.loads((attempt_dir / 'context.json').read_text())
        task = {**row['payload'], 'baseline_tree': context['input_tree']}
        partial = self.capture(task, marker.parent, attempt_dir)
        partial['incomplete_reason'] = row['error'] or 'incomplete attempt'
        atomic_json(attempt_dir / 'partial-evidence.json', partial)
        with self.transaction() as db:
            current = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if current['state'] != row['state'] or current['attempts'] != row['attempts']:
                raise FactoryError('Task changed during salvage')
            payload = json.loads(current['payload'])
            payload['partial_artifact'] = partial
            db.execute('UPDATE tasks SET payload=?,updated=? WHERE id=?', (encoded(payload), time.time(), task_id))
            self.event(db, task_id, 'partial_salvaged', {'actor': actor.strip(), 'sha256': partial['sha256'], 'files': partial['files']})
        return self.task(task_id)

    def amend_budget(self, task_id, *, actor, reason, max_attempts):
        """Explicit local coordinator amendment; never resets attempts or checks."""
        if not isinstance(actor, str) or not actor.strip() or not isinstance(reason, str) or not reason.strip():
            raise FactoryError('Budget amendment requires actor and reason')
        with self.transaction() as db:
            row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if not row or row['state'] in ('verified', 'integrated', 'cancelled'):
                raise FactoryError('Only unfinished, unverified tasks can receive a budget amendment')
            payload = json.loads(row['payload'])
            errors = task_limit_errors(task_id, payload['timeout'], max_attempts, payload['lease_seconds'])
            if errors or max_attempts < row['attempts']:
                raise FactoryError('; '.join(errors) or 'Cannot erase already consumed attempts')
            previous = payload['max_attempts']
            payload['max_attempts'] = max_attempts
            db.execute('UPDATE tasks SET payload=?,updated=? WHERE id=?', (encoded(payload), time.time(), task_id))
            self.event(db, task_id, 'budget_amended', {'actor': actor.strip(), 'reason': reason.strip(), 'previous_max_attempts': previous, 'max_attempts': max_attempts, 'attempts_consumed': row['attempts']})
        return self.task(task_id)

    def feedback(self, task_id, *, actor, message):
        """Audited guidance for the next review/attempt, not live stdin injection."""
        if not isinstance(actor, str) or not actor.strip() or not isinstance(message, str) or not message.strip() or len(message.encode()) > 8000:
            raise FactoryError('Feedback requires an actor and 1..8000 bytes of guidance')
        with self.transaction() as db:
            row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if not row or row['state'] in ('integrated', 'cancelled', 'failed'):
                raise FactoryError('Feedback requires an unfinished task')
            payload = json.loads(row['payload'])
            prompt = payload['prompt'] + '\nCOORDINATOR FEEDBACK (' + actor.strip() + '):\n' + message.strip()
            if len(prompt.encode()) > 64 * 1024:
                raise FactoryError('Feedback would exceed the task context allowance')
            payload['prompt'] = prompt
            db.execute('UPDATE tasks SET payload=?,updated=? WHERE id=?', (encoded(payload), time.time(), task_id))
            if row['state'] == 'verified':
                db.execute("UPDATE tasks SET state='review',review=NULL WHERE id=?", (task_id,))
            self.event(db, task_id, 'coordinator_feedback', {'actor': actor.strip(), 'message': message.strip()})
        return self.task(task_id)

    def review(self, task_id, *, actor, role, approve, notes, expected_task_hash=None):
        if not actor.strip() or not notes.strip():
            raise FactoryError('Reviewer actor and artifact inspection notes required')
        actor = actor.strip()
        row = self.task(task_id)
        task = row['payload']
        task_hash = digest(encoded(task).encode())
        if expected_task_hash is not None and expected_task_hash != task_hash:
            raise FactoryError('Task guidance changed during review; review the current assignment')
        roles = self.roles()
        if actor.casefold() == task['actor'].casefold() or role == task['role']:
            raise FactoryError('Worker cannot self approve: distinct actor AND role required')
        if role not in roles or not roles[role]['permissions'].get('review'):
            raise FactoryError('Unapproved reviewer role')
        if row['state'] != 'review' or not row['artifact']:
            raise FactoryError('Task is not awaiting review')
        if not self.context_valid(task):
            raise FactoryError('stale context; cancel and create a fresh task')
        artifact = row['artifact']
        if not artifact['checks'] or any(c['returncode'] for c in artifact['checks']):
            raise FactoryError('Successful deterministic checks required')
        patch = safe_file(self.root, artifact['patch'], internal=True).read_bytes()
        if digest(patch) != artifact['sha256']:
            raise FactoryError('Artifact hash mismatch')
        decision = {'actor': actor, 'role': role, 'approve': bool(approve), 'notes': notes,
                    'artifact_sha256': artifact['sha256'], 'task_spec_sha256': task_hash, 'at': time.time()}
        with self.transaction() as db:
            current = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if current['state'] != 'review' or current['artifact'] != encoded(artifact) or current['payload'] != encoded(task):
                raise FactoryError('Review raced another transition')
            state = 'verified' if approve else 'blocked'
            db.execute('UPDATE tasks SET state=?,review=?,updated=? WHERE id=?', (state, encoded(decision), time.time(), task_id))
            self.event(db, task_id, state, decision)
        return self.task(task_id)

    @contextmanager
    def integration_lock(self, blocking=True):
        with (self.home / 'integration.lock').open('a') as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
            except BlockingIOError as exc:
                raise FactoryError('Integration/recovery already active') from exc
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def file_value(self, workspace, name):
        path = safe_file(workspace, name)
        if not path.exists():
            return None
        return {'data': base64.b64encode(path.read_bytes()).decode(),
                'mode': stat.S_IMODE(path.stat().st_mode)}

    def write_value(self, name, value):
        path = safe_file(self.root, name)
        if value is None:
            if path.exists():
                path.unlink()
                fsync_dir(path.parent)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name('.factory-write-' + uuid.uuid4().hex)
        try:
            with tmp.open('xb') as stream:
                stream.write(base64.b64decode(value['data']))
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(tmp, value['mode'])
            os.replace(tmp, path)
            fsync_dir(path.parent)
        finally:
            if tmp.exists():
                tmp.unlink()

    def restore_journal(self, journal):
        # Preflight every path before restoring any: never overwrite third-party edits.
        for name, record in journal['files'].items():
            current = self.file_value(self.root, name)
            if current != record['before'] and current != record['after']:
                raise FactoryError('Rollback needs manual inspection; concurrent edit: ' + name)
        for name, record in journal['files'].items():
            self.write_value(name, record['before'])
        journal['phase'] = 'rolled_back'
        atomic_json(self.home / 'integration.json', journal)

    def integrate(self, task_id):
        with self.integration_lock():
            journal_path = self.home / 'integration.json'
            if journal_path.exists() and json.loads(journal_path.read_text())['phase'] == 'applying':
                raise FactoryError('Incomplete integration; run recover first')
            row = self.task(task_id)
            task, artifact, review = row['payload'], row['artifact'], row['review']
            if row['state'] != 'verified' or not review or not review['approve']:
                raise FactoryError('Independent approval required')
            if review['actor'].casefold() == task['actor'].casefold() or review['role'] == task['role'] or review['artifact_sha256'] != artifact['sha256']:
                raise FactoryError('Invalid independent review binding')
            if review.get('task_spec_sha256') != digest(encoded(task).encode()):
                raise FactoryError('Assignment changed after independent review')
            if not self.context_valid(task):
                raise FactoryError('stale context')
            if self.status()['paused']:
                raise FactoryError('Factory paused')
            patch = safe_file(self.root, artifact['patch'], internal=True).read_bytes()
            if digest(patch) != artifact['sha256']:
                raise FactoryError('Artifact hash mismatch')
            self.validate_scope(artifact['files'], task['scope'])
            attempt_dir = self.home / 'integrations' / (task_id + '-' + uuid.uuid4().hex)
            attempt_dir.mkdir(parents=True)
            candidate = attempt_dir / 'worktree'
            revision = git(self.root, 'rev-parse', 'HEAD').decode().strip()
            root_patch, _ = self.snapshot_patch(self.root, revision, attempt_dir / 'root.index')
            self.worktree(candidate, revision)
            journal = None
            try:
                if root_patch:
                    git(candidate, 'apply', '--binary', '-', input=root_patch)
                # Stage combined baseline, then three-way merge the independently
                # reviewed task patch. Git never mutates root's index or HEAD.
                git(candidate, 'add', '-A', '--', '.')
                if patch:
                    git(candidate, 'apply', '--3way', '--binary', '-', input=patch)
                before = {name: self.file_value(self.root, name) for name in artifact['files']}
                after = {name: self.file_value(candidate, name) for name in artifact['files']}
                candidate_patch, _ = self.snapshot_patch(candidate, revision, attempt_dir / 'candidate.index')
                results = self.checks(task, candidate, attempt_dir, 'combined')
                after_checks, _ = self.snapshot_patch(candidate, revision, attempt_dir / 'checked.index')
                if candidate_patch != after_checks:
                    raise FactoryError('Combined checks modified artifacts')
                current_patch, _ = self.snapshot_patch(self.root, revision, attempt_dir / 'recheck.index')
                if root_patch != current_patch or git(self.root, 'rev-parse', 'HEAD').decode().strip() != revision:
                    raise FactoryError('Shared workspace changed during integration; retry')
                if not self.context_valid(task):
                    raise FactoryError('stale context')
                journal = {'task_id': task_id, 'phase': 'applying', 'artifact_sha256': artifact['sha256'],
                           'files': {n: {'before': before[n], 'after': after[n]} for n in artifact['files']},
                           'checks': results, 'source_revision': revision}
                # Keep database lock over root mutation so cancel/pause cannot race.
                with self.transaction() as db:
                    current = db.execute('SELECT state,payload,review FROM tasks WHERE id=?', (task_id,)).fetchone()
                    if current['state'] != 'verified' or current['payload'] != encoded(task) or current['review'] != encoded(review) or self.settings(db)['paused']:
                        raise FactoryError('Task state changed before integration')
                    atomic_json(journal_path, journal)
                    try:
                        for name, value in after.items():
                            if self.file_value(self.root, name) != before[name]:
                                raise FactoryError('Concurrent edit: ' + name)
                            self.write_value(name, value)
                        db.execute("UPDATE tasks SET state='integrated',updated=? WHERE id=?", (time.time(), task_id))
                        self.event(db, task_id, 'integrated', {'checks': results, 'sha256': artifact['sha256']})
                        self.promote(db)
                    except BaseException:
                        self.restore_journal(journal)
                        raise
                journal['phase'] = 'complete'
                atomic_json(journal_path, journal)
            except Exception as exc:
                with self.transaction() as db:
                    db.execute("UPDATE tasks SET error=?,updated=? WHERE id=?", (str(exc), time.time(), task_id))
                    self.event(db, task_id, 'integration_failed', {'error': str(exc)})
                raise
        return self.task(task_id)

    def pause(self):
        with self.transaction() as db:
            db.execute("UPDATE settings SET value='true' WHERE key='paused'")
            self.event(db, None, 'paused', {})
        return self.status()

    def resume(self, task_id=None):
        with self.transaction() as db:
            if task_id:
                row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
                if not row or row['state'] not in ('cancelled', 'blocked', 'failed'):
                    raise FactoryError('Only cancelled, blocked or failed tasks can resume')
                task = json.loads(row['payload'])
                if row['attempts'] >= task['max_attempts']:
                    raise FactoryError('Attempt budget exhausted; create a fresh task')
                if not self.context_valid(task):
                    raise FactoryError('stale context; create a fresh task')
                if row['artifact'] and row['review'] and not json.loads(row['review']).get('approve'):
                    db.execute("UPDATE tasks SET state='proposed',error=NULL,updated=? WHERE id=?", (time.time(), task_id))
                else:
                    db.execute("UPDATE tasks SET state='proposed',error=NULL,review=NULL,artifact=NULL,updated=? WHERE id=?", (time.time(), task_id))
                self.event(db, task_id, 'resumed', {})
            else:
                db.execute("UPDATE settings SET value='false' WHERE key='paused'")
                self.event(db, None, 'resumed', {})
            self.promote(db)
        return self.status()

    def cancel(self, task_id):
        with self.transaction() as db:
            row = db.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone()
            if not row or row['state'] == 'integrated':
                raise FactoryError('Unknown or integrated task cannot be cancelled')
            elapsed = max(0, time.time() - row['started']) if row['started'] else 0
            db.execute("UPDATE tasks SET state='cancelled',owner=NULL,lease=NULL,elapsed=elapsed+?,started=NULL,updated=? WHERE id=?", (elapsed, time.time(), task_id))
            self.event(db, task_id, 'cancelled', {})
            self.promote(db)
        kill_group(row['pid'], row['process_identity'])
        return self.task(task_id)

    def recover(self):
        recovered = []
        with self.integration_lock(blocking=False):
            journal_path = self.home / 'integration.json'
            if journal_path.exists():
                journal = json.loads(journal_path.read_text())
                if journal['phase'] == 'applying':
                    row = self.task(journal['task_id'])
                    if row['state'] == 'integrated':
                        # DB commit is authoritative; files must match committed evidence.
                        if any(self.file_value(self.root, n) != v['after'] for n, v in journal['files'].items()):
                            raise FactoryError('Integrated journal files changed; manual inspection required')
                        journal['phase'] = 'complete'
                        atomic_json(journal_path, journal)
                    else:
                        self.restore_journal(journal)
                    recovered.append(journal['task_id'])
            with self.transaction() as db:
                rows = db.execute("SELECT * FROM tasks WHERE state='running' AND lease < ?", (time.time(),)).fetchall()
                for row in rows:
                    kill_group(row['pid'], row['process_identity'])
                    task = json.loads(row['payload'])
                    state = 'ready' if row['attempts'] < task['max_attempts'] else 'failed'
                    db.execute('UPDATE tasks SET state=?,error=?,owner=NULL,lease=NULL,pid=NULL,process_identity=NULL,elapsed=elapsed+?,started=NULL,updated=? WHERE id=?',
                               (state, 'expired lease recovered', max(0, time.time() - row['started']), time.time(), row['id']))
                    self.event(db, row['id'], 'recovered', {'state': state})
                    recovered.append(row['id'])
                self.promote(db)
            # A supervisor can also die while running combined integration
            # checks. Their gated process records are separate from task leases.
            records = [*self.home.glob('attempts/*/*/*.process.json'),
                       *self.home.glob('integrations/*/*.process.json')]
            for path in records:
                record = json.loads(path.read_text())
                if not record['active']:
                    continue
                if record['task_id']:
                    row = self.task(record['task_id'])
                    if row['state'] == 'running' and row['owner'] == record['owner'] and row['lease'] >= time.time():
                        continue
                elif (record['supervisor_identity'] and
                      proc_identity(record['supervisor_pid']) == record['supervisor_identity']):
                    continue
                kill_group(record['pid'], record['identity'])
                record['active'] = False
                atomic_json(path, record)
        return {'recovered': recovered, **self.status()}


def status(root) -> dict:
    """Read-only dashboard entry point; no worker launches or recovery side effects."""
    return Factory(root).status()
