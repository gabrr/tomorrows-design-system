"""Shared plan/execution bounds; no persistence or model calls."""
import math
import re

def task_limit_errors(task_id, timeout=300, max_attempts=2, lease_seconds=15):
    errors = []
    if not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', task_id):
        errors.append('Invalid task id')
    if type(max_attempts) is not int or not 1 <= max_attempts <= 10:
        errors.append('max_attempts must be 1..10')
    for name, value, low, high in [('timeout', timeout, 0.001, 86400), ('lease_seconds', lease_seconds, 0.2, 300)]:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high or not math.isfinite(value):
            errors.append('Invalid ' + name)
    return errors
