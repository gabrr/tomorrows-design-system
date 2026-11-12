"""Bounded unattended delivery/review loop over an explicit local plan.

Run `python3 -m factory.autopilot PLAN.json --root .`. Trusted checks and
allowed paths come from the plan, never from worker or reviewer output.
"""
import argparse
import concurrent.futures
import json
import subprocess
import time
import uuid
from pathlib import Path
from .core import Factory, FactoryError, atomic_json, digest, safe_file, in_scope, relative_path
from .validation import task_limit_errors
from .providers import provider

REVIEW_SCHEMA = {'type': 'object', 'properties': {'approve': {'type': 'boolean'}, 'notes': {'type': 'string'}, 'findings': {'type': 'array', 'items': {'type': 'string'}}}, 'required': ['approve', 'notes', 'findings'], 'additionalProperties': False}


def validate_plan(plan, roles):
    if not isinstance(plan, dict) or type(plan.get('version')) is not int or plan['version'] != 1:
        raise FactoryError('Plan requires version: 1.')
    tasks = plan.get('tasks')
    if not isinstance(tasks, list) or not 1 <= len(tasks) <= 100:
        raise FactoryError('Plan requires 1–100 tasks.')
    checks = plan.get('checks')
    if not isinstance(checks, list) or not checks:
        raise FactoryError('Plan requires trusted check argv lists.')
    for argv in checks:
        if not isinstance(argv, list) or not argv or not all(isinstance(v, str) and v and '\x00' not in v for v in argv):
            raise FactoryError('Invalid trusted check argv.')
    allowed = plan.get('allowed_scopes')
    if not isinstance(allowed, list) or not allowed:
        raise FactoryError('Plan requires explicit allowed_scopes.')
    if not isinstance(plan.get('provider', 'codex'), str):
        raise FactoryError('Provider must be an approved adapter name.')
    provider(plan.get('provider', 'codex'))
    for boundary in allowed:
        relative_path(boundary, directory=True)
    seen = set()
    for task in tasks:
        if not isinstance(task, dict) or not isinstance(task.get('id'), str) or task['id'] in seen:
            raise FactoryError('Task identifiers must be unique strings.')
        errors = task_limit_errors(task['id'], task.get('timeout', 300), task.get('max_attempts', 2), task.get('lease_seconds', 15))
        if errors:
            raise FactoryError('; '.join(errors))
        if isinstance(task.get('prompt'), str) and len(task['prompt'].encode()) > 64000:
            raise FactoryError('Task prompt exceeds 64 KiB.')
        if not isinstance(task.get('role'), str) or task['role'] not in roles:
            raise FactoryError('Task role is not approved.')
        if not task.get('scope') or not isinstance(task['scope'], list):
            raise FactoryError('Task needs an explicit scope.')
        for entry in task['scope']:
            relative_path(entry, directory=True)
            if not isinstance(entry, str) or not any(in_scope(entry.rstrip('/'), [bound]) or entry == bound for bound in allowed):
                raise FactoryError('Task scope exceeds plan boundary: ' + str(entry))
            if any(part in ('.git', '.factory', '..') for part in Path(entry).parts) or entry.startswith('/'):
                raise FactoryError('Unsafe task scope.')
        if not isinstance(task.get('prompt'), str) or not task['prompt'].strip() or not isinstance(task.get('acceptance'), str) or not task['acceptance'].strip():
            raise FactoryError('Task needs prompt and acceptance.')
        if not isinstance(task.get('dependencies', []), list) or any(not isinstance(dep, str) or dep not in seen for dep in task.get('dependencies', [])):
            raise FactoryError('Tasks must be topologically ordered with known dependencies.')
        seen.add(task['id'])
    for key, maximum in [('concurrency', 8), ('max_repairs', 5)]:
        value = plan.get(key, 2)
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum or key == 'concurrency' and value == 0:
            raise FactoryError('Invalid plan ' + key)
    review_timeout = plan.get('review_timeout', 600)
    if isinstance(review_timeout, bool) or not isinstance(review_timeout, (int, float)) or not 30 <= review_timeout <= 900:
        raise FactoryError('review_timeout must be between 30 and 900 seconds.')
    seconds = plan.get('total_seconds', 7200)
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 1 <= seconds <= 86400:
        raise FactoryError('Invalid total_seconds budget.')
    return plan


class Autopilot:
    def __init__(self, root, plan, reviewer=None):
        self.factory = Factory(root)
        self.plan = validate_plan(plan, self.factory.roles())
        self.reviewer = reviewer or self.codex_review
        self.report_path = self.factory.home / 'autopilot.json'
        self.deadline = 0

    def codex_review(self, row):
        artifact = row['artifact']
        task = row['payload']
        marker = safe_file(self.factory.root, artifact['workspace'] + '/AGENTS.md', internal=True)
        if not marker.is_file():
            raise FactoryError('Review worktree context is missing.')
        workspace = marker.parent
        directory = self.factory.home / 'reviews' / (row['id'] + '-' + str(row['attempts']) + '-' + uuid.uuid4().hex[:12])
        directory.mkdir(parents=True, exist_ok=True)
        schema, output = directory / 'schema.json', directory / 'result.json'
        atomic_json(schema, REVIEW_SCHEMA)
        role = 'qa' if task['role'] != 'qa' else 'reliability-human-factors'
        skill = self.factory.roles()[role]['skills'][0]
        guidance = safe_file(self.factory.root, skill).read_text()
        prompt = ('Act as independent ' + role + ' reviewer. Read actual changed files, artifact patch, evidence and check logs; do not trust worker claims. '
                  'Do not edit files, commit or approve unsupported claims. Evaluate user comprehension and simulation honesty as relevant. '
                  'Require every acceptance criterion; return concrete findings and notes. Empty findings required for approval.\n'
                  + guidance + '\nORIGIN PROJECT ROOT (artifact/log paths are relative here):\n' + str(self.factory.root) + '\nREVIEW WORKTREE:\n' + str(workspace) + '\nACCEPTANCE:\n' + task['acceptance'] + '\nASSIGNMENT:\n' + task['prompt']
                  + '\nARTIFACT METADATA:\n' + json.dumps(artifact) + '\nPATCH:\n'
                  + safe_file(self.factory.root, artifact['patch'], internal=True).read_text(errors='replace')[:150000])
        argv = ['codex', 'exec', '--ephemeral', '--sandbox', 'read-only', '--json', '-C', str(workspace), '--output-schema', str(schema), '-o', str(output), '-']
        # Reviewer execution has its own bounded allowance inside the plan wall budget.
        seconds = min(self.plan.get('review_timeout', 600), max(0.01, self.deadline - time.monotonic()))
        record = self.factory.run_process(argv, workspace, directory / 'review.log', seconds, stdin_text=prompt)
        if record['returncode'] or not output.exists() or output.stat().st_size > 100000:
            raise FactoryError('Independent reviewer failed or returned oversized output.')
        decision = json.loads(output.read_text())
        if not isinstance(decision, dict) or type(decision.get('approve')) is not bool or not isinstance(decision.get('notes'), str) or not decision['notes'].strip() or not isinstance(decision.get('findings'), list) or not all(isinstance(f, str) for f in decision['findings']):
            raise FactoryError('Malformed reviewer output.')
        if decision['approve'] and decision['findings']:
            raise FactoryError('Reviewer cannot approve unresolved findings.')
        # Review result stays tied to the exact artifact hash.
        atomic_json(directory / 'decision.json', {'decision': decision, 'sha256': artifact['sha256'], 'execution': record})
        return decision

    def reconcile_repairs(self):
        """Recover a committed rejection even if the supervisor died before requeue."""
        from .core import encoded
        with self.factory.transaction() as db:
            for row in db.execute("SELECT * FROM tasks WHERE state='blocked' AND review IS NOT NULL").fetchall():
                review = json.loads(row['review'])
                payload = json.loads(row['payload'])
                if review.get('approve') or payload.get('repair_count', 0) >= self.plan.get('max_repairs', 2) or row['attempts'] >= payload['max_attempts']:
                    continue
                payload['repair_count'] = payload.get('repair_count', 0) + 1
                payload['prompt'] += '\nINDEPENDENT REVIEW REPAIR:\n' + review['notes']
                db.execute("UPDATE tasks SET payload=?,state='ready',error=NULL,updated=? WHERE id=? AND state='blocked'", (encoded(payload), time.time(), row['id']))
                self.factory.event(db, row['id'], 'repair_requested', {'repair_count': payload['repair_count'], 'review_at': review['at']})
            # Dependency-only blockers can become eligible after a parent repair.
            for row in db.execute("SELECT * FROM tasks WHERE state='blocked' AND review IS NULL AND attempts=0 AND error IS NULL").fetchall():
                payload = json.loads(row['payload'])
                dependencies = [db.execute('SELECT state FROM tasks WHERE id=?', (dep,)).fetchone()[0] for dep in payload['dependencies']]
                if dependencies and not any(state in ('failed', 'blocked', 'cancelled') for state in dependencies):
                    db.execute("UPDATE tasks SET state='proposed',updated=? WHERE id=?", (time.time(), row['id']))
            self.factory.promote(db)

    def run(self):
        started = time.monotonic()
        total = self.plan.get('total_seconds', 7200)
        self.factory.init(concurrency=self.plan.get('concurrency', 2), total_seconds=total)
        path = self.factory.home / 'approved-plan.json'
        fingerprint = digest(json.dumps(self.plan, sort_keys=True).encode())
        prior = json.loads(path.read_text()) if path.exists() else None
        if prior and prior['sha256'] != fingerprint:
            raise FactoryError('Factory already has another approved plan. Use a separate checkout or archive its state explicitly.')
        created_at = prior.get('created_at') if prior else None
        if created_at is None and prior:
            # Migrate old state using the durable proposal event, not restart time.
            with self.factory.connect() as db:
                proposed = db.execute("SELECT MIN(at) FROM events WHERE kind='proposed'").fetchone()[0]
                created_at = proposed
        created_at = created_at if created_at is not None else time.time()
        wall_deadline = prior.get('wall_deadline', created_at + total) if prior else created_at + total
        self.deadline = time.monotonic() + max(0, wall_deadline - time.time())
        atomic_json(path, {'sha256': fingerprint, 'plan': self.plan, 'created_at': created_at, 'wall_deadline': wall_deadline})
        known = {task['id'] for task in self.factory.status()['tasks']}
        for task in self.plan['tasks']:
            if task['id'] not in known:
                self.factory.add(task_id=task['id'], role=task['role'], actor='worker-' + task['id'], scope=task['scope'], acceptance=task['acceptance'], checks=self.plan['checks'], prompt=task['prompt'], dependencies=task.get('dependencies', []), timeout=task.get('timeout', min(1200, total)), max_attempts=task.get('max_attempts', 2), provider_name=self.plan.get('provider', 'codex'), mock=task.get('mock'))
        report = {'plan_sha256': fingerprint, 'wall_deadline': wall_deadline, 'completed': False, 'decisions': [], 'blockers': []}
        existing = self.factory.status()
        if existing['tasks'] and all(task['state'] == 'integrated' for task in existing['tasks']):
            report.update(completed=True, elapsed_seconds=time.monotonic() - started, status=existing)
            atomic_json(self.report_path, report)
            return report
        # Repairs re-use the original bounded task. They start from baseline and receive
        # explicit findings; prior rejected patches remain evidence, never integrated.
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.plan.get('concurrency', 2)) as pool:
            active = set()
            while time.monotonic() < self.deadline:
                self.reconcile_repairs()
                self.factory.recover()
                state = self.factory.status()
                if sum(task.get('elapsed', 0) for task in state['tasks']) >= state['total_seconds'] and not active:
                    report['blockers'].append('Persistent execution budget exhausted.')
                    break
                if state['paused']:
                    report['blockers'].append('Factory paused. Resume explicitly to continue.')
                    break
                for future in list(active):
                    if future.done():
                        future.result()
                        active.remove(future)
                for brief in state['tasks']:
                    row = self.factory.task(brief['id'])
                    if row['state'] == 'review':
                        try:
                            decision = self.reviewer(row)
                            self.factory.review(row['id'], actor='reviewer-' + row['id'], role='qa' if row['payload']['role'] != 'qa' else 'reliability-human-factors', approve=decision['approve'], notes=decision['notes'] + '\n' + '\n'.join(decision['findings']), expected_task_hash=digest(json.dumps(row['payload'], sort_keys=True, separators=(',', ':')).encode()))
                            report['decisions'].append({'task': row['id'], **decision})
                            if not decision['approve']:
                                self.reconcile_repairs()
                        except (FactoryError, ValueError, OSError) as error:
                            report['blockers'].append(row['id'] + ': reviewer: ' + str(error))
                            self.factory.pause()
                    elif row['state'] == 'verified':
                        try:
                            self.factory.integrate(row['id'])
                        except (FactoryError, OSError) as error:
                            report['blockers'].append(row['id'] + ': integration: ' + str(error))
                            self.factory.pause()
                state = self.factory.status()
                terminal = {'integrated', 'failed', 'blocked', 'cancelled'}
                if all(task['state'] in terminal for task in state['tasks']) and not active:
                    report['completed'] = all(task['state'] == 'integrated' for task in state['tasks'])
                    break
                if not state['paused']:
                    ready = sum(task['state'] == 'ready' for task in state['tasks'])
                    for _ in range(min(ready, self.plan.get('concurrency', 2) - len(active))):
                        active.add(pool.submit(self.factory.run_once, self.plan.get('provider', 'codex')))
                if not active and not any(t['state'] in ('ready', 'review', 'verified', 'running') for t in state['tasks']):
                    report['blockers'].append('No runnable tasks remain.')
                    break
                atomic_json(self.report_path, {**report, 'status': state})
                time.sleep(0.2)
            else:
                report['blockers'].append('Plan wall-clock budget exhausted.')
                self.factory.pause()
                for task in self.factory.status()['tasks']:
                    if task['state'] == 'running':
                        self.factory.cancel(task['id'])
        report['elapsed_seconds'] = time.monotonic() - started
        report['status'] = self.factory.status()
        atomic_json(self.report_path, report)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        report = Autopilot(args.root, json.loads(args.plan.read_text())).run()
        print(json.dumps(report, indent=2))
        raise SystemExit(0 if report['completed'] else 1)
    except (FactoryError, ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')

if __name__ == '__main__':
    main()
