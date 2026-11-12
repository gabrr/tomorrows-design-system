"""Local CLI. `python3 -m factory --help` is safe and never launches a worker."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from .core import Factory, FactoryError
from .providers import PROVIDERS


def parser():
    p = argparse.ArgumentParser(description='Durable local standalone code factory. No commits or deployment.',
                                epilog='Checks are explicit trusted JSON argv, never model-generated shell text. See factory/README.md.')
    p.add_argument('--root', default='.', help='Git repository root (default: current directory)')
    sub = p.add_subparsers(dest='command', required=True)
    init = sub.add_parser('init', help='Initialize ignored .factory SQLite state')
    init.add_argument('--concurrency', type=int, default=1)
    init.add_argument('--total-seconds', type=float, default=3600, help='Cumulative worker execution budget')
    sub.add_parser('status', help='Read dashboard JSON; never starts a worker')
    add = sub.add_parser('add', help='Add an explicitly scoped task with trusted checks')
    add.add_argument('id')
    add.add_argument('--role', required=True, help='Approved role name in agents/roles.json')
    add.add_argument('--actor', required=True, help='Worker actor identity, distinct from reviewer')
    add.add_argument('--scope', action='append', required=True, help='Exact relative file or subtree ending /; repeatable')
    add.add_argument('--acceptance', required=True)
    add.add_argument('--check', action='append', required=True, help='Trusted JSON argv, e.g. ["python3","-m","unittest"]')
    prompt = add.add_mutually_exclusive_group(required=True)
    prompt.add_argument('--prompt')
    prompt.add_argument('--prompt-file', type=Path)
    add.add_argument('--depends', action='append', default=[], help='Task id; must already exist')
    add.add_argument('--timeout', type=float, default=300)
    add.add_argument('--max-attempts', type=int, default=2)
    add.add_argument('--lease-seconds', type=float, default=15)
    add.add_argument('--provider', choices=sorted(PROVIDERS), default='codex')
    add.add_argument('--mock-file', type=Path, help='Explicit mock fixture JSON; requires --provider mock')
    run = sub.add_parser('run', help='Launch standalone CLI execution (explicit action)')
    run.add_argument('--provider', choices=sorted(PROVIDERS), default='codex')
    run.add_argument('--once', action='store_true', help='Claim at most one task; useful for smoke tests')
    run.add_argument('--workers', type=int, help='Explicit number of separate local supervisors; default one in this process')
    review = sub.add_parser('review', help='Record an external reviewer decision bound to artifact hash')
    review.add_argument('id')
    review.add_argument('--actor', required=True)
    review.add_argument('--role', required=True)
    choice = review.add_mutually_exclusive_group(required=True)
    choice.add_argument('--approve', action='store_true')
    choice.add_argument('--reject', action='store_true')
    review.add_argument('--notes', required=True, help='Actual artifact inspection findings, including acceptance evidence')
    amend = sub.add_parser('amend-budget', help='Explicit coordinator amendment; preserves consumed attempts and acceptance')
    amend.add_argument('id')
    amend.add_argument('--actor', required=True)
    amend.add_argument('--reason', required=True)
    amend.add_argument('--max-attempts', type=int, required=True)
    salvage = sub.add_parser('salvage', help='Recover scoped incomplete attempt files as unaccepted repair input')
    salvage.add_argument('id')
    salvage.add_argument('--actor', required=True)
    feedback = sub.add_parser('feedback', help='Record guidance for the next review/attempt; running stdin is unchanged')
    feedback.add_argument('id')
    feedback.add_argument('--actor', required=True)
    feedback.add_argument('--message', required=True)
    integrate = sub.add_parser('integrate', help='Rerun combined checks and journal scoped workspace changes; no commit')
    integrate.add_argument('id')
    sub.add_parser('pause', help='Stop new claims/integrations; active work is allowed to finish')
    resume = sub.add_parser('resume', help='Resume supervisor, or retry a terminal task within its original attempt budget')
    resume.add_argument('id', nargs='?')
    cancel = sub.add_parser('cancel', help='Cancel task and terminate its active process group')
    cancel.add_argument('id')
    sub.add_parser('recover', help='Recover expired leases and incomplete integration journal, idempotently')
    return p


def launch_workers(factory, args):
    if not 1 <= args.workers <= factory.status()['concurrency']:
        raise FactoryError('--workers must be 1..configured concurrency')
    children = []
    log_dir = factory.home / 'supervisors'
    log_dir.mkdir(exist_ok=True)
    try:
        for i in range(args.workers):
            argv = [sys.executable, '-m', 'factory', '--root', str(factory.root),
                    'run', '--provider', args.provider]
            if args.once:
                argv.append('--once')
            log = (log_dir / f'{os.getpid()}-{i}.log').open('wb')
            try:
                # Package import works when --root differs from the factory installation.
                env = os.environ.copy()
                package_root = str(Path(__file__).resolve().parent.parent)
                env['PYTHONPATH'] = package_root + os.pathsep + env.get('PYTHONPATH', '')
                children.append(subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT,
                                                 env=env, start_new_session=True))
            finally:
                log.close()
        codes = [child.wait() for child in children]
        return {'supervisor_exit_codes': codes, **factory.status()}
    except BaseException:
        # Supervisors terminate children on interrupt; SIGKILL crashes instead
        # intentionally leave leases for recover rather than guessing ownership.
        import signal
        for child in children:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGINT)
        for child in children:
            child.wait()
        raise


def main(argv=None):
    args = parser().parse_args(argv)
    factory = Factory(args.root)
    try:
        if args.command == 'init':
            result = factory.init(args.concurrency, args.total_seconds)
        elif args.command == 'status':
            result = factory.status()
        elif args.command == 'add':
            result = factory.add(task_id=args.id, role=args.role, actor=args.actor,
                                 scope=args.scope, acceptance=args.acceptance,
                                 checks=[json.loads(c) for c in args.check],
                                 prompt=args.prompt if args.prompt is not None else args.prompt_file.read_text(),
                                 dependencies=args.depends, timeout=args.timeout,
                                 max_attempts=args.max_attempts, lease_seconds=args.lease_seconds,
                                 provider_name=args.provider,
                                 mock=json.loads(args.mock_file.read_text()) if args.mock_file else None)
        elif args.command == 'run':
            if args.workers is not None:
                result = launch_workers(factory, args)
            else:
                outcomes = []
                while True:
                    item = factory.run_once(args.provider)
                    if item is None:
                        break
                    outcomes.append({'id': item['id'], 'state': item['state']})
                    if args.once:
                        break
                result = {'outcomes': outcomes, **factory.status()}
        elif args.command == 'review':
            result = factory.review(args.id, actor=args.actor, role=args.role,
                                    approve=args.approve, notes=args.notes)
        elif args.command == 'amend-budget':
            result = factory.amend_budget(args.id, actor=args.actor, reason=args.reason, max_attempts=args.max_attempts)
        elif args.command == 'salvage':
            result = factory.salvage(args.id, actor=args.actor)
        elif args.command == 'feedback':
            result = factory.feedback(args.id, actor=args.actor, message=args.message)
        elif args.command == 'integrate':
            result = factory.integrate(args.id)
        elif args.command == 'pause':
            result = factory.pause()
        elif args.command == 'resume':
            result = factory.resume(args.id)
        elif args.command == 'cancel':
            result = factory.cancel(args.id)
        else:
            result = factory.recover()
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (FactoryError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
