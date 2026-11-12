import json
from pathlib import Path
import sys
import unittest
import test_factory as fixtures
from factory import FactoryError
from factory.core import encoded

class FeedbackTests(unittest.TestCase):
    setUp = fixtures.FactoryTests.setUp
    tearDown = fixtures.FactoryTests.tearDown
    git = fixtures.FactoryTests.git

    def add(self):
        return self.f.add(task_id='repair', role='frontend', actor='worker', scope=['a.txt','b.txt'], acceptance='A corrected and B retained', checks=[[sys.executable,'-c',"from pathlib import Path; assert Path('b.txt').read_text() == 'retained'"]], prompt='Implement files; independent reviewer checks A.', provider_name='mock', mock={'files': {'a.txt':'initial','b.txt':'retained'}}, timeout=10, max_attempts=3)

    def test_feedback_is_audited_without_changing_scope_or_acceptance(self):
        original=self.add()['payload']
        row=self.f.feedback('repair', actor='coordinator', message='Check the laptop playback controls in the actual screenshot.')
        self.assertEqual(row['payload']['scope'], original['scope'])
        self.assertEqual(row['payload']['acceptance'], original['acceptance'])
        self.assertIn('laptop playback', row['payload']['prompt'])
        with self.f.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events WHERE kind='coordinator_feedback'").fetchone()[0],1)
        with self.assertRaises(FactoryError): self.f.feedback('repair', actor='coordinator', message='x'*8001)

    def test_repair_starts_with_rejected_work_and_preserves_unchanged_file(self):
        self.add()
        first=self.f.run_once('mock')
        self.assertEqual(first['state'],'review',first['error'])
        self.f.review('repair', actor='reviewer', role='qa', approve=False, notes='A needs correction. Preserve B.')
        self.f.feedback('repair', actor='coordinator', message='Correct A and retain existing B.')
        row=self.f.task('repair');payload=row['payload']
        # Fixture emulates a second worker editing only A, rather than rewriting B.
        payload['mock']['files']={'a.txt':'corrected'}
        with self.f.transaction() as db:
            db.execute('UPDATE tasks SET payload=? WHERE id=?',(encoded(payload),'repair'))
        self.f.resume('repair')
        second=self.f.run_once('mock')
        self.assertEqual(second['state'],'review',second['error'])
        workspace=self.root/second['artifact']['workspace']
        self.assertEqual((workspace/'a.txt').read_text(),'corrected')
        self.assertEqual((workspace/'b.txt').read_text(),'retained')
        self.assertEqual(set(second['artifact']['files']),{'a.txt','b.txt'})

    def test_failed_attempt_is_reused_without_claiming_acceptance(self):
        self.add()
        row=self.f.task('repair');payload=row['payload'];payload['mock']['exit_code']=1
        with self.f.transaction() as db: db.execute('UPDATE tasks SET payload=? WHERE id=?',(encoded(payload),'repair'))
        first=self.f.run_once('mock')
        self.assertEqual(first['state'],'ready')
        self.assertIsNone(first['artifact'])
        self.assertIn('partial_artifact',first['payload'])
        payload=first['payload'];payload['mock']={'files':{'a.txt':'corrected'}}
        with self.f.transaction() as db: db.execute('UPDATE tasks SET payload=? WHERE id=?',(encoded(payload),'repair'))
        second=self.f.run_once('mock')
        self.assertEqual(second['state'],'review',second['error'])
        self.assertEqual((self.root/second['artifact']['workspace']/'b.txt').read_text(),'retained')

    def test_salvage_is_scoped_and_never_marks_work_reviewed(self):
        self.add();row=self.f.task('repair');payload=row['payload'];payload['mock']['exit_code']=1
        with self.f.transaction() as db: db.execute('UPDATE tasks SET payload=? WHERE id=?',(encoded(payload),'repair'))
        first=self.f.run_once('mock')
        row=self.f.salvage('repair',actor='coordinator')
        self.assertEqual(row['state'],'ready')
        self.assertIsNone(row['review'])
        self.assertEqual(set(row['payload']['partial_artifact']['files']),{'a.txt','b.txt'})

    def test_feedback_invalidates_stale_review_and_verified_acceptance(self):
        from factory.core import digest
        self.add();row=self.f.run_once('mock')
        old_hash=digest(encoded(row['payload']).encode())
        self.f.feedback('repair',actor='coordinator',message='Inspect the no-observation reading, not only normal latency.')
        with self.assertRaisesRegex(FactoryError,'guidance changed'):
            self.f.review('repair',actor='qa-reviewer',role='qa',approve=True,notes='Reviewed an old assignment.',expected_task_hash=old_hash)
        self.assertEqual(self.f.task('repair')['state'],'review')
        self.f.review('repair',actor='qa-reviewer',role='qa',approve=True,notes='Reviewed current guidance and artifact.')
        self.assertEqual(self.f.task('repair')['state'],'verified')
        row=self.f.feedback('repair',actor='coordinator',message='New artifact evidence requires another look.')
        self.assertEqual(row['state'],'review')
        self.assertIsNone(row['review'])
        with self.assertRaisesRegex(FactoryError,'approval'):
            self.f.integrate('repair')

    def test_explicit_budget_amendment_preserves_consumption_scope_and_checks(self):
        original=self.add()['payload']
        self.f.run_once('mock')
        row=self.f.amend_budget('repair',actor='coordinator',reason='New independent evidence requires one targeted repair.',max_attempts=4)
        self.assertEqual(row['attempts'],1)
        self.assertEqual(row['payload']['max_attempts'],4)
        self.assertEqual(row['payload']['scope'],original['scope'])
        self.assertEqual(row['payload']['checks'],original['checks'])
        with self.assertRaises(FactoryError): self.f.amend_budget('repair',actor='',reason='x',max_attempts=5)
        with self.assertRaises(FactoryError): self.f.amend_budget('repair',actor='coordinator',reason='x',max_attempts=11)

    def test_active_budget_amendment_applies_to_next_attempt_without_reset(self):
        self.f.add(task_id='active',role='frontend',actor='worker',scope=['a.txt'],acceptance='Reviewed implementation',checks=[[sys.executable,'-c','pass']],prompt='Implement the file.',provider_name='mock',mock={'files':{'a.txt':'x'}},timeout=10,max_attempts=1)
        task=self.f.claim('mock')
        self.f.amend_budget('active',actor='coordinator',reason='New evidence requires one bounded follow-up.',max_attempts=2)
        self.f.finish(task,error='Fixture failure')
        row=self.f.task('active')
        self.assertEqual(row['state'],'ready')
        self.assertEqual(row['attempts'],1)
        self.assertEqual(row['payload']['max_attempts'],2)
