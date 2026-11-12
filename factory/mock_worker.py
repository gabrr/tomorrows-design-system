"""Subprocess fault fixture; not a model, approval service, or shell runner."""

import json
import os
from pathlib import Path
import signal
import sys
import time


def main():
    fixture = json.loads(Path(sys.argv[1]).read_text())
    # Consume the supervisor's prompt to exercise the same stdin path as Codex.
    sys.stdin.read()
    time.sleep(fixture.get("sleep", 0))
    if fixture.get("kill_self"):
        os.kill(os.getpid(), signal.SIGKILL)
    for name, value in fixture.get("files", {}).items():
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or ".git" in path.parts:
            raise ValueError("unsafe mock fixture")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    result = fixture.get("result", {
        "schema_version": 1, "task_id": fixture["id"], "summary": "Mock artifact",
        "evidence": [{"kind": "artifact", "path": next(iter(fixture.get("files", {})), "AGENTS.md"),
                      "description": "Inspect fixture artifact"}]})
    Path(sys.argv[2]).write_text("not json" if fixture.get("malformed") else json.dumps(result))
    return fixture.get("exit_code", 0)


if __name__ == "__main__":
    sys.exit(main())
