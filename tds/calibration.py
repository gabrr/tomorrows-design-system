"""Explicit measurement import and held-out validation, separate from assumptions."""
import copy
import math
import statistics


def finite(value, name, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum:
        raise ValueError(name + ' must be a finite number >= ' + str(minimum))
    return value


def calibrate(project, measurements):
    """Apply measured service latency, never infer capacity from response latency.

    measurements: [{node_id, source, samples_ms, capacity_rps?, measured_at?}].
    Service-time samples must exclude queue/network time; caller attests source.
    """
    if not isinstance(measurements, list) or not measurements or len(measurements) > 100:
        raise ValueError('Supply 1–100 component measurement sets.')
    proposal = copy.deepcopy(project)
    by_id = {node['id']: node for node in proposal['nodes']}
    report, seen = [], set()
    for measurement in measurements:
        if not isinstance(measurement, dict):
            raise ValueError('Measurement must be an object.')
        key = measurement.get('node_id')
        if key not in by_id or key in seen:
            raise ValueError('Measurement node is missing or duplicated.')
        seen.add(key)
        source = measurement.get('source')
        if not isinstance(source, str) or not source.strip() or len(source) > 2000:
            raise ValueError('Every measurement requires an identifiable source.')
        samples = measurement.get('samples_ms')
        if not isinstance(samples, list) or not 10 <= len(samples) <= 10000:
            raise ValueError('Supply 10–10,000 service-time samples per component.')
        samples = [finite(v, 'Service time') for v in samples]
        # An explicit split makes model fit and validation distinguishable.
        train, holdout = samples[::2], samples[1::2]
        mean = statistics.mean(train)
        residual = statistics.mean(abs(sample - mean) for sample in holdout)
        config = by_id[key].setdefault('config', {})
        config['latency_ms'] = mean
        if 'capacity_rps' in measurement:
            config['capacity_rps'] = finite(measurement['capacity_rps'], 'Measured capacity', 0.000001)
        evidence = {'source': source, 'measured_at': measurement.get('measured_at'), 'sample_count': len(samples), 'training_count': len(train), 'holdout_count': len(holdout), 'service_mean_ms': mean, 'holdout_mean_absolute_error_ms': residual, 'model': 'constant mean service latency', 'limitations': ['Single-workload calibration; not a validated extrapolation under contention.', 'No distribution fit; queueing and network time must be excluded from service samples.']}
        config['calibration'] = evidence
        report.append({'node_id': key, **evidence})
    return {'proposal': proposal, 'calibration': report, 'warnings': ['Review and apply this proposal explicitly. Calibration does not establish accuracy for different workloads.']}


def compare_observations(result, observations):
    if not isinstance(result, dict) or not isinstance(result.get('summary'), dict):
        raise ValueError('Simulation result must contain a summary object.')
    if not isinstance(observations, dict):
        raise ValueError('Observations must map metric names to measured values and tolerances.')
    checks = []
    for metric, observation in observations.items():
        if metric not in result.get('summary', {}) or not isinstance(observation, dict):
            raise ValueError('Unknown summary metric or invalid observation: ' + metric)
        measured = finite(observation.get('value'), 'Measured value')
        tolerance = finite(observation.get('absolute_tolerance'), 'Absolute tolerance')
        predicted = finite(result['summary'][metric], 'Predicted value')
        error = abs(predicted - measured)
        checks.append({'metric': metric, 'predicted': predicted, 'measured': measured, 'absolute_error': error, 'absolute_tolerance': tolerance, 'passed': error <= tolerance})
    if not checks:
        raise ValueError('Supply at least one observed metric.')
    return {'checks': checks, 'passed': all(check['passed'] for check in checks)}
