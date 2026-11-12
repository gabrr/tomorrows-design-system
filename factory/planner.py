"""Standalone planner and coordinator review before unattended delivery.

Example: python3 -m factory.planner --brief docs/features/example.md --run
The trusted local caller supplies scope/check boundaries; AI cannot expand them.
"""
import argparse
import json
import time
from pathlib import Path
from .core import Factory, FactoryError, atomic_json, relative_path
from .autopilot import Autopilot, REVIEW_SCHEMA, validate_plan

PLAN_SCHEMA = {'type': 'object', 'properties': {'tasks_json': {'type': 'string'}, 'rationale': {'type': 'string'}}, 'required': ['tasks_json', 'rationale'], 'additionalProperties': False}


def invoke(factory, prompt, schema, directory, timeout=300):
    directory.mkdir(parents=True, exist_ok=True)
    atomic_json(directory / 'schema.json', schema)
    output = directory / 'result.json'
    argv = ['codex', 'exec', '--ephemeral', '--sandbox', 'read-only', '--json', '-C', str(factory.root), '--output-schema', str(directory / 'schema.json'), '-o', str(output), '-']
    result = factory.run_process(argv, factory.root, directory / 'worker.log', timeout, stdin_text=prompt)
    if result['returncode'] or not output.exists() or output.stat().st_size > 500000:
        raise FactoryError('Planning/review worker failed; inspect its retained log.')
    return json.loads(output.read_text())


def create_plan(root, brief, scopes, checks, concurrency=2, seconds=7200):
    factory = Factory(root)
    factory.init(concurrency=concurrency, total_seconds=seconds)
    scopes = [relative_path(scope, directory=True) for scope in scopes]
    if len(brief.encode()) > 64000:
        raise FactoryError('Brief exceeds 64 KiB; split it into bounded milestones.')
    context = ''
    for name in ('docs/PLAN.md', 'docs/CONTRACT.md', 'skills/planning/SKILL.md'):
        context += '\n' + name + '\n' + (factory.root / name).read_text()
    directory = factory.home / 'plans' / str(time.time_ns())
    instruction = ('Act as planner/delivery specialist. Inspect the repository before proposing work. Produce tasks_json as a JSON array of bounded tasks '
                   'with id, role, scope, acceptance, prompt, dependencies (earlier ids), timeout (<=1200). No commands or tools in task output. '
                   'Each task should fit a focused context and require actual evidence. Roles must be from this registry: '
                   + json.dumps(list(factory.roles())) + '. Only these path scopes are allowed: ' + json.dumps(scopes)
                   + '. Trusted checks are fixed outside your control: ' + json.dumps(checks)
                   + '. Do not modify files. Include independent QA and human-factors artifact inspection where applicable.\n'
                   + context + '\nUSER BRIEF:\n' + brief)
    coordinator_context = (factory.root / 'skills/coordinator/SKILL.md').read_text() + '\n' + (factory.root / 'skills/agent-reliability/SKILL.md').read_text()
    deadline = time.monotonic() + seconds
    feedback = ''
    for revision in range(3):
        attempt = directory / str(revision + 1)
        attempt.mkdir(parents=True, exist_ok=True)
        allowance = min(300, deadline - time.monotonic())
        if allowance <= 0:
            raise FactoryError('Planning wall-clock budget exhausted.')
        try:
            proposal = invoke(factory, instruction + feedback, PLAN_SCHEMA, attempt / 'planner', timeout=allowance)
            tasks = json.loads(proposal['tasks_json'])
            plan = {'version': 1, 'provider': 'codex', 'allowed_scopes': scopes, 'checks': checks, 'concurrency': concurrency, 'total_seconds': seconds, 'max_repairs': 2, 'tasks': tasks}
            validate_plan(plan, factory.roles())
            for task in tasks:
                if not 1 <= task.get('timeout', 600) <= 1200:
                    raise FactoryError('Task timeout exceeds planner allowance.')
                task.setdefault('timeout', 600)
            atomic_json(attempt / 'proposal.json', plan)
            allowance = min(300, deadline - time.monotonic())
            if allowance <= 0:
                raise FactoryError('Planning wall-clock budget exhausted.')
            review = invoke(factory, 'Act as independent coordinator. Inspect the actual repository and proposed plan. Check feasibility, task/context size, dependencies, test sufficiency, human usability, unsupported assumptions and coverage of the brief. Do not edit files. Approve only if no unresolved findings.\n' + coordinator_context + '\nBRIEF:\n' + brief + '\nPLAN:\n' + json.dumps(plan), REVIEW_SCHEMA, attempt / 'coordinator', timeout=allowance)
            atomic_json(attempt / 'review.json', review)
            if type(review.get('approve')) is not bool or not isinstance(review.get('findings'), list) or not all(isinstance(item, str) for item in review['findings']) or not isinstance(review.get('notes'), str) or not review['notes'].strip():
                raise FactoryError('Invalid coordinator decision.')
            if review['approve'] and not review['findings']:
                remaining = deadline - time.monotonic()
                if remaining < 1:
                    raise FactoryError('Planning wall-clock budget exhausted.')
                plan['total_seconds'] = remaining
                path = directory / 'approved.json'
                atomic_json(path, plan)
                return path, plan
            feedback = '\nCOORDINATOR REQUESTED REVISION:\n' + review['notes'] + '\n' + '\n'.join(review['findings']) + '\nPREVIOUS TASKS:\n' + json.dumps(tasks)[:24000]
        except (FactoryError, ValueError, KeyError, TypeError) as error:
            feedback = '\nPLAN VALIDATION REPAIR:\n' + str(error)[:16000]
            attempt.mkdir(parents=True, exist_ok=True)
            atomic_json(attempt / 'validation-error.json', {'error': str(error), 'revision': revision + 1})
    raise FactoryError('Planning revisions exhausted. Retained feedback: ' + feedback[:16000])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--brief', type=Path, required=True)
    parser.add_argument('--scope', action='append', help='Allowed subtree; repeat for multiple. Defaults to tds/, web/, docs/features/.')
    parser.add_argument('--seconds', type=int, default=7200)
    parser.add_argument('--concurrency', type=int, default=2)
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    try:
        path, plan = create_plan(args.root, args.brief.read_text(), args.scope or ['tds/', 'web/', 'docs/features/'], [['python3', 'scripts/check.py']], args.concurrency, args.seconds)
        print('Approved plan: ' + str(path), flush=True)
        if args.run:
            report = Autopilot(args.root, plan).run()
            print(json.dumps(report, indent=2))
            raise SystemExit(0 if report['completed'] else 1)
    except (FactoryError, ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')

if __name__ == '__main__':
    main()
