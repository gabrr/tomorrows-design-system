"""Browser dispatch for the original model; no filesystem, subprocess or HTTP API."""
import json
from .simulation import simulate, validate
from .calibration import calibrate, compare_observations


def dispatch_json(path, encoded):
    body = json.loads(encoded)
    if path == '/api/validate':
        errors = validate(body)
        result = {'valid': not errors, 'errors': errors,
                  'warnings': ['Capacity and latency defaults are illustrative until calibrated.']}
    elif path == '/api/simulate':
        result = simulate(body)
    elif path == '/api/calibration':
        errors = validate(body.get('project', {}))
        if errors:
            raise ValueError('; '.join(errors[:8]))
        result = calibrate(body['project'], body.get('measurements'))
    elif path == '/api/observations/compare':
        result = compare_observations(body.get('result', {}), body.get('observations'))
    else:
        raise ValueError('Unsupported browser model action.')
    return json.dumps(result, allow_nan=False)
