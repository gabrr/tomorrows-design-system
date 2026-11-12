"""Explicit provider registry. No shell commands or commands from model output."""

import json
import sys
from pathlib import Path


class CodexProvider:
    """Standalone CLI; retains configured approval policy and workspace sandbox."""

    name = "codex"

    def command(self, task, workspace, attempt_dir):
        schema = Path(__file__).with_name("result.schema.json").resolve()
        return ["codex", "exec", "--sandbox", "workspace-write", "--json",
                "--ephemeral", "--color", "never", "--cd", str(workspace),
                "--output-schema", str(schema), "--output-last-message",
                str(attempt_dir / "result.json"), "-"]


class MockProvider:
    """Deterministic subprocess fixture, never selected implicitly.

    Task mock payload may contain files, result, exit_code, sleep, malformed,
    or kill_self. Intended for isolated tests and local demos only.
    """

    name = "mock"

    def command(self, task, workspace, attempt_dir):
        fixture = attempt_dir / "mock.json"
        fixture.write_text(json.dumps({"id": task["id"], **task.get("mock", {})}))
        return [sys.executable, str(Path(__file__).with_name("mock_worker.py")),
                str(fixture), str(attempt_dir / "result.json")]


PROVIDERS = {"codex": CodexProvider, "mock": MockProvider}


def provider(name):
    if name not in PROVIDERS:
        raise ValueError("Unknown provider: " + name)
    return PROVIDERS[name]()
