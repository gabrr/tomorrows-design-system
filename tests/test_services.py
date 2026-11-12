import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from tds import ai, pricing, storage
from tds.server import Handler, LocalServer

class StorageTests(unittest.TestCase):
    def test_atomic_roundtrip_and_traversal(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(storage, 'DATA', Path(folder)):
            project = {'id': 'example', 'name': 'Example', 'nodes': []}
            storage.save_project('example', project)
            self.assertEqual(storage.get_project('example'), project)
            self.assertEqual(len(storage.list_projects()), 1)
            with self.assertRaises(ValueError): storage.get_project('../outside')
            with self.assertRaises(ValueError): storage.save_project('other', project)
            storage.delete_project('example')
            self.assertEqual(storage.list_projects(), [])
    def test_nonfinite_write_preserves_previous(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'value.json'
            storage.atomic_json(path, {'value': 1})
            with self.assertRaises(ValueError): storage.atomic_json(path, {'value': float('nan')})
            self.assertEqual(storage.read_json(path), {'value': 1})

class PricingTests(unittest.TestCase):
    def test_openrouter_normalization_snapshot_and_failed_refresh_preservation(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(pricing, 'DATA', Path(folder)):
            fixture = {'data': [{'id': 'vendor/model', 'pricing': {'prompt': '0.000002', 'completion': '0.000008'}, 'context_length': 20000}]}
            with patch.object(pricing, 'fetch_json', return_value=fixture):
                snapshot = pricing.refresh_prices('openrouter')
            record = snapshot['records'][0]
            self.assertEqual(record['input_per_million'], 2)
            self.assertEqual(record['output_per_million'], 8)
            self.assertEqual(record['provider'], 'openrouter')
            self.assertIsNone(record['quota'])
            with patch.object(pricing, 'fetch_json', return_value={'data': []}):
                with self.assertRaises(ValueError): pricing.refresh_prices('openrouter')
            self.assertEqual(pricing.get_prices()['snapshots'][0]['snapshot_id'], snapshot['snapshot_id'])
    def test_direct_provider_never_fabricates_live_prices(self):
        with self.assertRaises(ValueError): pricing.refresh_prices('openai')
        with self.assertRaises(ValueError): pricing.amount(float('inf'))
    def test_gcp_missing_key_actionable(self):
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'GOOGLE_CLOUD_API_KEY'): pricing.refresh_prices('gcp')

class AIProposalTests(unittest.TestCase):
    def test_invalid_proposal_cannot_be_applied(self):
        class BadProvider:
            def generate(self, prompt, project): return {'proposal': {}, 'explanation': 'Bad', 'warnings': []}
        with patch.dict(ai.PROVIDERS, {'bad': BadProvider()}):
            with self.assertRaises(ValueError): ai.generate('a failure scenario', {'id': 'original'}, 'bad')
    def test_bounds_and_unknown_adapter(self):
        with self.assertRaises(ValueError): ai.generate('', {})
        with self.assertRaises(ValueError): ai.generate('x', {}, 'unknown')

class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = LocalServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
    def request(self, path, body=None, headers=None, method=None):
        request = Request(self.base + path, data=body, headers=headers or {}, method=method)
        try:
            with urlopen(request) as response: return response.status, response.read(), response.headers
        except HTTPError as error:
            with error:
                return error.code, error.read(), error.headers
    def test_health_and_static(self):
        status, body, headers = self.request('/api/health')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['status'], 'ok')
        self.assertEqual(headers['X-Frame-Options'], 'DENY')
        self.assertEqual(self.request('/')[0], 200)
        self.assertEqual(self.request('/../tds/server.py')[0], 404)
    def test_catalog_publishes_actual_editing_limits(self):
        from tds.simulation import validation_constraints
        status, body, _ = self.request('/api/catalog')
        self.assertEqual(status, 200)
        catalog = json.loads(body)
        self.assertEqual(len(catalog['components']), 150)
        self.assertEqual(catalog['constraints'], validation_constraints())
    def test_rebinding_and_cross_origin_rejected(self):
        self.assertEqual(self.request('/api/health', headers={'Host': 'evil.test'})[0], 403)
        self.assertEqual(self.request('/api/health', headers={'Origin': 'https://evil.test'})[0], 403)
    def test_invalid_json_and_nonfinite_rejected(self):
        for body in (b'[]', b'{', b'{"scenario":{"rps":NaN}}'):
            self.assertEqual(self.request('/api/simulate', body, {'Content-Type': 'application/json'})[0], 400)
    def test_invalid_architecture(self):
        self.assertEqual(self.request('/api/simulate', b'{}', {'Content-Type': 'application/json'})[0], 400)
    def test_presets_run_and_persist_evidence(self):
        from tds.catalog import presets
        import tds.server as server_module
        with tempfile.TemporaryDirectory() as folder, patch.object(server_module, 'DATA', Path(folder)):
            project = copy.deepcopy(presets()[0])
            project['scenario'].update(duration=2, rps=2, events=[])
            status, body, _ = self.request('/api/simulate', json.dumps(project).encode(), {'Content-Type': 'application/json'})
            self.assertEqual(status, 200, body)
            run = json.loads(body)
            self.assertEqual(run['project_snapshot'], project)
            self.assertTrue((Path(folder) / 'runs' / (run['run_id'] + '.json')).exists())
            self.assertEqual(self.request('/api/runs/' + run['run_id'])[0], 200)

class CrossModuleTests(unittest.TestCase):
    def test_live_rate_metadata_and_calibration_survive_simulation(self):
        from tds.catalog import presets
        from tds.simulation import validate, simulate
        from tds.calibration import calibrate
        project = presets()[0]
        project['nodes'][0]['config'].update({'pricing_provenance': {'source': 'https://provider.example/catalog', 'provider': 'openrouter', 'retrieved_at': '2026-11-11T00:00:00Z'}, 'model': 'vendor/model', 'input_cost_per_million': 2, 'cost_per_request': 0.001})
        calibrated = calibrate(project, [{'node_id': project['nodes'][0]['id'], 'source': 'local benchmark', 'samples_ms': [1, 2] * 10}])['proposal']
        self.assertEqual(validate(calibrated), [])
        self.assertGreater(simulate(calibrated)['summary']['experiment_cost'], 0)
    def test_metadata_cannot_contain_nonfinite_numbers(self):
        from tds.catalog import presets
        from tds.simulation import validate
        project = presets()[0]
        project['nodes'][0]['config']['calibration'] = {'value': float('nan')}
        self.assertTrue(validate(project))

    def test_quote_provenance_does_not_certify_unmodified_or_edited_rates(self):
        from tds.catalog import presets
        from tds.simulation import simulate
        project = presets()[0]
        project['scenario'].update(duration=2, rps=2, events=[])
        config = project['nodes'][0]['config']
        config.update({'input_tokens': 10, 'input_cost_per_million': 2, 'pricing_provenance': {'id': 'quote', 'currency': 'USD', 'input_per_million': 2, 'applied_fields': ['input_cost_per_million'], 'provenance': 'provider-published', 'source': 'https://provider.example/prices'}})
        row = simulate(project)['costs'][0]
        self.assertEqual(row['rate_sources']['input_cost_per_million']['kind'], 'provider-published quote')
        self.assertEqual(row['rate_sources']['hourly_cost']['kind'], 'illustrative default')
        config['input_cost_per_million'] = 3
        row = simulate(project)['costs'][0]
        self.assertEqual(row['rate_sources']['input_cost_per_million']['kind'], 'manual estimate')

    def test_descriptive_metadata_cannot_crash_cost_calculation(self):
        from tds.catalog import presets
        from tds.simulation import validate, simulate
        for value in (1, {}, 'hourly_cost'):
            project = presets()[0]
            project['scenario'].update(duration=1, rps=1, events=[])
            project['nodes'][0]['config']['pricing_provenance'] = {'applied_fields': value, 'hourly_cost': .1}
            self.assertEqual(validate(project), [])
            self.assertGreaterEqual(simulate(project)['summary']['monthly_cost'], 0)

    def test_quote_for_another_model_region_or_class_is_not_certified(self):
        from tds.catalog import presets
        from tds.simulation import simulate
        project=presets()[0];project['scenario'].update(duration=1,rps=1,events=[])
        config=project['nodes'][0]['config']
        config.update(provider='openrouter',model='model-a',region='east',instance_class='class-a',input_cost_per_million=2,pricing_provenance={'id':'quote','currency':'USD','provenance':'provider-published','provider':'openrouter','model':'model-a','region':'east','sku':'class-a','input_per_million':2,'applied_fields':['input_cost_per_million']})
        self.assertEqual(simulate(project)['costs'][0]['rate_sources']['input_cost_per_million']['kind'],'provider-published quote')
        for key,value in [('model','model-b'),('region','west'),('instance_class','class-b')]:
            original=config[key];config[key]=value
            self.assertEqual(simulate(project)['costs'][0]['rate_sources']['input_cost_per_million']['kind'],'manual estimate')
            config[key]=original
