#!/usr/bin/env python3
"""Deterministic API/factory checks plus the actual Astryx frontend contracts."""
import compileall
import subprocess
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
for folder in ('tds', 'factory'):
    if not compileall.compile_dir(root / folder, quiet=1):
        raise SystemExit(1)
for command in ([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v'], ['npm', 'run', 'typecheck'], ['node', 'scripts/check-ui.mjs'], ['npm', 'run', 'build']):
    subprocess.run(command, cwd=root, check=True)
