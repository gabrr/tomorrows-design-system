import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from tds import ai
from tds.catalog import catalog, presets
from tds.simulation import validate, validation_constraints, validation_config_guidance


class AIContextTests(unittest.TestCase):
    def provider_response(self, project, proposal):
        """Exercise the actual provider stdin/output path without a CLI or model."""
        observed = {}

        class Process:
            returncode = 0

            def __init__(self, command, **kwargs):
                observed['command'] = command
                observed['process_options'] = kwargs
                self.output = Path(command[command.index('-o') + 1])

            def communicate(self, data, timeout):
                observed['instruction'] = data.decode()
                observed['timeout'] = timeout
                self.output.write_text(json.dumps({
                    'project_json': json.dumps(proposal),
                    'explanation': 'Proposed architecture.', 'warnings': [],
                }))

        with patch.object(ai.shutil, 'which', return_value='/mock/codex'), \
                patch.object(ai.subprocess, 'Popen', Process):
            result = ai.generate('Build this architecture.', project)
        return observed, result

    def test_provider_receives_canonical_config_units_bounds_and_compact_defaults(self):
        project = presets()[0]
        before = copy.deepcopy(project)
        observed, result = self.provider_response(project, project)
        instruction = observed['instruction']
        guidance = json.loads(instruction.split('\nCONFIGURATION GUIDANCE:\n')[1]
                              .split('\nCURRENT PROJECT:\n')[0])
        self.assertEqual(guidance['numeric_constraints'], validation_constraints())
        config = guidance['config']
        self.assertIn('health_check_delay', config['allowed_keys'])
        self.assertNotIn('health_check_delay_ms', config['allowed_keys'])
        self.assertEqual(config['numeric_units']['health_check_delay'], 'seconds')
        self.assertEqual(config['numeric_units']['latency_ms'], 'milliseconds')
        self.assertEqual(config['numeric_units']['capacity_rps'], 'requests/second')
        self.assertEqual(set(config['allowed_keys']),
                         set(guidance['numeric_constraints']['node_config']) | set(config['non_numeric_rules']))
        self.assertEqual(set(config['numeric_units']), set(guidance['numeric_constraints']['node_config']))
        self.assertEqual(config['non_numeric_rules']['routing']['enum'], ['all', 'weighted'])
        self.assertEqual(config['non_numeric_rules']['async_dispatch']['type'], 'boolean')
        self.assertEqual(config['non_numeric_rules']['provider']['max_length'], 1000)
        defaults = guidance['catalog_defaults']
        expanded = {}
        for profile in defaults['profiles']:
            for kind in profile['types']:
                self.assertNotIn(kind, expanded)
                expanded[kind] = dict(defaults['base'], **profile['overrides'])
        self.assertEqual(expanded, {c['type']: c['defaults'] for c in catalog()['components']})
        self.assertEqual(expanded['load_balancer']['health_check_delay'], 5)
        self.assertLess(len(json.dumps(guidance)), 16000)
        submitted = json.loads(instruction.split('\nCURRENT PROJECT:\n')[1]
                               .split('\nUSER DESIGN INTENT:\n')[0])
        self.assertEqual(submitted, before)
        self.assertEqual(project, before)
        self.assertEqual(result['proposal'], before)
        self.assertEqual(observed['timeout'], 240)
        command = observed['command']
        self.assertEqual(command[command.index('--sandbox') + 1], 'read-only')
        self.assertIn('--ephemeral', command)
        self.assertIn('--output-schema', command)
        self.assertTrue(observed['process_options']['start_new_session'])

    def test_blank_shell_is_preserved_as_construction_context_not_replaced_with_preset(self):
        proposal = presets()[0]
        blank = {'id': 'blank-authoring', 'name': 'Untitled architecture',
                 'nodes': [], 'edges': [],
                 'scenario': {'duration': 60, 'rps': 20, 'seed': 42, 'events': []},
                 'monthly': {'hours': 730, 'traffic_multiplier': 1}}
        proposal['id'] = blank['id']
        observed, result = self.provider_response(blank, proposal)
        submitted = json.loads(observed['instruction'].split('\nCURRENT PROJECT:\n')[1]
                               .split('\nUSER DESIGN INTENT:\n')[0])
        self.assertEqual(submitted, blank)
        self.assertEqual(result['proposal']['id'], blank['id'])

    def test_wrong_model_key_is_rejected_without_alias_translation(self):
        project = presets()[0]
        wrong = copy.deepcopy(project)
        wrong['nodes'][0]['config']['health_check_delay_ms'] = 3000
        with self.assertRaisesRegex(ValueError, r'config.health_check_delay_ms is unsupported'):
            self.provider_response(project, wrong)
        self.assertNotIn('health_check_delay_ms', project['nodes'][0]['config'])
        self.assertFalse(ai.LOCK.locked())

    def test_changed_project_id_is_still_rejected(self):
        project = presets()[0]
        wrong = copy.deepcopy(project)
        wrong['id'] = 'different-project'
        with self.assertRaisesRegex(ValueError, 'changed the project identifier'):
            self.provider_response(project, wrong)

    def test_prompt_limits_precede_provider_execution(self):
        with patch.object(ai.subprocess, 'Popen') as process:
            for prompt in ('', ' ', 'x' * 10001):
                with self.assertRaisesRegex(ValueError, '1–10,000'):
                    ai.generate(prompt, presets()[0])
            process.assert_not_called()

    def test_guidance_returns_independent_read_only_description(self):
        guidance = validation_config_guidance()
        guidance['allowed_keys'].clear()
        guidance['non_numeric_rules']['routing']['enum'].append('invented')
        fresh = validation_config_guidance()
        self.assertIn('routing', fresh['allowed_keys'])
        self.assertEqual(fresh['non_numeric_rules']['routing']['enum'], ['all', 'weighted'])

    def test_non_numeric_guidance_agrees_with_validator(self):
        for key, rule in validation_config_guidance()['non_numeric_rules'].items():
            valid = (rule['enum'] if 'enum' in rule else
                     [False, True] if rule['type'] == 'boolean' else
                     ['generic'] if rule['type'] == 'string' else ['manual estimate', {'source': 'manual'}])
            invalid = ('invented' if 'enum' in rule else
                       1 if rule['type'] == 'boolean' else
                       'x' * 1001 if rule['type'] == 'string' else [])
            for value, accepted in [*((value, True) for value in valid), (invalid, False)]:
                with self.subTest(key=key, value_type=type(value).__name__):
                    project = presets()[0]
                    project['nodes'][0]['config'][key] = value
                    self.assertEqual(not validate(project), accepted)


if __name__ == '__main__':
    unittest.main()
