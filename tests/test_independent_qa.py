"""Independent integration probes. Failures preserve unmet acceptance requirements.

Run: python3 -m unittest discover -s tests -p test_independent_qa.py -v
No paid provider, live refresh, shared factory state or persistent app data used.
"""
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from factory.autopilot import Autopilot
from tds import pricing
from tds.calibration import calibrate
from tds.server import Handler
from tds.simulation import simulate, validate

ROOT = Path(__file__).resolve().parents[1]


def project():
    return {'id': 'qa', 'name': 'QA oracle', 'nodes': [
        {'id': 'app', 'type': 'api_service', 'label': 'App', 'x': 0, 'y': 0,
         'config': {'latency_ms': 10, 'capacity_rps': 100, 'hourly_cost': 2}}],
        'edges': [], 'scenario': {'duration': 5, 'rps': 2, 'seed': 42, 'events': []}}


def dispatch(path, body):
    """Real handler dispatch/JSON validation without a listening socket."""
    handler = Handler.__new__(Handler)
    raw = json.dumps(body).encode()
    handler.server = SimpleNamespace(server_port=8765)
    handler.headers = {'Host': '127.0.0.1:8765', 'Content-Type': 'application/json',
                       'Content-Length': str(len(raw))}
    handler.rfile = io.BytesIO(raw)
    handler.path = path
    replies = []
    handler.respond = lambda value, status=200: replies.append((status, value))
    handler.dispatch('POST')
    return replies[-1]


class IntegrationProbes(unittest.TestCase):
    def test_calibration_proposal_can_be_simulated_with_evidence(self):
        p = project()
        result = calibrate(p, [{'node_id': 'app', 'source': 'synthetic QA fixture',
                               'samples_ms': [20, 22] * 10}])
        self.assertEqual(validate(result['proposal']), [], 'Calibration proposal must cross simulator boundary')
        run = simulate(result['proposal'])
        self.assertAlmostEqual(run['summary']['p50_ms'], 20)
        self.assertIn('calibration', run['project']['nodes'][0]['config'])

    def test_price_apply_then_simulate(self):
        record = {'id': 'qa/model', 'provider': 'openrouter', 'model': 'qa/model',
                  'input_per_million': 2, 'output_per_million': 8, 'request_cost': .01,
                  'currency': 'USD', 'unit': 'USD / million tokens',
                  'source': 'synthetic QA fixture', 'retrieved_at': '2026-11-11T00:00:00Z'}
        p = project()
        p['nodes'][0]['config'].update(input_tokens=100, output_tokens=50)
        with patch.object(pricing, 'get_prices', return_value={'records': [record]}):
            status, body = dispatch('/api/pricing/apply', {'project': p, 'node_id': 'app',
                                   'provider': 'openrouter', 'record_id': 'qa/model'})
        self.assertEqual(status, 200, body)
        run = simulate(body['project'])
        self.assertAlmostEqual(run['costs'][0]['request_cost'], .1)
        self.assertAlmostEqual(run['costs'][0]['token_cost'], .006)

    def test_wrong_currency_price_is_not_applied_as_usd(self):
        record = {'id': 'qa', 'provider': 'azure', 'hourly_cost': 3,
                  'currency': 'EUR', 'unit': 'instance-hour'}
        with patch.object(pricing, 'get_prices', return_value={'records': [record]}):
            status, body = dispatch('/api/pricing/apply', {'project': project(), 'node_id': 'app',
                                   'provider': 'azure', 'record_id': 'qa'})
        self.assertEqual(status, 400, body)
        self.assertRegex(body['error'].lower(), 'currency|usd')

    def test_wrong_unit_price_is_not_applied_as_hourly(self):
        record = {'id': 'qa', 'provider': 'azure', 'hourly_cost': 3,
                  'currency': 'USD', 'unit': 'GB-month'}
        with patch.object(pricing, 'get_prices', return_value={'records': [record]}):
            status, body = dispatch('/api/pricing/apply', {'project': project(), 'node_id': 'app',
                                   'provider': 'azure', 'record_id': 'qa'})
        self.assertEqual(status, 400, body)

    def test_malformed_config_and_metadata_rejected(self):
        nested = {'value': 1}
        for _ in range(10):
            nested = {'nested': nested}
        for key, value in [('latency_ms', '20 seconds'), ('latency_ms', True),
                           ('calibration', {'error': float('nan')}),
                           ('pricing_provenance', nested), ('concurrency', 1.5)]:
            with self.subTest(key=key, value=value):
                p = project()
                p['nodes'][0]['config'][key] = value
                self.assertTrue(validate(p))
                with self.assertRaises(ValueError):
                    simulate(p)

    def test_malformed_nested_api_objects_are_400(self):
        for path, body in [('/api/observations/compare', {'result': [], 'observations': {'p95_ms': {'value': 1, 'absolute_tolerance': 1}}}),
                           ('/api/pricing/apply', {'project': [], 'node_id': 'app', 'provider': 'azure', 'record_id': 'qa'})]:
            with self.subTest(path=path), patch.object(pricing, 'get_prices', return_value={
                    'records': [{'id': 'qa', 'provider': 'azure', 'hourly_cost': 1}]}):
                status, body = dispatch(path, body)
                self.assertEqual(status, 400, body)

    def test_downstream_latency_cost_and_failure_conservation(self):
        p = project()
        p['nodes'].append({'id': 'db', 'type': 'database', 'config': {
            'latency_ms': 25, 'capacity_rps': 100, 'hourly_cost': 3}})
        # Use a catalog-supported database type rather than inventing behavior.
        from tds.catalog import catalog
        p['nodes'][1]['type'] = next(c['type'] for c in catalog()['components'] if c['category'] == 'database topologies')
        p['edges'] = [{'id': 'app-db', 'source': 'app', 'target': 'db', 'latency_ms': 5}]
        healthy = simulate(p)
        self.assertAlmostEqual(healthy['summary']['p95_ms'], 40)
        self.assertAlmostEqual(healthy['summary']['experiment_cost'], 5 * 5 / 3600)
        p['scenario']['events'] = [{'id': 'down', 'type': 'fail', 'target': 'db', 'time': 1},
                                    {'id': 'up', 'type': 'recover', 'target': 'db', 'time': 3}]
        run = simulate(p)
        self.assertGreater(run['summary']['failed'], 0)
        self.assertGreater(run['frames'][-1]['completed'], run['frames'][3]['completed'])
        for f in run['frames']:
            self.assertEqual(f['requests'], f['completed'] + f['failed'] + f['inflight'])
            for e in f['edges'].values():
                self.assertEqual(e['requests'], e['delivered'] + e['failed'] + e['inflight'])


class FactoryProbes(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ('AGENTS.md', 'docs/PLAN.md', 'docs/CONTRACT.md', 'agents/roles.json'):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / name, dest)
        shutil.copytree(ROOT / 'skills', self.root / 'skills')
        (self.root / '.gitignore').write_text('.factory/\n__pycache__/\n')
        # Fixture-only Git history; never commits in the user's repository.
        for argv in (['init', '-q'], ['add', '.'], ['-c', 'user.name=QA', '-c', 'user.email=qa@localhost', 'commit', '-qm', 'fixture']):
            subprocess.run(['git', '-C', str(self.root), *argv], check=True, capture_output=True)
        self.plan = {'version': 1, 'provider': 'mock', 'allowed_scopes': ['a.txt', 'b.txt'],
                     'concurrency': 1, 'total_seconds': 20, 'max_repairs': 1,
                     'checks': [[sys.executable, '-c', 'assert True']],
                     'tasks': [{'id': 'a', 'role': 'backend', 'scope': ['a.txt'],
                                'acceptance': 'File a exists', 'prompt': 'Write a',
                                'timeout': 3, 'mock': {'files': {'a.txt': 'a'}}}]}

    def tearDown(self):
        self.temp.cleanup()

    def test_repair_does_not_permanently_block_dependent(self):
        self.plan['tasks'].append({'id': 'b', 'role': 'backend', 'scope': ['b.txt'],
                                   'acceptance': 'File b exists after a', 'prompt': 'Write b',
                                   'dependencies': ['a'], 'timeout': 3, 'mock': {'files': {'b.txt': 'b'}}})
        calls = []
        def reviewer(row):
            reject = not calls
            calls.append(row['id'])
            return {'approve': not reject, 'notes': 'Synthetic review fault fixture',
                    'findings': ['Repair required'] if reject else []}
        report = Autopilot(self.root, self.plan, reviewer=reviewer).run()
        self.assertTrue(report['completed'], report['status'])
        self.assertTrue((self.root / 'b.txt').exists())

    def test_repair_respects_explicit_attempt_cap(self):
        self.plan['tasks'][0]['max_attempts'] = 1
        report = Autopilot(self.root, self.plan, reviewer=lambda row: {
            'approve': False, 'notes': 'Synthetic rejection', 'findings': ['Repair required']}).run()
        self.assertFalse(report['completed'])
        self.assertLessEqual(report['status']['tasks'][0]['attempts'], 1)

    def test_restart_after_review_commit_retains_pending_repair(self):
        pilot = Autopilot(self.root, self.plan, reviewer=lambda row: {
            'approve': False, 'notes': 'Synthetic rejection', 'findings': ['Repair required']})
        original = pilot.factory.review
        class InjectedCrash(BaseException):
            pass
        def crash_after_commit(*args, **kwargs):
            original(*args, **kwargs)
            raise InjectedCrash()
        with patch.object(pilot.factory, 'review', side_effect=crash_after_commit):
            with self.assertRaises(InjectedCrash):
                pilot.run()
        report = Autopilot(self.root, self.plan, reviewer=lambda row: {
            'approve': True, 'notes': 'Inspected repaired fixture', 'findings': []}).run()
        self.assertTrue(report['completed'], report['status'])

    def test_supervised_log_output_is_bounded(self):
        from factory.core import Factory, FactoryError, MAX_OUTPUT
        factory = Factory(self.root)
        factory.init()
        log = factory.home / 'qa-flood.log'
        try:
            factory.run_process([sys.executable, '-c',
                                 f'import sys; sys.stdout.write("x" * {MAX_OUTPUT + 1})'],
                                self.root, log, timeout=2)
        except FactoryError:
            pass
        self.assertLessEqual(log.stat().st_size, MAX_OUTPUT,
                             'Supervisor must cap retained stdout, including short-lived children')


if __name__ == '__main__':
    unittest.main()
