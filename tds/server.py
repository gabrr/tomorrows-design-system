"""Loopback-only local application server; no external deployment required."""
import argparse
import copy
import json
import logging
import math
import mimetypes
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from . import __version__
from .storage import ROOT, WEB, DATA, atomic_json, read_json, identifier, save_project, get_project, list_projects, delete_project

SIMULATIONS = threading.BoundedSemaphore(2)
LOGGER = logging.getLogger('tds')
MAX_BODY = 2 * 1024 * 1024

def reject_constant(value):
    raise ValueError('JSON values must be finite: ' + value)

def run_simulation(project):
    from .simulation import simulate
    from .pricing import get_prices
    if not SIMULATIONS.acquire(blocking=False):
        raise ValueError('Two simulations are already running. Try again when one finishes.')
    try:
        result = simulate(project)
        snapshot = get_prices()
        result['pricing_snapshots'] = snapshot['snapshots']
        result['referenced_pricing_snapshot_ids'] = sorted({record['snapshot_id'] for node in project.get('nodes', []) if isinstance(record := node.get('config', {}).get('pricing_provenance'), dict) and isinstance(record.get('snapshot_id'), str)})
        result['project_snapshot'] = copy.deepcopy(project)
        result['run_id'] = secrets.token_hex(12)
        result['created_at'] = time.time()
        atomic_json(DATA / 'runs' / (result['run_id'] + '.json'), result)
        return result
    finally:
        SIMULATIONS.release()

class Handler(BaseHTTPRequestHandler):
    server_version = 'TomorrowsDesignSystem/' + __version__

    def log_message(self, fmt, *args):
        LOGGER.info('%s %s', self.address_string(), fmt % args)

    def send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(body)

    def respond(self, value, status=200):
        self.send_bytes(status, json.dumps(value, ensure_ascii=False, allow_nan=False).encode(), 'application/json; charset=utf-8')

    def trusted(self):
        port = self.server.server_port
        allowed = {'127.0.0.1:' + str(port), 'localhost:' + str(port)}
        if self.headers.get('Host') not in allowed:
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in {'http://' + host for host in allowed}:
            return False
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return False
        return True

    def body(self):
        if self.headers.get('Transfer-Encoding'):
            raise ValueError('Chunked requests are not supported.')
        content_type = self.headers.get('Content-Type', '').split(';')[0]
        if content_type != 'application/json':
            raise ValueError('Send JSON with Content-Type application/json.')
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0 or length > MAX_BODY:
            raise ValueError('Request body must be between 1 byte and 2 MiB.')
        result = json.loads(self.rfile.read(length), parse_constant=reject_constant)
        if not isinstance(result, dict):
            raise ValueError('Request JSON must be an object.')
        return result

    def dispatch(self, method):
        if not self.trusted():
            self.respond({'error': 'Only same-origin loopback requests are permitted.'}, 403)
            return
        try:
            path = unquote(urlsplit(self.path).path)
            if path == '/favicon.ico' and method == 'GET':
                return self.send_bytes(200, (WEB / 'icons' / 'graph.svg').read_bytes(), 'image/svg+xml')
            if not path.startswith('/api/'):
                if method != 'GET':
                    self.respond({'error': 'Method not allowed.'}, 405)
                    return
                relative = 'index.html' if path == '/' else path.lstrip('/')
                static_root = WEB.resolve()
                target = (static_root / relative).resolve()
                if not target.is_relative_to(static_root) or not target.is_file():
                    raise FileNotFoundError('File not found.')
                self.send_bytes(200, target.read_bytes(), (mimetypes.guess_type(str(target))[0] or 'application/octet-stream') + ('; charset=utf-8' if target.suffix in ('.html', '.js', '.css') else ''))
                return
            from .catalog import catalog, presets
            from .simulation import validate, validation_constraints
            if method == 'GET':
                if path == '/api/health':
                    return self.respond({'status': 'ok', 'version': __version__})
                if path == '/api/catalog':
                    return self.respond(dict(catalog(), constraints=validation_constraints()))
                if path == '/api/presets':
                    return self.respond({'presets': presets()})
                if path == '/api/projects':
                    return self.respond({'projects': list_projects()})
                if path.startswith('/api/projects/'):
                    return self.respond(get_project(path.rsplit('/', 1)[1]))
                if path == '/api/pricing':
                    from .pricing import get_prices
                    return self.respond(get_prices())
                if path == '/api/ai':
                    from .ai import capabilities
                    return self.respond(capabilities())
                if path == '/api/factory':
                    try:
                        from factory import status
                        state = status(ROOT)
                    except (ImportError, AttributeError):
                        try:
                            from factory.core import status
                            state = status(ROOT)
                        except (ImportError, AttributeError):
                            state = {'initialized': False, 'tasks': [], 'message': 'Initialize the factory with python3 -m factory init.'}
                    return self.respond(state)
                if path == '/api/runs':
                    runs = []
                    for file in sorted((DATA / 'runs').glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:100]:
                        run = read_json(file)
                        runs.append({key: run.get(key) for key in ('run_id', 'created_at', 'model_version', 'summary')})
                    return self.respond({'runs': runs})
                if path.startswith('/api/runs/'):
                    run = read_json(DATA / 'runs' / (identifier(path.rsplit('/', 1)[1]) + '.json'))
                    if run is None:
                        raise FileNotFoundError('Run not found.')
                    return self.respond(run)
            if method == 'DELETE' and path.startswith('/api/projects/'):
                delete_project(path.rsplit('/', 1)[1])
                return self.respond({'deleted': True})
            if method == 'PUT' and path.startswith('/api/projects/'):
                project = self.body()
                errors = validate(project)
                if errors:
                    raise ValueError('; '.join(errors[:15]))
                return self.respond(save_project(path.rsplit('/', 1)[1], project))
            if method == 'POST':
                body = self.body()
                if path == '/api/validate':
                    errors = validate(body)
                    return self.respond({'valid': not errors, 'errors': errors, 'warnings': ['Capacity and latency defaults are illustrative until calibrated.']})
                if path == '/api/simulate':
                    return self.respond(run_simulation(body))
                if path == '/api/ai/generate':
                    from .ai import generate
                    from .simulation import validate_ai_context
                    errors = validate_ai_context(body.get('project', {}))
                    if errors:
                        raise ValueError('; '.join(errors[:8]))
                    return self.respond(generate(body.get('prompt'), body['project'], body.get('provider', 'codex')))
                if path == '/api/calibration':
                    from .calibration import calibrate
                    errors = validate(body.get('project', {}))
                    if errors:
                        raise ValueError('; '.join(errors[:8]))
                    return self.respond(calibrate(body['project'], body.get('measurements')))
                if path == '/api/observations/compare':
                    from .calibration import compare_observations
                    return self.respond(compare_observations(body.get('result', {}), body.get('observations')))
                if path == '/api/pricing/refresh':
                    from .pricing import refresh_prices
                    return self.respond(refresh_prices(body.get('provider', 'openrouter')))
                if path == '/api/pricing/apply':
                    from .pricing import get_prices
                    project = body.get('project', {})
                    errors = validate(project)
                    if errors:
                        raise ValueError('; '.join(errors[:8]))
                    record = next((r for r in get_prices()['records'] if r['id'] == body.get('record_id') and r['provider'] == body.get('provider')), None)
                    if record is None:
                        raise ValueError('Price record not found. Refresh the provider catalog first.')
                    if record.get('currency', 'USD') != 'USD':
                        raise ValueError('This catalog record is not priced in USD. Convert it explicitly before using it in a USD simulation.')
                    node = next((n for n in project.get('nodes', []) if n['id'] == body.get('node_id')), None)
                    if node is None:
                        raise ValueError('Select an architecture component.')
                    config = node.setdefault('config', {})
                    if 'hourly_cost' in record and record.get('unit') not in ('instance-hour', 'hour', '1 Hour', 'Hrs'):
                        raise ValueError('Catalog billing unit is not an instance-hour; this price cannot be applied as an hourly rate.')
                    if any(key in record for key in ('input_per_million', 'output_per_million')) and record.get('unit') != 'USD / million tokens':
                        raise ValueError('Catalog token billing unit is unsupported; configure a verified per-million-token rate.')
                    applicable = ['hourly_cost', 'input_per_million', 'output_per_million', 'request_cost']
                    if not any(k in record for k in applicable):
                        raise ValueError('This SKU uses a specialized billing unit. Configure the appropriate rate manually; it cannot be treated as an hourly price.')
                    for key in applicable:
                        if key in record:
                            config[{'input_per_million': 'input_cost_per_million', 'output_per_million': 'output_cost_per_million', 'request_cost': 'cost_per_request'}.get(key, key)] = record[key]
                    recorded = dict(record, applied_fields=[{'input_per_million': 'input_cost_per_million', 'output_per_million': 'output_cost_per_million', 'request_cost': 'cost_per_request'}.get(key, key) for key in applicable if key in record])
                    config.update({'provider': record['provider'], 'pricing_provenance': recorded, 'model': record.get('model', config.get('model', ''))})
                    if record.get('region'):
                        config['region'] = record['region']
                    if record.get('sku'):
                        config['instance_class'] = record['sku']
                    errors = validate(project)
                    if errors:
                        raise ValueError('; '.join(errors[:8]))
                    return self.respond({'project': project, 'record': record})
            self.respond({'error': 'Endpoint not found.'}, 404)
        except FileNotFoundError as error:
            self.respond({'error': str(error)}, 404)
        except (ValueError, TypeError, KeyError, OverflowError) as error:
            self.respond({'error': str(error)}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            LOGGER.exception('Request failed')
            self.respond({'error': 'The operation failed. Details are recorded in the local server log; your saved project was preserved.'}, 500)

    def do_GET(self): self.dispatch('GET')
    def do_POST(self): self.dispatch('POST')
    def do_PUT(self): self.dispatch('PUT')
    def do_DELETE(self): self.dispatch('DELETE')
    def do_OPTIONS(self): self.respond({'error': 'Cross-origin access is disabled.'}, 403)

class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(300)
        return connection, address

def main():
    parser = argparse.ArgumentParser(description='Run Tomorrow’s Design System locally.')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    with LocalServer(('127.0.0.1', args.port), Handler) as server:
        print(f'Tomorrow’s Design System: http://127.0.0.1:{server.server_port}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.', flush=True)
