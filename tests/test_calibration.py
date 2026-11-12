import unittest
from tds.calibration import calibrate, compare_observations

class CalibrationTests(unittest.TestCase):
    def test_fit_and_heldout_evidence_no_mutation(self):
        project = {'nodes': [{'id': 'app', 'config': {'latency_ms': 10}}]}
        result = calibrate(project, [{'node_id': 'app', 'source': 'benchmark.csv', 'samples_ms': [20, 22] * 10, 'capacity_rps': 80}])
        self.assertEqual(project['nodes'][0]['config']['latency_ms'], 10)
        config = result['proposal']['nodes'][0]['config']
        self.assertEqual(config['latency_ms'], 20)
        self.assertEqual(config['capacity_rps'], 80)
        self.assertEqual(config['calibration']['holdout_mean_absolute_error_ms'], 2)
    def test_missing_source_and_insufficient_samples_rejected(self):
        for measurement in ({'node_id': 'app', 'samples_ms': [1] * 20}, {'node_id': 'app', 'source': 'test', 'samples_ms': [1]}):
            with self.assertRaises(ValueError): calibrate({'nodes': [{'id': 'app'}]}, [measurement])
    def test_tolerance_is_explicit(self):
        result = compare_observations({'summary': {'p95_ms': 100}}, {'p95_ms': {'value': 110, 'absolute_tolerance': 5}})
        self.assertFalse(result['passed'])
        with self.assertRaises(ValueError): compare_observations({'summary': {'p95_ms': 100}}, {'p95_ms': {'value': 110}})
