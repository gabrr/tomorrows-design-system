import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from factory import FactoryError
from factory.autopilot import Autopilot, validate_plan

ROOT = Path(__file__).resolve().parents[1]

class AutopilotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for name in ('AGENTS.md', 'docs/PLAN.md', 'docs/CONTRACT.md', 'agents/roles.json'):
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / name, path)
        shutil.copytree(ROOT / 'skills', self.root / 'skills')
        (self.root / '.gitignore').write_text('.factory/\n__pycache__/\n')
        for args in (['init', '-q'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'base']):
            subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)
        self.plan = {'version': 1, 'provider': 'mock', 'allowed_scopes': ['feature.txt'], 'concurrency': 1, 'total_seconds': 60, 'max_repairs': 1,
                     'checks': [[sys.executable, '-c', "from pathlib import Path; assert Path('feature.txt').read_text() == 'working'"]],
                     'tasks': [{'id': 'feature', 'role': 'backend', 'scope': ['feature.txt'], 'acceptance': 'File contains working', 'prompt': 'Implement feature', 'mock': {'files': {'feature.txt': 'working'}}, 'timeout': 10}]}
    def tearDown(self): self.temporary.cleanup()
    def test_automatic_independent_review_and_integration(self):
        seen=[]
        def review(row):
            seen.append(row['artifact']['sha256'])
            self.assertEqual((self.root / row['artifact']['workspace'] / 'feature.txt').read_text(), 'working')
            return {'approve': True, 'notes': 'Inspected actual file and passing check.', 'findings': []}
        report = Autopilot(self.root, self.plan, reviewer=review).run()
        self.assertTrue(report['completed'], report)
        self.assertEqual(len(seen), 1)
        self.assertEqual((self.root / 'feature.txt').read_text(), 'working')
        repeat = Autopilot(self.root, self.plan, reviewer=review).run()
        self.assertTrue(repeat['completed'])
        self.assertEqual(len(seen), 1)
    def test_rejection_is_bounded_and_never_integrated(self):
        seen=[]
        def reject(row):
            seen.append(row['id'])
            return {'approve': False, 'notes': 'Artifact does not meet the acceptance intent.', 'findings': ['Missing required behavior.']}
        report = Autopilot(self.root, self.plan, reviewer=reject).run()
        self.assertFalse(report['completed'])
        self.assertEqual(len(seen), 2)
        self.assertFalse((self.root / 'feature.txt').exists())
        self.assertEqual(report['status']['tasks'][0]['state'], 'blocked')
    def test_plan_cannot_expand_worker_scope_or_create_roles(self):
        pilot = Autopilot(self.root, self.plan, reviewer=lambda row: None)
        self.plan['tasks'][0]['scope'] = ['factory/']
        with self.assertRaises(FactoryError): validate_plan(self.plan, pilot.factory.roles())
        self.plan['tasks'][0]['scope'] = ['feature.txt']
        self.plan['tasks'][0]['role'] = 'invented-manager'
        with self.assertRaises(FactoryError): validate_plan(self.plan, pilot.factory.roles())

    def test_review_commit_crash_reconciles_without_exceeding_attempt_cap(self):
        from factory import Factory
        pilot = Autopilot(self.root, self.plan, reviewer=lambda row: None)
        pilot.factory.init(total_seconds=60)
        task = self.plan['tasks'][0]
        pilot.factory.add(task_id=task['id'], role=task['role'], actor='worker-feature', scope=task['scope'], acceptance=task['acceptance'], checks=self.plan['checks'], prompt=task['prompt'], provider_name='mock', mock=task['mock'], timeout=10, max_attempts=2)
        row = pilot.factory.run_once('mock')
        self.assertEqual(row['state'], 'review')
        pilot.factory.review('feature', actor='qa-reviewer', role='qa', approve=False, notes='Reproduce crash immediately after review commit; missing behavior.')
        resumed = Autopilot(self.root, self.plan, reviewer=lambda row: None)
        resumed.reconcile_repairs()
        resumed.reconcile_repairs()
        row = resumed.factory.task('feature')
        self.assertEqual(row['state'], 'ready')
        self.assertEqual(row['payload']['repair_count'], 1)
        self.assertEqual(row['attempts'], 1)
        resumed.factory.run_once('mock')
        resumed.factory.review('feature', actor='qa-reviewer', role='qa', approve=False, notes='Still missing behavior.')
        resumed.reconcile_repairs()
        self.assertEqual(resumed.factory.task('feature')['state'], 'blocked')
        self.assertEqual(resumed.factory.task('feature')['attempts'], 2)

    def test_preflight_rejects_execution_invalid_limits_before_registration(self):
        pilot = Autopilot(self.root, self.plan, reviewer=lambda row: None)
        for field, value in [('id', '../invalid'), ('timeout', 'forever'), ('max_attempts', 1000000), ('timeout', True), ('lease_seconds', .01)]:
            candidate = json.loads(json.dumps(self.plan))
            candidate['tasks'][0][field] = value
            with self.assertRaises(FactoryError): validate_plan(candidate, pilot.factory.roles())
        self.assertFalse(pilot.factory.dbpath.exists())

    def test_real_reviewer_adapter_resolves_directory_and_preserves_decision_evidence(self):
        import time
        from unittest.mock import patch
        pilot = Autopilot(self.root, self.plan)
        pilot.factory.init(total_seconds=60)
        task = self.plan['tasks'][0]
        pilot.factory.add(task_id=task['id'], role=task['role'], actor='worker-feature', scope=task['scope'], acceptance=task['acceptance'], checks=self.plan['checks'], prompt=task['prompt'], provider_name='mock', mock=task['mock'], timeout=10)
        row = pilot.factory.run_once('mock')
        self.assertEqual(row['state'], 'review')
        decision = {'approve': True, 'notes': 'Inspected actual file and acceptance log.', 'findings': []}
        def execute(argv, workspace, log, timeout, stdin_text=''):
            self.assertTrue(workspace.is_dir())
            self.assertTrue((workspace / 'feature.txt').is_file())
            self.assertIn('ORIGIN PROJECT ROOT', stdin_text)
            Path(argv[argv.index('-o') + 1]).write_text(json.dumps(decision))
            return {'returncode': 0, 'log': str(log)}
        pilot.deadline = time.monotonic() + 60
        with patch.object(pilot.factory, 'run_process', side_effect=execute):
            self.assertEqual(pilot.codex_review(row), decision)
        saved = json.loads(next((self.root / '.factory/reviews').glob('feature-1-*/decision.json')).read_text())
        self.assertEqual(saved['sha256'], row['artifact']['sha256'])
        self.assertEqual(pilot.factory.task('feature')['state'], 'review')

    def test_restart_does_not_reset_persistent_wall_budget(self):
        import time
        from factory.core import digest
        pilot = Autopilot(self.root, self.plan, reviewer=lambda row: self.fail('Expired budget must not invoke reviewer'))
        pilot.factory.init(total_seconds=60)
        task = self.plan['tasks'][0]
        pilot.factory.add(task_id=task['id'], role=task['role'], actor='worker-feature', scope=task['scope'], acceptance=task['acceptance'], checks=self.plan['checks'], prompt=task['prompt'], provider_name='mock', mock=task['mock'], timeout=10)
        record = self.root / '.factory/approved-plan.json'
        created = time.time() - 61
        deadline = time.time() - 1
        record.write_text(json.dumps({'sha256': digest(json.dumps(self.plan, sort_keys=True).encode()), 'plan': self.plan, 'created_at': created, 'wall_deadline': deadline}))
        resumed = pilot.run()
        self.assertIn('Plan wall-clock budget exhausted.', resumed['blockers'])
        self.assertEqual(resumed['status']['tasks'][0]['attempts'], 0)
        self.assertEqual(json.loads(record.read_text())['created_at'], created)
        self.assertEqual(json.loads(record.read_text())['wall_deadline'], deadline)
