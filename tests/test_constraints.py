import copy
import unittest
from tds.catalog import presets
from tds.simulation import validate, validation_constraints


class NumericConstraintsTests(unittest.TestCase):
    def test_published_node_limits_match_validator_boundaries(self):
        base = copy.deepcopy(presets()[0])
        base['scenario'].update(duration=2, rps=2, events=[])
        for field, rule in validation_constraints()['node_config'].items():
            for value, accepted in ((rule['min'], True), (rule['max'], True),
                                    (rule['min'] - 1, False), (rule['max'] + 1, False)):
                with self.subTest(field=field, value=value):
                    project = copy.deepcopy(base)
                    project['nodes'][0]['config'][field] = value
                    errors = validate(project)
                    self.assertEqual(not errors, accepted, errors)
            if rule['integer']:
                project = copy.deepcopy(base)
                project['nodes'][0]['config'][field] = max(1, rule['min']) + .5
                self.assertTrue(validate(project))

    def test_workload_monthly_edge_and_integer_rules_are_authoritative(self):
        rules = validation_constraints()
        for scope in ('scenario', 'monthly', 'edge'):
            for field, rule in rules[scope].items():
                with self.subTest(scope=scope, field=field):
                    project = copy.deepcopy(presets()[0])
                    target = project['edges'][0] if scope == 'edge' else project[scope]
                    target[field] = rule['max'] + 1
                    self.assertTrue(validate(project))
        self.assertTrue(rules['scenario']['seed']['integer'])
        self.assertFalse(rules['scenario']['duration']['integer'])
        self.assertTrue(rules['edge']['queue_limit']['integer'])

    def test_metadata_cannot_mutate_validation_rules(self):
        rules = validation_constraints()
        rules['node_config']['capacity_rps']['min'] = 0
        self.assertEqual(validation_constraints()['node_config']['capacity_rps']['min'], .001)
