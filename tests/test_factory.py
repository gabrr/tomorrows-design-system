"""Real subprocess/Git/SQLite fault tests in disposable repositories only."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from factory import Factory, FactoryError, status
from factory.core import atomic_json, proc_identity
from factory.providers import CodexProvider, PROVIDERS


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


class FactoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        (self.root / '.gitignore').write_text('.factory/\n__pycache__/\n')
        for name in ('AGENTS.md', 'docs/PLAN.md', 'docs/CONTRACT.md'):
            path = self.root / name
            path.parent.mkdir(exist_ok=True)
            path.write_text('Pinned contract v1\n')
        (self.root / 'agents').mkdir()
        shutil.copy(PACKAGE_ROOT / 'agents/roles.json', self.root / 'agents/roles.json')
        roles = json.loads((self.root / 'agents/roles.json').read_text())['roles']
        for role in roles.values():
            for name in role['skills']:
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('Approved bounded role skill\n')
        (self.root / 'existing.txt').write_text('base\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Factory Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'fixture')
        self.f = Factory(self.root)
        self.f.init(concurrency=2)

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.STDOUT)

    def add(self, task_id='one', **kwargs):
        values = dict(task_id=task_id, role='backend', actor='worker-1', scope=['a.txt'],
                      acceptance='a.txt contains accepted implementation',
                      checks=[[sys.executable, '-c', "from pathlib import Path; assert Path('a.txt').read_text() == 'accepted\\n'"]],
                      prompt='Implement a.txt with accepted content', provider_name='mock',
                      # Non-lease tests use Factory.add's production lease. A
                      # 0.5s fixture lease can expire during Git/fsync preparation
                      # before a worker heartbeat, changing the scenario tested.
                      mock={'files': {'a.txt': 'accepted\n'}}, timeout=5)
        values.update(kwargs)
        return self.f.add(**values)

    def approved(self, task_id='one', **kwargs):
        self.add(task_id, **kwargs)
        result = self.f.run_once('mock')
        self.assertEqual(result['state'], 'review', result['error'])
        self.f.review(task_id, actor='reviewer-2', role='qa', approve=True,
                      notes='Inspected actual artifact and passing acceptance log; no unsupported assumptions.')
        return self.f.task(task_id)

    def child(self, script=None, *args):
        env = os.environ.copy()
        env['PYTHONPATH'] = str(PACKAGE_ROOT)
        command = [sys.executable, '-c', script, str(self.root), *args] if script else [sys.executable, '-m', 'factory', '--root', str(self.root), *args]
        return subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def wait_pid(self, task_id='one', child=None, require_heartbeat=False):
        deadline = time.monotonic() + 8
        observed = None
        while time.monotonic() < deadline:
            row = self.f.task(task_id)
            if row['pid']:
                if not require_heartbeat or (observed and observed[0] == row['pid'] and
                                             row['heartbeat'] > observed[1]):
                    return row['pid']
                if observed is None or observed[0] != row['pid']:
                    observed = (row['pid'], row['heartbeat'])
            if child is not None and child.poll() is not None:
                stdout, stderr = child.communicate(timeout=5)
                logs = sorted((self.f.home / 'attempts' / task_id).glob('*/worker.log'))
                tail = logs[-1].read_text(errors='replace')[-2000:] if logs else '(no worker log)'
                self.fail(f"supervisor exited before worker readiness: exit={child.returncode}, "
                          f"state={row['state']}, lease={row['lease']}, pid={row['pid']}; "
                          f"stdout={stdout[-2000:]!r}; stderr={stderr[-2000:]!r}; worker={tail}")
            time.sleep(0.02)
        self.fail(f"worker readiness deadline expired: state={row['state']}, "
                  f"lease={row['lease']}, pid={row['pid']}, heartbeat={row['heartbeat']}")

    def snapshot(self):
        return self.f.snapshot_patch(self.root, self.git('rev-parse', 'HEAD').decode().strip(),
                                     self.f.home / 'test-input.index')

    def test_snapshot_rejects_budgets_and_special_inputs_before_blob_staging(self):
        from factory.core import git as real_git
        cases = [
            ('per-file', {'MAX_SNAPSHOT_FILE_BYTES': 8}, 'large.txt'),
            ('total', {'MAX_SNAPSHOT_BYTES': 8}, 'large.txt'),
            ('file-count', {'MAX_SNAPSHOT_FILES': 1}, 'large.txt'),
            ('nested', {}, 'nested'),
            ('special', {}, 'link'),
        ]
        for label, limits, name in cases:
            with self.subTest(label=label):
                path = self.root / name
                if label == 'nested':
                    path.mkdir()
                    subprocess.check_call(['git', 'init', '-q', str(path)])
                elif label == 'special':
                    path.symlink_to('existing.txt')
                else:
                    path.write_text('large fixture content')
                before = self.git('count-objects', '-v')
                with patch.multiple('factory.core', **({'MAX_SNAPSHOT_FILES': 5000} | limits)), patch('factory.core.git', wraps=real_git) as calls:
                    with self.assertRaises(FactoryError):
                        self.snapshot()
                    self.assertFalse(any('add' in c.args[1:] for c in calls.call_args_list))
                self.assertEqual(self.git('count-objects', '-v'), before)
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()

    def test_snapshot_does_not_sweep_late_files_or_accept_metadata_changes(self):
        from factory.core import git as real_git
        for change in ('new', 'edit'):
            with self.subTest(change=change):
                (self.root / 'admitted.txt').write_text('original')
                def racing_git(root, *args, **kwargs):
                    if 'add' in args:
                        if change == 'new':
                            (self.root / 'late.txt').write_text('never stage me')
                        else:
                            (self.root / 'admitted.txt').write_text('concurrent replacement')
                    return real_git(root, *args, **kwargs)
                with patch('factory.core.git', side_effect=racing_git):
                    with self.assertRaisesRegex(FactoryError, 'changed during staging'):
                        self.snapshot()
                env = {**os.environ, 'GIT_INDEX_FILE': str(self.f.home / 'test-input.index')}
                staged = real_git(self.root, 'ls-files', '-z', env=env).split(b'\0')
                self.assertNotIn(b'late.txt', staged)
                (self.root / 'admitted.txt').unlink()
                (self.root / 'late.txt').unlink(missing_ok=True)

    def test_snapshot_preserves_literal_names_user_edits_and_deletions(self):
        (self.root / 'existing.txt').write_text('user edit preserved')
        names = ['space name.txt', 'line\nbreak.txt', ':(glob)*.txt', '-option.txt']
        for name in names:
            (self.root / name).write_text('dependency input')
        (self.root / 'docs/PLAN.md').unlink()
        index_before = (self.root / '.git/index').read_bytes()
        patch_bytes, changed = self.snapshot()
        self.assertEqual(set(changed), set(names + ['existing.txt', 'docs/PLAN.md']))
        self.assertIn(b'user edit preserved', patch_bytes)
        self.assertEqual((self.root / '.git/index').read_bytes(), index_before)

    def assert_snapshot_refactor(self, to_directory):
        from factory.core import git as real_git
        names = ['config', 'odd\nname', ':(glob)*']
        old, new = set(), set()
        for name in names:
            path = self.root / name
            if to_directory:
                path.write_text('old file')
                old.add(name)
            else:
                path.mkdir()
                (path / 'default.json').write_text('old child')
                old.add(name + '/default.json')
        self.git('--literal-pathspecs', 'add', '--', *names)
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'tracked refactor baseline')
        revision = self.git('rev-parse', 'HEAD').decode().strip()
        for name in names:
            path = self.root / name
            if to_directory:
                path.unlink()
                path.mkdir()
                for child in ['default.json', '-child']:
                    (path / child).write_text('new child ' + name)
                    new.add(name + '/' + child)
            else:
                (path / 'default.json').unlink()
                path.rmdir()
                path.write_text('replacement file ' + name)
                new.add(name)
        main_index = (self.root / '.git/index').read_bytes()
        with patch('factory.core.git', wraps=real_git) as calls:
            patch_bytes, changed = self.snapshot()
        self.assertEqual(set(changed), old | new)
        removes = [c for c in calls.call_args_list if c.args[1] == 'update-index']
        self.assertEqual(len(removes), 1)
        self.assertEqual(set(removes[0].kwargs['input'].split(b'\0')[:-1]), {n.encode() for n in old})
        adds = [c for c in calls.call_args_list if 'add' in c.args[1:]]
        self.assertEqual(len(adds), 1)
        add_names = {n.decode() for n in adds[0].kwargs['input'].split(b'\0')[:-1]}
        self.assertTrue(new <= add_names)
        self.assertTrue(old.isdisjoint(add_names))
        self.assertTrue(all((self.root / n).is_file() for n in add_names))
        # Independent Git oracle is confined to this disposable fixture.
        env = {**os.environ, 'GIT_INDEX_FILE': str(self.f.home / 'oracle.index')}
        real_git(self.root, 'read-tree', revision, env=env)
        real_git(self.root, 'add', '-A', '--', '.', env=env)
        expected_tree = real_git(self.root, 'write-tree', env=env)
        env['GIT_INDEX_FILE'] = str(self.f.home / 'test-input.index')
        self.assertEqual(real_git(self.root, 'write-tree', env=env), expected_tree)
        rebuilt = self.f.home / 'rebuilt'
        self.git('worktree', 'add', '--detach', str(rebuilt), revision)
        real_git(rebuilt, 'apply', '--binary', '-', input=patch_bytes)
        regular_files = lambda directory: {
            n.relative_to(directory).as_posix(): n.read_bytes()
            for n in directory.rglob('*') if n.is_file()
            and not any(part in ('.git', '.factory') for part in n.relative_to(directory).parts)
        }
        self.assertEqual(regular_files(rebuilt), regular_files(self.root))
        self.assertEqual((self.root / '.git/index').read_bytes(), main_index)

    def test_snapshot_tracked_file_to_directory_roundtrip_and_literal_deletions(self):
        self.assert_snapshot_refactor(True)

    def test_snapshot_tracked_directory_to_file_roundtrip_and_literal_deletions(self):
        self.assert_snapshot_refactor(False)

    def test_snapshot_refactor_late_child_is_not_recursively_staged(self):
        from factory.core import git as real_git
        path = self.root / 'config'
        path.write_text('tracked file')
        self.git('add', '--', 'config')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'refactor baseline')
        path.unlink()
        path.mkdir()
        (path / 'admitted.txt').write_text('admitted child')
        main_index = (self.root / '.git/index').read_bytes()
        def racing_git(root, *args, **kwargs):
            if 'add' in args:
                names = kwargs['input'].split(b'\0')
                self.assertNotIn(b'config', names)
                self.assertIn(b'config/admitted.txt', names)
                (path / 'late.txt').write_text('must not be swept')
            return real_git(root, *args, **kwargs)
        with patch('factory.core.git', side_effect=racing_git):
            with self.assertRaisesRegex(FactoryError, 'changed during staging'):
                self.snapshot()
        env = {**os.environ, 'GIT_INDEX_FILE': str(self.f.home / 'test-input.index')}
        staged = real_git(self.root, 'ls-files', '-z', env=env).split(b'\0')
        self.assertNotIn(b'config/late.txt', staged)
        self.assertNotIn(b'config', staged)
        self.assertIn(b'config/admitted.txt', staged)
        self.assertEqual((self.root / '.git/index').read_bytes(), main_index)

    def test_snapshot_refactor_still_rejects_special_replacements_before_add(self):
        from factory.core import git as real_git
        path = self.root / 'config'
        path.write_text('tracked file')
        self.git('add', '--', 'config')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'refactor baseline')
        path.unlink()
        for kind in ['nested', 'symlink', 'fifo']:
            with self.subTest(kind=kind):
                if kind == 'nested':
                    subprocess.check_call(['git', 'init', '-q', str(path)])
                elif kind == 'symlink':
                    path.symlink_to('existing.txt')
                else:
                    os.mkfifo(path)
                before = self.git('count-objects', '-v')
                with patch('factory.core.git', wraps=real_git) as calls:
                    with self.assertRaises(FactoryError):
                        self.snapshot()
                self.assertFalse(any('add' in c.args[1:] for c in calls.call_args_list))
                self.assertEqual(self.git('count-objects', '-v'), before)
                if kind == 'nested':
                    shutil.rmtree(path)
                else:
                    path.unlink()

    def test_prompt_compacts_hashes_but_retains_complete_context_and_artifact(self):
        self.add()
        task = self.f.claim('mock')
        attempt = self.f.home / 'attempts' / task['id'] / str(task['attempt'])
        attempt.mkdir(parents=True)
        (self.root / 'dependency.txt').write_text('accepted dependency input')
        self.f.input_snapshot(task, attempt)
        self.assertIn('dependency.txt', task['context']['input_hashes'])
        full_hashes = {f'path-{i}.txt': 'a' * 64 for i in range(5000)}
        task['context']['input_hashes'].update(full_hashes)
        atomic_json(attempt / 'context.json', task['context'])
        before = json.loads((attempt / 'context.json').read_text())
        prompt_text = self.f.prompt(task)
        self.assertLess(len(prompt_text.encode()), 256 * 1024)
        self.assertNotIn('path-4999.txt', prompt_text)
        from factory.core import digest, encoded
        self.assertIn(digest(encoded(before['input_hashes']).encode()), prompt_text)
        self.assertIn('../context.json', prompt_text)
        self.assertIn('Read the pinned contract and skill files', prompt_text)
        self.assertIn('input_manifest is audit metadata', prompt_text)
        self.assertIn('never bulk-load the full input_hashes map', prompt_text)
        self.assertIn(task['context']['input_tree'], prompt_text)
        self.assertEqual(task['context'], before)
        # Normal execution still retains every actual input hash in its artifact.
        self.f.finish(task, error='fixture released claim')
        row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'review', row['error'])
        context = row['artifact']['context']
        self.assertIn('dependency.txt', context['input_hashes'])
        retained = json.loads((self.f.home / 'attempts' / 'one' / '2' / 'context.json').read_text())
        self.assertEqual(context, retained)

    def test_end_to_end_checks_review_combined_integration_no_commit(self):
        head = self.git('rev-parse', 'HEAD')
        index = (self.root / '.git/index').read_bytes()
        row = self.approved()
        self.assertEqual(row['state'], 'verified')
        self.assertFalse((self.root / 'a.txt').exists())
        row = self.f.integrate('one')
        self.assertEqual(row['state'], 'integrated')
        self.assertEqual((self.root / 'a.txt').read_text(), 'accepted\n')
        self.assertEqual(self.git('rev-parse', 'HEAD'), head)
        self.assertEqual((self.root / '.git/index').read_bytes(), index)
        self.assertTrue(row['artifact']['checks'])
        journal = json.loads((self.f.home / 'integration.json').read_text())
        self.assertEqual(journal['phase'], 'complete')
        self.assertEqual(journal['checks'][0]['returncode'], 0)
        self.assertTrue((self.root / row['artifact']['patch']).exists())
        self.assertEqual(status(self.root)['counts']['integrated'], 1)

    def test_no_self_approval_and_approval_required(self):
        self.add()
        self.f.run_once('mock')
        for actor, role in [('worker-1', 'qa'), (' WORKER-1 ', 'qa'), ('reviewer-2', 'backend')]:
            with self.assertRaisesRegex(FactoryError, 'self approve'):
                self.f.review('one', actor=actor, role=role, approve=True, notes='inspected')
        with self.assertRaisesRegex(FactoryError, 'approval'):
            self.f.integrate('one')
        with self.assertRaisesRegex(FactoryError, 'Unapproved reviewer'):
            self.f.review('one', actor='third', role='frontend', approve=True, notes='inspected')

    def test_review_is_bound_to_artifact_hash(self):
        row = self.approved()
        (self.root / row['artifact']['patch']).write_text('tampered')
        with self.assertRaisesRegex(FactoryError, 'hash mismatch'):
            self.f.integrate('one')
        self.assertFalse((self.root / 'a.txt').exists())

    def test_expired_lease_recovery_is_idempotent_and_fences_old_owner(self):
        self.add()
        claim = self.f.claim('mock')
        with self.f.transaction() as db:
            db.execute('UPDATE tasks SET lease=0 WHERE id=?', ('one',))
        self.assertFalse(self.f.heartbeat('one', claim['owner']))
        self.assertFalse(self.f.finish(claim, error='old owner'))
        self.assertEqual(self.f.recover()['recovered'], ['one'])
        self.assertEqual(self.f.recover()['recovered'], [])
        other = self.f.claim('mock')
        self.assertNotEqual(claim['owner'], other['owner'])
        self.assertFalse(self.f.finish(claim, error='late completion'))
        self.assertEqual(self.f.task('one')['state'], 'running')

    def test_killed_worker_bounded_retry_and_logs(self):
        self.add(mock={'kill_self': True})
        self.assertEqual(self.f.run_once('mock')['state'], 'ready')
        row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'failed')
        self.assertIn('Worker exited', row['error'])
        self.assertEqual(row['attempts'], 2)
        self.assertIsNone(self.f.run_once('mock'))
        self.assertTrue((self.f.home / 'attempts/one/1/worker.log').exists())
        self.assertTrue((self.f.home / 'attempts/one/2/worker.log').exists())
        with self.assertRaisesRegex(FactoryError, 'budget exhausted'):
            self.f.resume('one')

    def test_killed_supervisor_recovers_orphan_process(self):
        # Preparation is not the fault under test. Establish an actual running,
        # heartbeating worker with the normal lease before killing its owner.
        self.add(mock={'sleep': 30})
        child = self.child(None, 'run', '--provider', 'mock', '--once')
        try:
            pid = self.wait_pid(child=child, require_heartbeat=True)
            row = self.f.task('one')
            self.assertIsNone(child.poll())
            self.assertEqual(proc_identity(pid), row['process_identity'])
            child.kill()
            child.communicate(timeout=5)
            # No wall-clock sleep: only after the supervisor is dead, inject
            # expiration of that same persisted ownership record.
            with self.f.transaction() as db:
                changed = db.execute("UPDATE tasks SET lease=0 WHERE id=? AND owner=? AND pid=? AND state='running'",
                                     ('one', row['owner'], pid)).rowcount
            self.assertEqual(changed, 1)
            result = self.f.recover()
            self.assertEqual(result['recovered'], ['one'])
            deadline = time.monotonic() + 2
            while proc_identity(pid) and time.monotonic() < deadline:
                # Linux container init may retain a killed orphan as a zombie.
                proc_stat = Path(f'/proc/{pid}/stat')
                if proc_stat.exists() and proc_stat.read_text().split(')')[-1].strip().startswith('Z'):
                    break
                time.sleep(0.02)
            else:
                self.assertFalse(proc_identity(pid), 'orphan worker still alive')
            self.assertEqual(self.f.task('one')['state'], 'ready')
            self.assertIsNone(self.f.task('one')['pid'])
            self.assertEqual(self.f.recover()['recovered'], [])
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)
            self.f.cancel('one')

    def test_malformed_output_never_reaches_review(self):
        self.add(mock={'files': {'a.txt': 'accepted\n'}, 'malformed': True}, max_attempts=1)
        self.assertEqual(self.f.run_once('mock')['state'], 'failed')
        self.assertEqual(self.f.status()['counts']['review'], 0)

    def test_result_cannot_supply_commands_or_approval(self):
        self.add(mock={'files': {'a.txt': 'accepted\n'}, 'result': {
            'schema_version': 1, 'task_id': 'one', 'summary': 'ok', 'evidence': [],
            'approved': True, 'commands': [['touch', 'PWNED']]}}, max_attempts=1)
        row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'failed')
        self.assertFalse((self.root / 'PWNED').exists())

    def test_stale_contract_before_claim_and_after_review(self):
        self.add()
        (self.root / 'docs/CONTRACT.md').write_text('changed')
        self.assertIsNone(self.f.run_once('mock'))
        self.assertEqual(self.f.task('one')['state'], 'blocked')
        (self.root / 'docs/CONTRACT.md').write_text('Pinned contract v1\n')
        self.f.resume('one')
        self.f.run_once('mock')
        (self.root / 'docs/CONTRACT.md').write_text('changed again')
        with self.assertRaisesRegex(FactoryError, 'stale context'):
            self.f.review('one', actor='reviewer', role='qa', approve=True, notes='looked')

    def test_stale_skill_blocks_integration(self):
        self.approved()
        (self.root / 'skills/backend/SKILL.md').write_text('changed role skill')
        with self.assertRaisesRegex(FactoryError, 'stale context'):
            self.f.integrate('one')

    def test_dependencies_wait_for_integration(self):
        self.add()
        self.add('two', dependencies=['one'], scope=['b.txt'], mock={'files': {'b.txt': 'second'}},
                 checks=[[sys.executable, '-c', "from pathlib import Path; assert Path('b.txt').exists(); assert Path('a.txt').read_text() == 'accepted\\n'"]])
        self.assertEqual(self.f.task('two')['state'], 'proposed')
        self.f.run_once('mock')
        self.assertIsNone(self.f.run_once('mock'))
        self.f.review('one', actor='reviewer', role='qa', approve=True, notes='actual artifact inspected')
        self.f.integrate('one')
        self.assertEqual(self.f.task('two')['state'], 'ready')
        dependent = self.f.run_once('mock')
        self.assertEqual(dependent['id'], 'two')
        self.assertEqual(dependent['state'], 'review', dependent['error'])
        self.assertEqual(dependent['artifact']['files'], ['b.txt'])

    def test_pause_resume_and_cancel_pending(self):
        self.add()
        self.f.pause()
        self.assertIsNone(self.f.run_once('mock'))
        self.f.resume()
        self.f.cancel('one')
        self.assertIsNone(self.f.run_once('mock'))
        self.f.resume('one')
        self.assertEqual(self.f.run_once('mock')['state'], 'review')

    def test_running_cancellation_terminates_group_and_does_not_retry(self):
        self.add(mock={'sleep': 30})
        child = self.child(None, 'run', '--provider', 'mock', '--once')
        try:
            pid = self.wait_pid()
            self.f.cancel('one')
            child.communicate(timeout=8)
            self.assertEqual(self.f.task('one')['state'], 'cancelled')
            self.assertEqual(self.f.task('one')['attempts'], 1)
            self.assertFalse(proc_identity(pid))
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate()

    def test_timeout(self):
        self.add(mock={'sleep': 30}, timeout=0.2, max_attempts=1)
        start = time.monotonic()
        row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'failed')
        self.assertIn('timeout', row['error'])
        self.assertLess(time.monotonic() - start, 5)

    def test_scope_violation_never_approved(self):
        self.add(mock={'files': {'a.txt': 'accepted\n', 'outside.txt': 'forbidden'}}, max_attempts=1)
        row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'failed')
        self.assertIn('Out-of-scope', row['error'])
        self.assertFalse((self.root / 'outside.txt').exists())

    def test_failed_checks_never_reach_review(self):
        self.add(mock={'files': {'a.txt': 'wrong'}}, max_attempts=1)
        row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'failed')
        self.assertIn('Acceptance check failed', row['error'])

    def test_conflicting_integration_preserves_root_and_verified_evidence(self):
        self.approved(scope=['existing.txt'], mock={'files': {'existing.txt': 'worker\n'}},
                      checks=[[sys.executable, '-c', "from pathlib import Path; assert Path('existing.txt').read_text() == 'worker\\n'"]])
        (self.root / 'existing.txt').write_text('concurrent\n')
        with self.assertRaises(FactoryError):
            self.f.integrate('one')
        self.assertEqual((self.root / 'existing.txt').read_text(), 'concurrent\n')
        self.assertEqual(self.f.task('one')['state'], 'verified')

    def test_combined_checks_are_enforced_and_preserve_unrelated_changes(self):
        self.approved(checks=[[sys.executable, '-c', "from pathlib import Path; assert Path('a.txt').read_text() == 'accepted\\n'; assert not Path('break-check').exists()"]])
        (self.root / 'break-check').write_text('concurrent change')
        with self.assertRaisesRegex(FactoryError, 'Acceptance check failed'):
            self.f.integrate('one')
        self.assertFalse((self.root / 'a.txt').exists())
        self.assertEqual((self.root / 'break-check').read_text(), 'concurrent change')

    def test_integration_rollback_after_write_failure(self):
        self.approved(scope=['a.txt', 'b.txt'], mock={'files': {'a.txt': 'accepted\n', 'b.txt': 'second'}})
        original = self.f.write_value
        count = 0
        def fail_second(name, value):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError('injected disk failure')
            return original(name, value)
        with patch.object(self.f, 'write_value', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'injected disk failure'):
                self.f.integrate('one')
        self.assertFalse((self.root / 'a.txt').exists())
        self.assertFalse((self.root / 'b.txt').exists())
        self.assertEqual(self.f.task('one')['state'], 'verified')
        self.assertEqual(self.f.recover()['recovered'], [])

    def test_crash_mid_integration_rolls_back_own_paths_idempotently(self):
        self.approved(scope=['a.txt', 'b.txt'], mock={'files': {'a.txt': 'accepted\n', 'b.txt': 'second'}})
        (self.root / 'unrelated.txt').write_text('keep me')
        script = '''import os, sys
from factory import Factory
f = Factory(sys.argv[1])
original = f.write_value
def crash(name, value):
    original(name, value)
    os._exit(93)
f.write_value = crash
f.integrate('one')
'''
        child = self.child(script)
        child.communicate(timeout=10)
        self.assertEqual(child.returncode, 93)
        self.assertEqual(json.loads((self.f.home / 'integration.json').read_text())['phase'], 'applying')
        self.assertEqual(self.f.recover()['recovered'], ['one'])
        self.assertFalse((self.root / 'a.txt').exists())
        self.assertFalse((self.root / 'b.txt').exists())
        self.assertEqual((self.root / 'unrelated.txt').read_text(), 'keep me')
        self.assertEqual(self.f.recover()['recovered'], [])

    def test_recovery_will_not_clobber_concurrent_manual_edits(self):
        self.approved()
        before = self.f.file_value(self.root, 'a.txt')
        (self.root / 'a.txt').write_text('factory applied')
        after = self.f.file_value(self.root, 'a.txt')
        atomic_json(self.f.home / 'integration.json', {'phase': 'applying', 'task_id': 'one',
                    'files': {'a.txt': {'before': before, 'after': after}}})
        (self.root / 'a.txt').write_text('human edit after crash')
        with self.assertRaisesRegex(FactoryError, 'manual inspection'):
            self.f.recover()
        self.assertEqual((self.root / 'a.txt').read_text(), 'human edit after crash')

    def test_recovery_after_db_commit_does_not_undo_integrated_files(self):
        self.approved()
        original = atomic_json
        def crash_before_completion(path, value):
            if path.name == 'integration.json' and value['phase'] == 'complete':
                raise OSError('injected crash after database commit')
            original(path, value)
        with patch('factory.core.atomic_json', side_effect=crash_before_completion):
            with self.assertRaisesRegex(OSError, 'after database commit'):
                self.f.integrate('one')
        self.assertEqual(self.f.task('one')['state'], 'integrated')
        self.assertEqual(self.f.recover()['recovered'], ['one'])
        self.assertEqual((self.root / 'a.txt').read_text(), 'accepted\n')
        self.assertEqual(self.f.recover()['recovered'], [])

    def test_independent_rejection_requires_explicit_retry(self):
        self.add()
        self.f.run_once('mock')
        self.f.review('one', actor='reviewer', role='qa', approve=False,
                      notes='Inspected actual artifact; acceptance does not cover required behavior')
        self.assertEqual(self.f.task('one')['state'], 'blocked')
        self.assertIsNone(self.f.run_once('mock'))
        self.f.resume('one')
        self.assertEqual(self.f.run_once('mock')['state'], 'review')

    def test_two_integrations_preserve_combined_local_changes(self):
        self.approved()
        self.approved('two', scope=['b.txt'], mock={'files': {'b.txt': 'second'}},
                      checks=[[sys.executable, '-c', "from pathlib import Path; assert Path('b.txt').read_text() == 'second'"]])
        self.f.integrate('one')
        self.f.integrate('two')
        self.assertEqual((self.root / 'a.txt').read_text(), 'accepted\n')
        self.assertEqual((self.root / 'b.txt').read_text(), 'second')

    def test_preexisting_local_input_is_not_worker_output(self):
        (self.root / 'a.txt').write_text('local input\n')
        (self.root / 'unrelated.txt').write_text('keep local input')
        row = self.approved()
        self.assertEqual(row['artifact']['files'], ['a.txt'])
        self.assertIn('a.txt', row['artifact']['context']['input_hashes'])
        self.f.integrate('one')
        self.assertEqual((self.root / 'a.txt').read_text(), 'accepted\n')
        self.assertEqual((self.root / 'unrelated.txt').read_text(), 'keep local input')

    def test_unknown_process_identity_fails_closed(self):
        self.add(mock={'sleep': 30}, max_attempts=1)
        pids = []
        def unknown_identity(pid):
            pids.append(pid)
            return ''
        with patch('factory.core.proc_identity', side_effect=unknown_identity):
            row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'failed')
        self.assertIn('safe process identity', row['error'])
        self.assertTrue(pids, 'The actual gated process must reach identity validation')
        for pid in set(pids):
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        self.assertFalse((self.f.home / 'attempts/one/1/result.json').exists())

    def test_expired_preparation_lease_requires_recovery_without_running_provider(self):
        self.add(max_attempts=1)
        worktree = self.f.worktree
        def expire_after_preparation(path, revision):
            worktree(path, revision)
            # Inject the same deadline crossing as a slow runner, without a sleep.
            with self.f.transaction() as db:
                db.execute("UPDATE tasks SET lease=0 WHERE id='one'")
        with patch.object(self.f, 'worktree', side_effect=expire_after_preparation):
            row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'running')
        self.assertEqual(row['lease'], 0)
        self.assertFalse(self.f.heartbeat('one', row['owner']))
        self.assertFalse((self.f.home / 'attempts/one/1/result.json').exists())
        self.assertEqual(self.f.recover()['recovered'], ['one'])
        self.assertEqual(self.f.task('one')['state'], 'failed')
        self.assertEqual(self.f.task('one')['error'], 'expired lease recovered')
        self.assertEqual(self.f.recover()['recovered'], [])

    def test_killed_integration_supervisor_recovers_check_group(self):
        self.approved(checks=[[sys.executable, '-c',
                              "from pathlib import Path; import time; assert Path('a.txt').exists(); time.sleep(30 if Path('slow-check').exists() else 0)"]])
        (self.root / 'slow-check').write_text('pause combined check for crash injection')
        child = self.child(None, 'integrate', 'one')
        record = None
        try:
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                paths = list(self.f.home.glob('integrations/*/combined-0.process.json'))
                if paths:
                    record = json.loads(paths[0].read_text())
                    if record['active']:
                        break
                time.sleep(0.02)
            self.assertIsNotNone(record)
            self.assertTrue(record['active'])
            child.kill()
            child.communicate(timeout=5)
            self.f.recover()
            self.assertFalse(json.loads(paths[0].read_text())['active'])
            self.assertEqual(self.f.task('one')['state'], 'verified')
            self.assertFalse((self.root / 'a.txt').exists())
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate()
            self.f.recover()

    def test_recovery_refuses_concurrent_integration(self):
        with self.f.integration_lock():
            with self.assertRaisesRegex(FactoryError, 'already active'):
                self.f.recover()

    def test_concurrent_claim_is_atomic_and_budget_bounded(self):
        self.add()
        with ThreadPoolExecutor(max_workers=4) as pool:
            claims = list(pool.map(lambda _: Factory(self.root).claim('mock'), range(4)))
        self.assertEqual(sum(c is not None for c in claims), 1)
        self.assertEqual(self.f.task('one')['attempts'], 1)
        self.add('two')
        with self.f.transaction() as db:
            db.execute("UPDATE settings SET value='5' WHERE key='total_seconds'")
        self.assertIsNone(self.f.claim('mock'))

    def test_checks_cannot_modify_the_artifact(self):
        self.add(checks=[[sys.executable, '-c', "from pathlib import Path; Path('a.txt').write_text('modified by check')"]], max_attempts=1)
        row = self.f.run_once('mock')
        self.assertEqual(row['state'], 'failed')
        self.assertIn('checks modified', row['error'])

    def test_validation_paths_argv_role_and_missing_acceptance(self):
        for kwargs in [{'scope': ['../escape']}, {'scope': ['.git/config']},
                       {'scope': ['.factory/']}, {'scope': []}, {'checks': ['echo unsafe']},
                       {'checks': []}, {'role': 'unapproved'}, {'acceptance': ''},
                       {'timeout': float('nan')}, {'max_attempts': 0}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(FactoryError):
                self.add(**kwargs)
        (self.root / 'link').symlink_to(self.temp.name)
        with self.assertRaisesRegex(FactoryError, 'Symlink'):
            self.add(scope=['link/'])

    def test_codex_adapter_never_bypasses_approval_or_sandbox(self):
        command = CodexProvider().command({}, self.root, self.f.home)
        self.assertEqual(command[:2], ['codex', 'exec'])
        self.assertIn('workspace-write', command)
        self.assertIn('--output-schema', command)
        self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', command)
        self.assertNotIn('--approve-for-me', command)
        self.assertNotIn('--add-dir', command)
        self.assertEqual(set(PROVIDERS), {'codex', 'mock'})

    def test_cli_help_status_and_explicit_worker(self):
        child = self.child(None, '--help')
        stdout, stderr = child.communicate(timeout=5)
        self.assertEqual(child.returncode, 0, stderr)
        self.assertIn(b'integrate', stdout)
        self.add()
        child = self.child(None, 'run', '--provider', 'mock', '--once', '--workers', '2')
        stdout, stderr = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual(json.loads(stdout)['supervisor_exit_codes'], [0, 0])
        self.assertEqual(self.f.task('one')['state'], 'review')
        self.assertEqual(self.f.task('one')['attempts'], 1)

    def test_uninitialized_status_is_empty(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(status(root)['tasks'], [])
            self.assertFalse(status(root)['initialized'])


if __name__ == '__main__':
    unittest.main()
