"""Seeded, bounded discrete-event architecture model (Python standard library).

This is a service-station model, not a protocol or cloud emulator. The returned
assumptions are part of the result: estimates must not be presented as calibrated
measurements. All times internal to the engine are seconds.
"""

from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field
import heapq
import json
import math
import random

from .catalog import catalog, CATALOG_VERSION


MODEL_VERSION = "tds-des-1.0"
MAX_REQUESTS = 100_000
MAX_VISITS = 500_000
MAX_OPERATIONS = 3_000_000
_COMPONENTS = {item["type"]: item for item in catalog()["components"]}
_NUMERIC_CONFIG = {
    "capacity_rps": (0.001, 1_000_000), "latency_ms": (0, 3_600_000),
    "concurrency": (1, 100_000), "queue_limit": (0, 100_000),
    "replicas": (1, 1000), "hourly_cost": (0, 1e9),
    "health_check_delay": (0, 3600), "cache_hit_rate": (0, 1),
    "latency_jitter": (0, 1), "ingress_weight": (0.001, 1e6),
    "cost_per_request": (0, 1e9), "request_cost_per_million": (0, 1e9),
    "input_tokens": (0, 1e9), "output_tokens": (0, 1e9),
    "input_cost_per_million": (0, 1e9), "output_cost_per_million": (0, 1e9),
    "egress_bytes": (0, 1e12), "egress_cost_per_gb": (0, 1e9),
}
_INTEGER_CONFIG = {"concurrency", "queue_limit", "replicas"}
_CONFIG_KEYS = set(_NUMERIC_CONFIG) | {"provider", "region", "routing", "async_dispatch", "initial_state", "pricing_provenance", "model", "calibration", "instance_class"}
_EDGE_NUMBERS = {"latency_ms": (0, 3_600_000), "weight": (0.001, 1e6),
                 "capacity_rps": (0.001, 1e6), "throughput_rps": (0.001, 1e6),
                 "bandwidth_mbps": (0.001, 1e9), "payload_bytes": (0, 1e12),
                 "queue_limit": (0, 100_000), "egress_cost_per_gb": (0, 1e9)}
_SCENARIO_NUMBERS = {"duration": (1, 3600), "rps": (0, 20_000), "seed": (0, 2**53 - 1)}
_MONTHLY_NUMBERS = {"hours": (0, 8784), "traffic_multiplier": (0, 1e6)}


def validation_constraints():
    """Publish the validator's numeric rules for the actual editing controls."""
    def rules(bounds, integers=()):
        return {key: {"min": low, "max": high, "integer": key in integers}
                for key, (low, high) in bounds.items()}
    return {"node_config": rules(_NUMERIC_CONFIG, _INTEGER_CONFIG),
            "edge": rules(_EDGE_NUMBERS, {"queue_limit"}),
            "scenario": rules(_SCENARIO_NUMBERS, {"seed"}),
            "monthly": rules(_MONTHLY_NUMBERS)}


def _number(value, low, high, integer=False):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and low <= value <= high and math.isfinite(value)
            and (not integer or int(value) == value))


def _metadata(value, depth=0):
    """Bounded descriptive metadata never changes simulation semantics."""
    if depth > 6:
        return False
    if value is None or isinstance(value, bool):
        return True
    if isinstance(value, int):
        return abs(value) <= 10 ** 300
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, str):
        return len(value) <= 4000
    if isinstance(value, list):
        return len(value) <= 100 and all(_metadata(v, depth + 1) for v in value)
    if isinstance(value, dict):
        return len(value) <= 100 and all(isinstance(k, str) and len(k) <= 100 and _metadata(v, depth + 1) for k, v in value.items())
    return False


def _identifier(value):
    return isinstance(value, str) and 0 < len(value) <= 128 and all(ord(c) >= 32 for c in value)


def _config(node):
    return dict(_COMPONENTS[node["type"]]["defaults"], **node.get("config", {}))


def _topology(nodes, edges):
    outgoing = {n["id"]: [] for n in nodes}
    degree = {n["id"]: 0 for n in nodes}
    for edge in edges:
        outgoing[edge["source"]].append(edge)
        degree[edge["target"]] += 1
    roots = [key for key in outgoing if not degree[key]]
    ready, ordered = deque(roots), []
    while ready:
        key = ready.popleft()
        ordered.append(key)
        for edge in outgoing[key]:
            degree[edge["target"]] -= 1
            if not degree[edge["target"]]:
                ready.append(edge["target"])
    return outgoing, roots, ordered


def validate(project):
    """Return actionable errors without mutating the supplied project.

    Unknown behavioral fields are rejected, including retries and cycles: their
    performance cannot be honestly inferred by this model.
    """
    errors = []
    if not isinstance(project, dict):
        return ["project must be an object"]
    if "id" in project and not _identifier(project["id"]):
        errors.append("project.id is invalid")
    if "name" in project and (not isinstance(project["name"], str) or len(project["name"]) > 1000):
        errors.append("project.name must be a string (max 1000)")
    nodes, edges = project.get("nodes"), project.get("edges", [])
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 100:
        return ["nodes must contain 1..100 components"]
    if not isinstance(edges, list) or len(edges) > 300:
        return ["edges must be a list with at most 300 edges"]
    ids = set()
    for i, node in enumerate(nodes):
        prefix = f"nodes[{i}]"
        if not isinstance(node, dict):
            errors.append(f"{prefix} must be an object")
            continue
        key = node.get("id")
        if not _identifier(key):
            errors.append(f"{prefix}.id must be a nonempty printable string (max 128)")
        elif key in ids:
            errors.append(f"duplicate node id: {key}")
        else:
            ids.add(key)
        for coordinate in ("x", "y"):
            if coordinate in node and not _number(node[coordinate], -1e9, 1e9):
                errors.append(f"{prefix}.{coordinate} must be a finite coordinate")
        if "label" in node and (not isinstance(node["label"], str) or len(node["label"]) > 1000):
            errors.append(f"{prefix}.label must be a string (max 1000)")
        for name in set(node) - {"id", "type", "label", "x", "y", "config"}:
            errors.append(f"{prefix}.{name} is unsupported; behavior belongs in config")
        if not isinstance(node.get("type"), str) or node["type"] not in _COMPONENTS:
            errors.append(f"{prefix}.type is unsupported")
        config = node.get("config", {})
        if not isinstance(config, dict):
            errors.append(f"{prefix}.config must be an object")
            continue
        for name, value in config.items():
            if name not in _CONFIG_KEYS:
                errors.append(f"{prefix}.config.{name} is unsupported")
            elif name in _NUMERIC_CONFIG and not _number(value, *_NUMERIC_CONFIG[name], name in _INTEGER_CONFIG):
                errors.append(f"{prefix}.config.{name} is outside its supported numeric range")
            elif name == "routing" and value not in ("all", "weighted"):
                errors.append(f"{prefix}.config.routing must be all or weighted")
            elif name == "initial_state" and value not in ("up", "down"):
                errors.append(f"{prefix}.config.initial_state must be up or down")
            elif name == "async_dispatch" and not isinstance(value, bool):
                errors.append(f"{prefix}.config.async_dispatch must be boolean")
            elif name in ("pricing_provenance", "calibration") and (not isinstance(value, (str, dict)) or not _metadata(value) or len(json.dumps(value)) > 16000):
                errors.append(f"{prefix}.config.{name} must be bounded JSON metadata (max 16 KiB)")
            elif name in ("provider", "region", "model", "instance_class") and (not isinstance(value, str) or len(value) > 1000):
                errors.append(f"{prefix}.config.{name} must be a string (max 1000)")
    edge_ids = set()
    for i, edge in enumerate(edges):
        if not isinstance(edge, dict):
            errors.append(f"edges[{i}] must be an object")
            continue
        key = edge.get("id")
        if not _identifier(key):
            errors.append(f"edges[{i}].id is invalid")
        elif key in edge_ids:
            errors.append(f"duplicate edge id: {key}")
        else:
            edge_ids.add(key)
        for endpoint in ("source", "target"):
            if not isinstance(edge.get(endpoint), str) or edge[endpoint] not in ids:
                errors.append(f"edges[{i}].{endpoint} is not a node id")
        for name, value in edge.items():
            if name in _EDGE_NUMBERS and not _number(value, *_EDGE_NUMBERS[name], name == "queue_limit"):
                errors.append(f"edges[{i}].{name} is outside its supported numeric range")
            elif name == "async" and not isinstance(value, bool):
                errors.append(f"edges[{i}].async must be boolean")
            elif name not in set(_EDGE_NUMBERS) | {"id", "source", "target", "async", "label"}:
                errors.append(f"edges[{i}].{name} is unsupported")
        if "capacity_rps" in edge and "throughput_rps" in edge:
            errors.append(f"edges[{i}] must use only one of capacity_rps and throughput_rps")
        if "label" in edge and (not isinstance(edge["label"], str) or len(edge["label"]) > 1000):
            errors.append(f"edges[{i}].label must be a string (max 1000)")
    scenario = project.get("scenario", {})
    if not isinstance(scenario, dict):
        return errors + ["scenario must be an object"]
    for name in scenario:
        if name not in {"duration", "seed", "rps", "events"}:
            errors.append(f"scenario.{name} is unsupported")
    duration, rps = scenario.get("duration", 60), scenario.get("rps", 100)
    if not _number(duration, *_SCENARIO_NUMBERS["duration"]):
        errors.append("scenario.duration must be between 1 and 3600 seconds")
    if not _number(rps, *_SCENARIO_NUMBERS["rps"]):
        errors.append("scenario.rps must be between 0 and 20000")
    if not _number(scenario.get("seed", 42), *_SCENARIO_NUMBERS["seed"], True):
        errors.append("scenario.seed must be an integer between 0 and 2^53-1")
    events = scenario.get("events", [])
    if not isinstance(events, list) or len(events) > 1000:
        return errors + ["scenario.events must be a list with at most 1000 events"]
    event_ids, rates = set(), [rps]
    for i, event in enumerate(events):
        prefix = f"events[{i}]"
        if not isinstance(event, dict):
            errors.append(f"{prefix} must be an object")
            continue
        key = event.get("id")
        if not _identifier(key):
            errors.append(f"{prefix}.id is invalid")
        elif key in event_ids:
            errors.append(f"duplicate event id: {key}")
        else:
            event_ids.add(key)
        kind, target = event.get("type"), event.get("target")
        if kind not in ("fail", "recover", "traffic", "latency", "scale"):
            errors.append(f"{prefix}.type is unsupported")
        if not isinstance(target, str) or (target not in ids if kind != "traffic" else target != "global"):
            errors.append(f"{prefix}.target must be {'global' if kind == 'traffic' else 'a node id'}")
        for name in event:
            if name not in {"id", "type", "target", "time", "value", "trigger", "window", "field"}:
                errors.append(f"{prefix}.{name} is unsupported")
        if "time" not in event and "window" not in event and "trigger" not in event:
            errors.append(f"{prefix} needs time, window or trigger")
        if "time" in event and (not _number(duration, 1, 3600) or not _number(event["time"], 0, duration)):
            errors.append(f"{prefix}.time must be within the simulation")
        window = event.get("window")
        if window is not None:
            if (not isinstance(window, list) or len(window) != 2 or not _number(duration, 1, 3600)
                    or not all(_number(v, 0, duration) for v in window) or window[0] > window[1]):
                errors.append(f"{prefix}.window must be [start,end] within the simulation")
            elif "time" in event and _number(event["time"], 0, duration) and not window[0] <= event["time"] <= window[1]:
                errors.append(f"{prefix}.time must lie within window")
        if kind in ("traffic", "latency", "scale"):
            limits = (0, 20_000) if kind == "traffic" else ((0, 3_600_000) if kind == "latency" else (0.001, 1e6))
            scale_field = event.get("field", "capacity_rps")
            if kind == "scale" and scale_field not in ("capacity_rps", "replicas", "concurrency"):
                errors.append(f"{prefix}.field is unsupported")
            if kind == "scale" and isinstance(scale_field, str) and scale_field in _NUMERIC_CONFIG:
                limits = _NUMERIC_CONFIG[scale_field]
            if not _number(event.get("value"), *limits, kind == "scale" and isinstance(scale_field, str) and scale_field in _INTEGER_CONFIG):
                errors.append(f"{prefix}.value is outside its supported numeric range")
            if kind == "traffic":
                rates.append(event.get("value"))
        if "field" in event and kind != "scale":
            errors.append(f"{prefix}.field is only supported for scale events")
        if kind in ("fail", "recover") and "value" in event and not _number(event["value"], 0, 1e12):
            errors.append(f"{prefix}.value must be finite and nonnegative (unused for fail/recover)")
        if "trigger" in event:
            trigger = event["trigger"]
            if not isinstance(trigger, dict):
                errors.append(f"{prefix}.trigger must be an object")
            else:
                if trigger.get("metric") not in ("queue_depth", "utilization", "errors"):
                    errors.append(f"{prefix}.trigger.metric is unsupported")
                if not isinstance(trigger.get("target"), str) or trigger["target"] not in ids:
                    errors.append(f"{prefix}.trigger.target is not a node id")
                if trigger.get("operator") != "gte":
                    errors.append(f"{prefix}.trigger.operator must be gte")
                if not _number(trigger.get("value"), 0, 1e12):
                    errors.append(f"{prefix}.trigger.value must be finite and nonnegative")
                if set(trigger) - {"metric", "target", "operator", "value"}:
                    errors.append(f"{prefix}.trigger contains unsupported fields")
    monthly = project.get("monthly", {})
    if not isinstance(monthly, dict):
        errors.append("monthly must be an object")
    else:
        for name, value in monthly.items():
            if name not in ("hours", "traffic_multiplier"):
                errors.append(f"monthly.{name} is unsupported")
            elif not _number(value, *_MONTHLY_NUMBERS[name]):
                errors.append(f"monthly.{name} is outside its supported numeric range")
    if errors:
        return errors
    outgoing, roots, ordered = _topology(nodes, edges)
    if len(ordered) != len(nodes):
        return ["topology must be a directed acyclic graph; cycles and self-loops are unsupported"]
    # Upper bound includes fan-out multiplicity, even when branches converge.
    visits = {}
    by_id = {n["id"]: n for n in nodes}
    for key in reversed(ordered):
        branches = [visits[e["target"]] for e in outgoing[key]]
        visits[key] = 1 + (max(branches, default=0) if _config(by_id[key]).get("routing") == "weighted" else sum(branches))
    arrivals = math.ceil(duration * max(rates)) + len(events) + 1
    if arrivals > MAX_REQUESTS:
        errors.append(f"workload budget exceeded: at most {MAX_REQUESTS} potential arrivals per run")
    if max(visits.values()) > 2048 or arrivals * max(visits[root] for root in roots) > MAX_VISITS:
        errors.append(f"topology/workload expansion exceeds the {MAX_VISITS} node-visit budget")
    if (math.ceil(duration) + 1) * (len(nodes) + len(edges)) > 100_000:
        errors.append("metrics frame budget exceeded (100000 node/edge samples)")
    return errors


@dataclass
class _Flow:
    started: float
    background: bool = False
    done: bool = False


@dataclass(eq=False)
class _Call:
    node: str
    flow: _Flow
    parent: object = None
    pending: int = 0
    success: bool = True
    done: bool = False


@dataclass
class _Node:
    spec: dict
    config: dict
    up: bool = True
    waiting: deque = field(default_factory=deque)
    active: set = field(default_factory=set)
    next_start: float = 0
    dispatch_at: object = None
    received: int = 0
    started: int = 0
    completed: int = 0
    failed: int = 0
    hits: int = 0
    misses: int = 0
    peak_queue: int = 0
    replica_seconds: float = 0
    cost_updated: float = 0
    observed: dict = field(default_factory=dict)
    last_started: object = None


def _rate_sources(config, explicit):
    record = config.get("pricing_provenance")
    record = record if isinstance(record, dict) else {}
    mapping = {"hourly_cost": "hourly_cost", "cost_per_request": "request_cost",
               "input_cost_per_million": "input_per_million", "output_cost_per_million": "output_per_million"}
    sources = {}
    subject_matches = all(key not in record or record[key] == config.get(target) for key, target in (("provider", "provider"), ("model", "model"), ("region", "region"), ("sku", "instance_class")))
    applied = record.get("applied_fields")
    if applied is not None and not isinstance(applied, list):
        applied = []
    for name in ("hourly_cost", "cost_per_request", "request_cost_per_million", "input_cost_per_million", "output_cost_per_million", "egress_cost_per_gb"):
        raw = mapping.get(name)
        matched = (raw in record if raw else False) and config.get(name) == record.get(raw) and (applied is None or name in applied) and record.get("currency") == "USD" and subject_matches
        kind = ("provider-published quote" if record.get("provenance") == "provider-published" else "recorded quote; source not independently verified") if matched else ("unknown; omitted usage rate" if name not in config else "manual estimate" if name in explicit else "illustrative default")
        sources[name] = {"value": config.get(name), "kind": kind}
        if matched:
            sources[name].update(source=record.get("source"), retrieved_at=record.get("retrieved_at"), record_id=record.get("id"))
    return sources


def _percentile(values, percentile):
    return values[max(0, math.ceil(len(values) * percentile) - 1)] * 1000 if values else 0.0


class _Engine:
    def __init__(self, project):
        self.project = project
        scenario = project.get("scenario", {})
        self.duration = scenario.get("duration", 60)
        self.seed = int(scenario.get("seed", 42))
        self.rng = random.Random(self.seed)
        self.now = 0.0
        self.heap, self.sequence = [], 0
        self.nodes = {n["id"]: _Node(n, _config(n)) for n in project["nodes"]}
        self.outgoing, self.roots, _ = _topology(project["nodes"], project.get("edges", []))
        for node in self.nodes.values():
            node.up = node.config.get("initial_state", "up") == "up"
            node.observed = {key: self.nodes[key].config.get("initial_state", "up") == "up" for key in self.nodes}
        self.edges = {e["id"]: dict(spec=e, requests=0, delivered=0, failed=0, pending=0,
                                   next_start=0.0, last_requests=0) for e in project.get("edges", [])}
        self.requests = self.completed = self.failed = 0
        self.jobs = self.jobs_completed = self.jobs_failed = 0
        self.visits = self.operations = 0
        self.latencies, self.job_latencies = [], []
        self.frames, self.event_log = [], []
        self.conditions = []
        self.applied = set()
        self.rate = scenario.get("rps", 100)
        self.traffic_version = 0
        for event in scenario.get("events", []):
            if "trigger" in event:
                self.conditions.append(event)
            else:
                when = event.get("time")
                if "window" in event:
                    start, end = event["window"]
                    when = self.rng.uniform(max(start, event.get("time", start)), end)
                self.push(when, 0, "scenario", event)
        if self.rate:
            self.push(self.rng.random() / self.rate, 3, "arrival", self.traffic_version)
        for second in range(math.floor(self.duration) + 1):
            self.push(second, 9, "frame", None)
        if self.duration != math.floor(self.duration):
            self.push(self.duration, 9, "frame", None)

    def push(self, when, priority, kind, data):
        if when <= self.duration:
            self.sequence += 1
            heapq.heappush(self.heap, (when, priority, self.sequence, kind, data))

    def schedule_dispatch(self, key):
        node = self.nodes[key]
        if not node.up or not node.waiting or len(node.active) >= node.config["concurrency"] * node.config.get("replicas", 1):
            return
        when = max(self.now, node.next_start)
        if node.dispatch_at is None or when < node.dispatch_at:
            node.dispatch_at = when
            self.push(when, 4, "dispatch", (key, when))

    def finish(self, call, success):
        if call.done:
            return
        call.done = True
        if call.parent is not None:
            parent = call.parent
            parent.pending -= 1
            parent.success = parent.success and success
            if parent.pending == 0:
                self.finish(parent, parent.success)
        elif not call.flow.done:
            flow = call.flow
            flow.done = True
            if flow.background:
                if success:
                    self.jobs_completed += 1
                    self.job_latencies.append(self.now - flow.started)
                else:
                    self.jobs_failed += 1
            elif success:
                self.completed += 1
                self.latencies.append(self.now - flow.started)
            else:
                self.failed += 1

    def receive(self, call):
        self.visits += 1
        if self.visits > MAX_VISITS:
            raise ValueError("runtime node-visit budget exceeded")
        node = self.nodes[call.node]
        node.received += 1
        # An immediately available service slot does not consume queue capacity.
        immediate = (not node.waiting and len(node.active) < node.config["concurrency"] * node.config.get("replicas", 1)
                     and node.next_start <= self.now)
        if not node.up or (not immediate and len(node.waiting) >= node.config["queue_limit"]):
            node.failed += 1
            self.finish(call, False)
            return
        node.waiting.append(call)
        if immediate:
            self.dispatch(call.node)
        else:
            node.peak_queue = max(node.peak_queue, len(node.waiting))
            self.schedule_dispatch(call.node)

    def dispatch(self, key):
        node = self.nodes[key]
        node.dispatch_at = None
        if (not node.up or not node.waiting or node.next_start > self.now
                or len(node.active) >= node.config["concurrency"] * node.config.get("replicas", 1)):
            self.schedule_dispatch(key)
            return
        call = node.waiting.popleft()
        node.active.add(call)
        node.started += 1
        node.last_started = self.now
        node.next_start = self.now + 1 / (node.config["capacity_rps"] * node.config.get("replicas", 1))
        jitter = node.config.get("latency_jitter", 0)
        service = node.config["latency_ms"] / 1000
        if jitter:
            service *= self.rng.uniform(1 - jitter, 1 + jitter)
        self.push(self.now + service, 2, "service", call)
        self.schedule_dispatch(key)

    def service_done(self, call):
        node = self.nodes[call.node]
        if call not in node.active:
            return  # A failure already terminated this service.
        node.active.remove(call)
        node.completed += 1
        self.schedule_dispatch(call.node)
        edges = self.outgoing[call.node]
        if "cache_hit_rate" in node.config:
            if self.rng.random() < node.config["cache_hit_rate"]:
                node.hits += 1
                edges = []
            else:
                node.misses += 1
        if node.config.get("routing") == "weighted" and edges:
            edges = [e for e in edges if node.observed[e["target"]]]
            if not edges:
                node.failed += 1
                self.finish(call, False)
                return
            edges = [self.rng.choices(edges, weights=[e.get("weight", 1) for e in edges], k=1)[0]]
        sync = [e for e in edges if not (e.get("async", False) or node.config.get("async_dispatch", False))]
        call.pending = len(sync)
        for edge in edges:
            background = edge.get("async", False) or node.config.get("async_dispatch", False)
            if background:
                self.jobs += 1
                flow = _Flow(self.now, background=True)
                child = _Call(edge["target"], flow)
            else:
                child = _Call(edge["target"], call.flow, call)
            self.send(edge, child)
        if not sync:
            self.finish(call, True)

    def send(self, spec, call):
        edge = self.edges[spec["id"]]
        edge["requests"] += 1
        start = max(self.now, edge["next_start"])
        interval = 0.0
        rate = spec.get("capacity_rps", spec.get("throughput_rps"))
        if rate is not None:
            interval = 1 / rate
        if "bandwidth_mbps" in spec:
            interval = max(interval, spec.get("payload_bytes", 0) * 8 / (spec["bandwidth_mbps"] * 1e6))
        if start > self.now and edge["pending"] >= spec.get("queue_limit", 100_000):
            edge["failed"] += 1
            self.finish(call, False)
            return
        edge["next_start"] = start + interval
        edge["pending"] += 1
        # Include transmission time for bandwidth; an RPS limit spaces admissions only.
        transmission = spec.get("payload_bytes", 0) * 8 / (spec["bandwidth_mbps"] * 1e6) if "bandwidth_mbps" in spec else 0
        self.push(start + transmission + spec.get("latency_ms", 0) / 1000, 2, "delivery", (spec["id"], call))

    def apply(self, event):
        if event["id"] in self.applied:
            return
        self.applied.add(event["id"])
        kind, target = event["type"], event["target"]
        if kind == "traffic":
            self.rate = event["value"]
            self.traffic_version += 1
            if self.rate:
                self.push(self.now + 1 / self.rate, 3, "arrival", self.traffic_version)
        else:
            node = self.nodes[target]
            if kind in ("fail", "recover"):
                node.up = kind == "recover"
                for key, router in self.nodes.items():
                    if router.config.get("routing") == "weighted":
                        self.push(self.now + router.config.get("health_check_delay", 0), 1, "health", (key, target, node.up))
                if not node.up:
                    doomed = list(node.active) + list(node.waiting)
                    node.active.clear()
                    node.waiting.clear()
                    node.failed += len(doomed)
                    for call in doomed:
                        self.finish(call, False)
                else:
                    self.schedule_dispatch(target)
            elif kind == "latency":
                node.config["latency_ms"] = event["value"]
            elif kind == "scale":
                name = event.get("field", "capacity_rps")
                node.replica_seconds += (self.now - node.cost_updated) * node.config.get("replicas", 1)
                node.cost_updated = self.now
                node.config[name] = event["value"]
                # Existing service and admission reservations are preserved; scaling
                # affects future work, not work already admitted.
                self.schedule_dispatch(target)
        self.event_log.append(dict(id=event["id"], time=self.now, type=kind, target=target,
                                   message=f"Applied {kind}" + (f" = {event['value']}" if "value" in event else "")))

    def utilization(self, node):
        slots = node.config["concurrency"] * node.config.get("replicas", 1)
        rate_busy = 1.0 if node.waiting and node.up else 0.0
        return min(1.0, max(len(node.active) / slots, rate_busy)) if node.up else 0.0

    def frame(self):
        for event in self.conditions:
            if event["id"] in self.applied:
                continue
            start, end = event.get("window", [0, self.duration])
            if not max(start, event.get("time", 0)) <= self.now <= end:
                continue
            trigger = event["trigger"]
            node = self.nodes[trigger["target"]]
            metric = {"queue_depth": len(node.waiting), "utilization": self.utilization(node), "errors": node.failed}[trigger["metric"]]
            if metric >= trigger["value"]:
                self.apply(event)
        edge_metrics = {}
        previous_time = self.frames[-1]["time"] if self.frames else self.now
        interval = self.now - previous_time
        for key, edge in self.edges.items():
            edge_metrics[key] = dict(requests=edge["requests"], rps=(edge["requests"] - edge["last_requests"]) / interval if interval else 0,
                                     delivered=edge["delivered"], failed=edge["failed"], inflight=edge["pending"])
            edge["last_requests"] = edge["requests"]
        self.frames.append(dict(time=self.now, requests=self.requests, completed=self.completed, failed=self.failed,
                                inflight=self.requests - self.completed - self.failed,
                                background_jobs=self.jobs, background_completed=self.jobs_completed,
                                background_failed=self.jobs_failed, background_pending=self.jobs - self.jobs_completed - self.jobs_failed,
                                nodes={key: dict(state="up" if node.up else "down", utilization=self.utilization(node),
                                                 queue_depth=len(node.waiting), inflight=len(node.active),
                                                 received=node.received, started=node.started, completed=node.completed,
                                                 failed=node.failed, cache_hits=node.hits, cache_misses=node.misses,
                                                 capacity_rps=node.config["capacity_rps"] * node.config.get("replicas", 1),
                                                 replicas=node.config.get("replicas", 1)) for key, node in self.nodes.items()},
                                edges=edge_metrics))

    def run(self):
        while self.heap:
            self.now, _, _, kind, data = heapq.heappop(self.heap)
            self.operations += 1
            if self.operations > MAX_OPERATIONS:
                raise ValueError("runtime event budget exceeded")
            if kind == "arrival":
                if data != self.traffic_version:
                    continue
                self.requests += 1
                if self.requests > MAX_REQUESTS:
                    raise ValueError("runtime request budget exceeded")
                key = self.rng.choices(self.roots, weights=[self.nodes[k].config.get("ingress_weight", 1) for k in self.roots], k=1)[0]
                self.receive(_Call(key, _Flow(self.now)))
                self.push(self.now + 1 / self.rate, 3, "arrival", data)
            elif kind == "dispatch":
                key, when = data
                if self.nodes[key].dispatch_at == when:
                    self.dispatch(key)
            elif kind == "service":
                self.service_done(data)
            elif kind == "delivery":
                key, call = data
                self.edges[key]["pending"] -= 1
                self.edges[key]["delivered"] += 1
                self.receive(call)
            elif kind == "health":
                key, target, up = data
                self.nodes[key].observed[target] = up
            elif kind == "scenario":
                self.apply(data)
            elif kind == "frame":
                self.frame()
        return self.result()

    def costs(self):
        monthly = self.project.get("monthly", {})
        hours, multiplier = monthly.get("hours", 730), monthly.get("traffic_multiplier", 1)
        usage_factor = hours * 3600 / self.duration * multiplier
        rows = []
        for key, node in self.nodes.items():
            c = node.config
            replica_seconds = node.replica_seconds + (self.duration - node.cost_updated) * c.get("replicas", 1)
            fixed = replica_seconds / 3600 * c["hourly_cost"]
            request_cost = node.started * (c.get("cost_per_request", 0) + c.get("request_cost_per_million", 0) / 1e6)
            token_cost = node.started * (c.get("input_tokens", 0) * c.get("input_cost_per_million", 0)
                                         + c.get("output_tokens", 0) * c.get("output_cost_per_million", 0)) / 1e6
            egress_cost = node.started * c.get("egress_bytes", 0) / 1e9 * c.get("egress_cost_per_gb", 0)
            usage = request_cost + token_cost + egress_cost
            rate_sources = _rate_sources(c, node.spec.get("config", {}))
            rows.append(dict(id=key, label=node.spec.get("label", key), experiment_cost=fixed + usage,
                             monthly_cost=fixed * hours * 3600 / self.duration + usage * usage_factor,
                             infrastructure_cost=fixed, request_cost=request_cost, token_cost=token_cost,
                             egress_cost=egress_cost, billable_requests=node.started,
                             rate_sources=rate_sources,
                             provenance_summary="; ".join(name + ": " + item["kind"] for name, item in rate_sources.items() if item["value"] is not None),
                             rates={name: c.get(name) for name in ("hourly_cost", "cost_per_request", "request_cost_per_million",
                                                                  "input_cost_per_million", "output_cost_per_million", "egress_cost_per_gb")},
                             defaulted_rates=[] if "hourly_cost" in node.spec.get("config", {}) else ["hourly_cost"],
                             provenance=c.get("pricing_provenance", "manual estimate; illustrative configured rates")))
        for key, edge in self.edges.items():
            spec = edge["spec"]
            if "egress_cost_per_gb" in spec:
                # Only delivered transfers are billed by this simplified model.
                usage = edge["delivered"] * spec.get("payload_bytes", 0) / 1e9 * spec["egress_cost_per_gb"]
                rows.append(dict(id=key, label=f"Edge {key}", experiment_cost=usage, monthly_cost=usage * usage_factor,
                                 egress_cost=usage, provenance="manual estimate; configured edge egress rate"))
        return rows

    def result(self):
        latencies, job_latencies = sorted(self.latencies), sorted(self.job_latencies)
        costs = self.costs()
        monthly = self.project.get("monthly", {})
        # Keep the evaluated input with the evidence, independent of later edits.
        snapshot = {key: deepcopy(value) for key, value in self.project.items()
                    if key in {"id", "name", "nodes", "edges", "scenario", "monthly"}}
        return dict(model_version=MODEL_VERSION, catalog_version=CATALOG_VERSION, seed=self.seed, duration=self.duration, project=snapshot,
                    summary=dict(requests=self.requests, completed=self.completed, failed=self.failed,
                                 pending=self.requests - self.completed - self.failed,
                                 availability=self.completed / self.requests if self.requests else 1.0,
                                 resolved_availability=self.completed / (self.completed + self.failed) if self.completed + self.failed else 1.0,
                                 p50_ms=_percentile(latencies, .50), p95_ms=_percentile(latencies, .95), p99_ms=_percentile(latencies, .99),
                                 background_jobs=self.jobs, background_completed=self.jobs_completed,
                                 background_failed=self.jobs_failed, background_pending=self.jobs - self.jobs_completed - self.jobs_failed,
                                 background_p95_ms=_percentile(job_latencies, .95),
                                 experiment_cost=sum(c["experiment_cost"] for c in costs),
                                 monthly_cost=sum(c["monthly_cost"] for c in costs)),
                    frames=self.frames, events=self.event_log, costs=costs,
                    budget=dict(node_visits=self.visits, operations=self.operations,
                                max_requests=MAX_REQUESTS, max_node_visits=MAX_VISITS, max_operations=MAX_OPERATIONS),
                    assumptions=[
                        "Uncalibrated illustrative service-station model; not measured cloud, database or AI accuracy.",
                        "Seeded paced arrivals (not Poisson), independent uniform latency jitter, weighted routing and independent cache hits.",
                        "Only DAGs; ordinary nodes synchronously fan out to every edge. A foreground call waits for all synchronous branches; there are no retries or cancellation.",
                        "Concurrency bounds local service only; downstream waiting releases the upstream service slot. Capacity spaces service admissions; replicas multiply capacity and concurrency.",
                        "Queues are bounded FIFO in memory. Failure drops queued/local active calls; work already sent downstream continues. Recovery permits new work; no replay.",
                        "Weighted routers observe failures and recoveries after health_check_delay seconds; no active probe requests. Cache hits bypass all outgoing edges, including async edges.",
                        "Async edges and queue components acknowledge after local service and create independent background flows; background failure does not fail a foreground request.",
                        "Events at a timestamp precede service/traffic, with input order breaking ties. Window events sample once uniformly from max(window start,time if provided) to window end. Conditions sample once per second (also at the final partial frame), use cumulative local errors, and fire at most once in input order.",
                        "Ingress selects one root node per request using ingress_weight (default equal); disconnected roots share the offered traffic. Deployment boundaries do not contain other nodes.",
                        "Traffic events target global and replace RPS. Scale defaults to setting capacity_rps; field may be replicas or concurrency. Latency and scale changes affect future admissions only.",
                        "Node inflight counts local service; global inflight counts unresolved foreground requests. Utilization is occupied service slots, or 1 while an up node has queued work; it is a saturation indicator, not CPU usage.",
                        "Edge rate limits serialize admissions; bandwidth serializes payload transmission. Edge queue_limit bounds outstanding transfers when admission would wait; no packet loss or protocol model.",
                        "Runs stop at duration with pending work retained in counts. Availability is completed/all arrivals (pending included); resolved_availability excludes pending. Nearest-rank percentiles include successful completions only.",
                        "Quote provenance applies only to matched rate fields; unmodified/defaulted rates remain estimates. Published prices do not calibrate usage. USD costs use configured manual estimates unless pricing_provenance says otherwise. Rates default to illustrative hourly cost; missing usage rates are zero, not free-provider claims. Failed started services are billable; rejected services are not.",
                        "Monthly projection assumes " + str(monthly.get("hours", 730)) + " hours at experiment-average provisioned replicas, including downtime, and experiment-average billable usage times traffic_multiplier=" + str(monthly.get("traffic_multiplier", 1)) + ". No tiering, tax, discounts or capacity re-simulation; egress GB is decimal. Node and edge egress rates both charge if both are configured.",
                    ])


def simulate(project):
    """Validate and run a project; raise ValueError for invalid/unsupported input."""
    errors = validate(project)
    if errors:
        raise ValueError("; ".join(errors))
    return _Engine(project).run()
