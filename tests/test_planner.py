import json
import unittest
from unittest.mock import patch
import test_autopilot as fixtures
from factory import Factory, FactoryError
from factory.planner import create_plan

class PlannerTests(unittest.TestCase):
    setUp = fixtures.AutopilotTests.setUp
    tearDown = fixtures.AutopilotTests.tearDown

    def task(self):
        return {'id': 'bounded-feature', 'role': 'backend', 'scope': ['feature.txt'], 'acceptance': 'File exists with working behavior.', 'prompt': 'Implement the bounded feature and report evidence.', 'dependencies': [], 'timeout': 10}

    def propose(self, task):
        return {'tasks_json': json.dumps([task]), 'rationale': 'A bounded task.'}

    def test_rejected_plan_is_revised_with_feedback_and_fixed_checks(self):
        with patch('factory.planner.invoke', side_effect=[self.propose(self.task()), {'approve': False, 'notes': 'Acceptance needs a precise oracle.', 'findings': ['Define the file content.']}, self.propose(self.task()), {'approve': True, 'notes': 'Bounded plan inspected.', 'findings': []}]) as invoke:
            path, plan = create_plan(self.root, 'Build a bounded feature.', ['feature.txt'], self.plan['checks'], seconds=60)
        self.assertTrue(path.exists())
        self.assertEqual(plan['checks'], self.plan['checks'])
        self.assertIn('precise oracle', invoke.call_args_list[2].args[1])
        self.assertEqual(Factory(self.root).status()['tasks'], [])
        self.assertLessEqual(plan['total_seconds'], 60)

    def test_execution_invalid_plan_never_reaches_approval_or_registration(self):
        invalid = self.task(); invalid['max_attempts'] = 1000000
        with patch('factory.planner.invoke', return_value=self.propose(invalid)) as invoke:
            with self.assertRaisesRegex(FactoryError, 'revisions exhausted'):
                create_plan(self.root, 'Build a bounded feature.', ['feature.txt'], self.plan['checks'], seconds=60)
        self.assertEqual(invoke.call_count, 3)
        self.assertEqual(Factory(self.root).status()['tasks'], [])
        self.assertEqual(list((self.root / '.factory/plans').glob('*/approved.json')), [])

    def test_invalid_output_is_repaired_before_coordinator(self):
        with patch('factory.planner.invoke', side_effect=[{'tasks_json': 'malformed', 'rationale': 'bad'}, self.propose(self.task()), {'approve': True, 'notes': 'Checked task and acceptance.', 'findings': []}]):
            path, plan = create_plan(self.root, 'Build a bounded feature.', ['feature.txt'], self.plan['checks'], seconds=60)
        self.assertTrue(path.exists())
        self.assertEqual(plan['tasks'][0]['id'], 'bounded-feature')
