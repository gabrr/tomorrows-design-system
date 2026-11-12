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
