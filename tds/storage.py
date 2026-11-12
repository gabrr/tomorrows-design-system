"""Atomic local storage with constrained identifiers and serialized writes."""
import json
import os
import re
import tempfile
import threading
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parent if (PACKAGE.parent / 'AGENTS.md').exists() else Path.cwd()
WEB = ROOT / 'web' if (ROOT / 'web' / 'index.html').exists() else PACKAGE / '_web'
CONTRACT = ROOT / 'docs' / 'CONTRACT.md' if (ROOT / 'docs' / 'CONTRACT.md').exists() else PACKAGE / '_resources' / 'CONTRACT.md'
DATA = Path(os.environ.get('TDS_DATA_DIR', str(ROOT / '.tds')))
LOCK = threading.RLock()

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value):
        raise ValueError('Use an identifier with 1–100 letters, numbers, dashes or underscores.')
    return value

def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default

def atomic_json(path, value):
    path = Path(path)
    encoded = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    with LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.write-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

def save_project(project_id, project):
    project_id = identifier(project_id)
    if project.get('id') != project_id:
        raise ValueError('Project identifier must match its URL.')
    atomic_json(DATA / 'projects' / (project_id + '.json'), project)
    return project

def get_project(project_id):
    value = read_json(DATA / 'projects' / (identifier(project_id) + '.json'))
    if value is None:
        raise FileNotFoundError('Project not found.')
    return value

def list_projects():
    result = []
    with LOCK:
        for path in sorted((DATA / 'projects').glob('*.json')):
            try:
                project = read_json(path)
                result.append({'id': project['id'], 'name': project['name'], 'nodes': len(project.get('nodes', [])), 'updated_at': path.stat().st_mtime})
            except (ValueError, KeyError, TypeError):
                continue
    return result

def delete_project(project_id):
    with LOCK:
        (DATA / 'projects' / (identifier(project_id) + '.json')).unlink()
