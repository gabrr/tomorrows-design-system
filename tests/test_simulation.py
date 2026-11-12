"""Reference invariants for the bounded, illustrative discrete-event model."""

from copy import deepcopy
import json
import unittest

from tds.catalog import catalog, presets
from tds.simulation import MAX_OPERATIONS, MAX_VISITS, simulate, validate


def node(key="app", kind="api_service", **config):
    return dict(id=key, type=kind, label=key, x=0, y=0, config=config)


def edge(source, target, **values):
    return dict(id=f"{source}-{target}", source=source, target=target, **values)


def project(nodes=None, edges=None, duration=10, rps=10, events=None, seed=42):
    return dict(id="test", name="Reference experiment", nodes=nodes or [node()], edges=edges or [],
                scenario=dict(duration=duration, seed=seed, rps=rps, events=events or []))


def event(key, kind, target="app", time=2, **values):
    return dict(id=key, type=kind, target=target, time=time, **values)


class SimulationTests(unittest.TestCase):
    def assert_counts(self, result):
        for frame in result["frames"]:
            self.assertEqual(frame["requests"], frame["completed"] + frame["failed"] + frame["inflight"])
            self.assertEqual(frame["background_jobs"], frame["background_completed"] + frame["background_failed"] + frame["background_pending"])
            for metrics in frame["nodes"].values():
                self.assertGreaterEqual(metrics["queue_depth"], 0)
                self.assertGreaterEqual(metrics["inflight"], 0)
                self.assertTrue(0 <= metrics["utilization"] <= 1)
        summary = result["summary"]
        self.assertEqual(summary["requests"], summary["completed"] + summary["failed"] + summary["pending"])
        self.assertLessEqual(summary["p50_ms"], summary["p95_ms"])
        self.assertLessEqual(summary["p95_ms"], summary["p99_ms"])

    def test_reproducibility_no_mutation_and_seed_variation(self):
        p = project([node("cache", "cache", cache_hit_rate=.5, latency_jitter=.4), node("db", latency_ms=100)],
                    [edge("cache", "db")], duration=12, rps=15)
        before = deepcopy(p)
        a = simulate(p)
        self.assertEqual(a, simulate(p))
        self.assertEqual(p, before)
        self.assertEqual(a["project"], before)
        p["scenario"]["seed"] += 1
        self.assertNotEqual(a["frames"], simulate(p)["frames"])
        self.assert_counts(a)
        json.dumps(a, allow_nan=False)

    def test_known_latency_and_every_second_frames(self):
        p = project([node(latency_ms=25, capacity_rps=1000)], duration=5, rps=10)
        r = simulate(p)
        self.assertEqual(r["summary"]["requests"], 50)
        self.assertEqual(r["summary"]["completed"], 50)
        self.assertAlmostEqual(r["summary"]["p50_ms"], 25)
        self.assertAlmostEqual(r["summary"]["p99_ms"], 25)
        self.assertEqual([f["time"] for f in r["frames"]], list(range(6)))
        self.assert_counts(r)

    def test_fractional_duration_final_frame_and_pending(self):
        r = simulate(project([node(latency_ms=10000)], duration=2.5, rps=2))
        self.assertEqual([f["time"] for f in r["frames"]], [0, 1, 2, 2.5])
        self.assertEqual(r["summary"]["completed"], 0)
        self.assertEqual(r["summary"]["pending"], 5)
        self.assertEqual(r["summary"]["availability"], 0)
        self.assert_counts(r)

    def test_failover_health_check_delay_then_recovery(self):
        p = project([node("lb", "load_balancer", health_check_delay=3), node("a"), node("b")],
                    [edge("lb", "a"), edge("lb", "b")], duration=14, rps=40,
                    events=[event("fail", "fail", "a", 2), event("up", "recover", "a", 8)])
        r = simulate(p)
        frames = r["frames"]
        self.assertGreater(frames[5]["failed"], frames[2]["failed"])
        self.assertEqual(frames[7]["failed"], frames[6]["failed"])
        self.assertEqual(frames[-1]["failed"], frames[6]["failed"])
        self.assertEqual(frames[3]["nodes"]["a"]["state"], "down")
        # Restored node does not receive traffic until recovery health delay.
        self.assertEqual(frames[10]["nodes"]["a"]["started"], frames[8]["nodes"]["a"]["started"])
        self.assertGreater(frames[13]["nodes"]["a"]["started"], frames[11]["nodes"]["a"]["started"])
        fast = deepcopy(p)
        fast["nodes"][0]["config"]["health_check_delay"] = 0
        self.assertLess(simulate(fast)["summary"]["failed"], r["summary"]["failed"])
        self.assert_counts(r)

    def test_restored_service_and_failed_work_not_replayed(self):
        p = project([node(latency_ms=500, concurrency=1, capacity_rps=100, queue_limit=10)], duration=12, rps=4,
                    events=[event("down", "fail", time=2), event("up", "recover", time=5)])
        r = simulate(p)
        self.assertEqual(r["frames"][4]["nodes"]["app"]["queue_depth"], 0)
        self.assertEqual(r["frames"][4]["nodes"]["app"]["inflight"], 0)
        self.assertEqual(r["frames"][4]["nodes"]["app"]["completed"], r["frames"][2]["nodes"]["app"]["completed"])
        self.assertGreater(r["frames"][8]["completed"], r["frames"][5]["completed"])
        self.assertGreater(r["summary"]["failed"], 10)
        self.assert_counts(r)

    def test_overload_is_bounded_by_concurrency_and_fifo_queue(self):
        p = project([node(capacity_rps=1000, latency_ms=500, concurrency=2, queue_limit=3)], rps=100)
        r = simulate(p)
        self.assertGreater(r["summary"]["failed"], 900)
        self.assertLessEqual(r["summary"]["completed"], 40)
        self.assertTrue(any(f["nodes"]["app"]["queue_depth"] == 3 for f in r["frames"]))
        for f in r["frames"]:
            self.assertLessEqual(f["nodes"]["app"]["queue_depth"], 3)
            self.assertLessEqual(f["nodes"]["app"]["inflight"], 2)
        self.assert_counts(r)

    def test_capacity_limit_independent_of_concurrency(self):
        r = simulate(project([node(capacity_rps=5, latency_ms=0, concurrency=1000)], duration=10, rps=50))
        self.assertLessEqual(r["summary"]["completed"], 50)
        self.assertGreaterEqual(r["summary"]["completed"], 49)
        self.assertGreater(r["summary"]["pending"], 400)

    def test_zero_queue_allows_immediate_service_but_drops_waiters(self):
        r = simulate(project([node(capacity_rps=10000, concurrency=1, latency_ms=100, queue_limit=0)], duration=3, rps=50))
        self.assertGreater(r["summary"]["completed"], 10)
        self.assertGreater(r["summary"]["failed"], 50)
        self.assertTrue(all(f["nodes"]["app"]["queue_depth"] == 0 for f in r["frames"]))

    def test_background_queue_drains_without_blocking_foreground(self):
        p = project([node("queue", "queue"), node("worker", "worker", latency_ms=200, concurrency=1, capacity_rps=5)],
                    [edge("queue", "worker")], duration=15, rps=10,
                    events=[event("stop", "traffic", "global", 4, value=0)])
        r = simulate(p)
        self.assertEqual(r["frames"][5]["inflight"], 0)
        self.assertGreater(r["frames"][5]["background_pending"], 0)
        self.assertGreater(r["frames"][4]["nodes"]["worker"]["queue_depth"], 0)
        s = r["summary"]
        self.assertEqual(s["requests"], s["completed"])
        self.assertEqual(s["background_jobs"], s["background_completed"])
        self.assertEqual(s["background_pending"], 0)
        self.assertEqual(r["frames"][-1]["nodes"]["worker"]["queue_depth"], 0)
        self.assertGreater(s["background_p95_ms"], s["p95_ms"])
        self.assert_counts(r)

    def test_async_failure_does_not_fail_foreground(self):
        p = project([node("app"), node("dependency", initial_state="down")],
                    [edge("app", "dependency", **{"async": True})])
        r = simulate(p)
        self.assertEqual(r["summary"]["failed"], 0)
        self.assertEqual(r["summary"]["background_failed"], r["summary"]["completed"])
        self.assertGreater(r["summary"]["background_failed"], 0)
        self.assert_counts(r)

    def test_downstream_failure_propagates_and_sync_fanout_waits(self):
        p = project([node("app", latency_ms=10), node("slow", latency_ms=200), node("bad", initial_state="down")],
                    [edge("app", "slow"), edge("app", "bad")], duration=5, rps=5)
        r = simulate(p)
        self.assertEqual(r["summary"]["completed"], 0)
        self.assertGreater(r["summary"]["failed"], 20)
        self.assertEqual(r["frames"][-1]["edges"]["app-slow"]["requests"], r["frames"][-1]["edges"]["app-bad"]["requests"])
        good = deepcopy(p)
        good["nodes"][2]["config"]["initial_state"] = "up"
        r2 = simulate(good)
        self.assertAlmostEqual(r2["summary"]["p95_ms"], 210)
        self.assert_counts(r)

    def test_cache_hit_and_miss_extremes(self):
        p = project([node("cache", "cache", cache_hit_rate=1), node("db", initial_state="down")], [edge("cache", "db")])
        hit = simulate(p)
        self.assertEqual(hit["summary"]["failed"], 0)
        self.assertEqual(hit["frames"][-1]["edges"]["cache-db"]["requests"], 0)
        self.assertEqual(hit["frames"][-1]["nodes"]["cache"]["cache_hits"], hit["summary"]["completed"])
        p["nodes"][0]["config"]["cache_hit_rate"] = 0
        miss = simulate(p)
        self.assertEqual(miss["summary"]["completed"], 0)
        self.assertGreater(miss["summary"]["failed"], 90)

    def test_condition_fires_once_and_scales_queue(self):
        conditional = dict(id="auto", type="scale", target="app", value=100,
                           trigger=dict(metric="queue_depth", target="app", operator="gte", value=2))
        p = project([node(capacity_rps=2, latency_ms=1, queue_limit=1000)], duration=8, rps=20, events=[conditional])
        r = simulate(p)
        self.assertEqual([e["id"] for e in r["events"]], ["auto"])
        self.assertEqual(r["events"][0]["time"], 1)
        self.assertEqual(r["frames"][-1]["nodes"]["app"]["queue_depth"], 0)
        self.assertGreater(r["summary"]["completed"], 150)
        p["scenario"]["events"][0]["window"] = [5, 6]
        delayed = simulate(p)
        self.assertEqual(delayed["events"][0]["time"], 5)

    def test_condition_cumulative_errors_and_utilization(self):
        for metric, value in [("errors", 1), ("utilization", 1)]:
            p = project([node(capacity_rps=1, queue_limit=2)], duration=5, rps=30,
                        events=[dict(id="condition", type="traffic", target="global", value=0,
                                     trigger=dict(metric=metric, target="app", operator="gte", value=value))])
            r = simulate(p)
            self.assertEqual(len(r["events"]), 1)
            self.assertEqual(r["events"][0]["time"], 1)

    def test_window_is_seeded_and_condition_can_expire(self):
        p = project(events=[dict(id="window", type="latency", target="app", value=100, window=[2, 4]),
                            dict(id="never", type="fail", target="app", window=[0, 2],
                                 trigger=dict(metric="errors", target="app", operator="gte", value=100))])
        r = simulate(p)
        self.assertEqual(len(r["events"]), 1)
        self.assertTrue(2 <= r["events"][0]["time"] <= 4)
        self.assertEqual(r, simulate(p))
        p["scenario"]["events"][0]["time"] = 3
        self.assertTrue(3 < simulate(p)["events"][0]["time"] < 4)

    def test_simultaneous_events_input_order_and_completion_precedence(self):
        p = project([node(latency_ms=0)], duration=5, rps=10,
                    events=[event("fail", "fail", time=2), event("recover", "recover", time=2)])
        r = simulate(p)
        self.assertEqual([e["id"] for e in r["events"]], ["fail", "recover"])
        self.assertEqual(r["summary"]["failed"], 0)
        p["scenario"]["events"].reverse()
        reversed_result = simulate(p)
        self.assertEqual(reversed_result["frames"][2]["nodes"]["app"]["state"], "down")
        self.assertGreater(reversed_result["summary"]["failed"], 20)
        # Force service completion to tie precisely with a scheduled failure.
        p = project([node(latency_ms=1000)], duration=4, rps=1)
        arrival_phase = simulate(p)["summary"]["p50_ms"]
        self.assertAlmostEqual(arrival_phase, 1000)
        import random
        exact = random.Random(42).random() + 1
        p["scenario"]["events"] = [event("failure-at-completion", "fail", time=exact)]
        tied = simulate(p)
        self.assertEqual(tied["summary"]["completed"], 0)
        self.assertEqual(tied["summary"]["failed"], tied["summary"]["requests"])

    def test_traffic_latency_and_replica_events(self):
        p = project([node(capacity_rps=2, latency_ms=10, hourly_cost=1)], duration=10, rps=10,
                    events=[event("replicas", "scale", time=2, value=5, field="replicas"),
                            event("slow", "latency", time=4, value=200),
                            event("traffic", "traffic", "global", 7, value=0)])
        r = simulate(p)
        self.assertEqual(r["frames"][3]["nodes"]["app"]["capacity_rps"], 10)
        self.assertEqual(r["frames"][-1]["requests"], r["frames"][8]["requests"])
        self.assertGreater(r["summary"]["p95_ms"], 200)
        self.assertAlmostEqual(r["costs"][0]["infrastructure_cost"], (2 + 8 * 5) / 3600)

    def test_edge_latency_rate_bandwidth_and_overflow(self):
        base = project([node("a", latency_ms=10), node("b", latency_ms=20)], [edge("a", "b", latency_ms=30)], duration=5, rps=2)
        self.assertAlmostEqual(simulate(base)["summary"]["p95_ms"], 60)
        base["edges"][0].update(bandwidth_mbps=8, payload_bytes=100_000)
        self.assertAlmostEqual(simulate(base)["summary"]["p95_ms"], 160)
        base["edges"][0].update(capacity_rps=1, queue_limit=2)
        base["scenario"]["rps"] = 20
        r = simulate(base)
        self.assertGreater(r["summary"]["failed"], 50)
        self.assertGreater(r["frames"][-1]["edges"]["a-b"]["failed"], 50)
        self.assertLessEqual(r["frames"][-1]["edges"]["a-b"]["delivered"], 5)
        self.assert_counts(r)

    def test_cost_formula_and_monthly_assumptions(self):
        p = project([node(hourly_cost=2, cost_per_request=.01, request_cost_per_million=1000,
                          input_tokens=100, output_tokens=20, input_cost_per_million=2,
                          output_cost_per_million=5, egress_bytes=1_000_000, egress_cost_per_gb=.2)], duration=10, rps=5)
        p["monthly"] = dict(hours=100, traffic_multiplier=3)
        r = simulate(p)
        c = r["costs"][0]
        self.assertEqual(c["billable_requests"], 50)
        self.assertAlmostEqual(c["request_cost"], 50 * .011)
        self.assertAlmostEqual(c["token_cost"], 50 * .0003)
        self.assertAlmostEqual(c["egress_cost"], 50 * .0002)
        fixed, usage = 2 * 10 / 3600, 50 * (.011 + .0003 + .0002)
        self.assertAlmostEqual(c["experiment_cost"], fixed + usage)
        self.assertAlmostEqual(c["monthly_cost"], 200 + usage * (100 * 3600 / 10) * 3)
        self.assertIn("manual estimate", c["provenance"])
        self.assertTrue(any("traffic_multiplier=3" in a for a in r["assumptions"]))
        doubled = deepcopy(p)
        doubled["nodes"][0]["config"]["hourly_cost"] *= 2
        doubled["nodes"][0]["config"]["cost_per_request"] *= 2
        doubled["nodes"][0]["config"]["request_cost_per_million"] *= 2
        doubled["nodes"][0]["config"]["input_cost_per_million"] *= 2
        doubled["nodes"][0]["config"]["output_cost_per_million"] *= 2
        doubled["nodes"][0]["config"]["egress_cost_per_gb"] *= 2
        d = simulate(doubled)
        self.assertAlmostEqual(d["summary"]["experiment_cost"], 2 * r["summary"]["experiment_cost"])
        self.assertAlmostEqual(d["summary"]["monthly_cost"], 2 * r["summary"]["monthly_cost"])

    def test_empty_traffic_costs_downtime_and_zero_month(self):
        p = project([node(hourly_cost=3, initial_state="down")], rps=0)
        p["monthly"] = dict(hours=0)
        r = simulate(p)
        self.assertEqual(r["summary"]["requests"], 0)
        self.assertEqual(r["summary"]["availability"], 1)
        self.assertAlmostEqual(r["summary"]["experiment_cost"], 3 * 10 / 3600)
        self.assertEqual(r["summary"]["monthly_cost"], 0)

    def test_one_hour_cost_oracle_and_costs_scale_with_traffic(self):
        idle = simulate(project([node(hourly_cost=2)], duration=3600, rps=0))
        self.assertEqual(idle["summary"]["experiment_cost"], 2)
        self.assertEqual(idle["summary"]["monthly_cost"], 1460)
        self.assertIsNone(idle["costs"][0]["rates"]["cost_per_request"])
        p = project([node(hourly_cost=0, cost_per_request=.02, latency_ms=0)], duration=10, rps=10)
        low = simulate(p)
        p["scenario"]["rps"] = 20
        high = simulate(p)
        self.assertEqual(high["summary"]["experiment_cost"], 2 * low["summary"]["experiment_cost"])
        self.assertEqual(high["summary"]["monthly_cost"], 2 * low["summary"]["monthly_cost"])
        p["nodes"][0]["config"]["cost_per_request"] = 0
        zero = simulate(p)
        self.assertEqual(zero["summary"]["experiment_cost"], 0)
        self.assertEqual(zero["costs"][0]["rates"]["cost_per_request"], 0)

    def test_edge_egress_costs_and_provenance(self):
        p = project([node("a", hourly_cost=0, pricing_provenance="manual override"), node("b", hourly_cost=0)],
                    [edge("a", "b", payload_bytes=1e6, egress_cost_per_gb=2)], rps=3)
        r = simulate(p)
        self.assertEqual(r["costs"][0]["provenance"], "manual override")
        self.assertAlmostEqual(r["costs"][-1]["experiment_cost"], 30 * .002)

    def test_catalog_coverage_and_presets_are_executable(self):
        c = catalog()["components"]
        self.assertGreaterEqual(len(c), 60)
        self.assertEqual(len({item["category"] for item in c}), 18)
        self.assertEqual(len({item["type"] for item in c}), len(c))
        for item in c:
            self.assertTrue(item["model"])
            self.assertTrue(item["limitations"])
            self.assertFalse(validate(project([node(kind=item["type"])])), item["type"])
        self.assertEqual(len(presets()), 4)
        for p in presets():
            r = simulate(p)
            self.assertGreater(r["summary"]["completed"], 0)
            self.assertTrue(r["assumptions"])
            self.assert_counts(r)
        c[0]["defaults"]["capacity_rps"] = 0
        self.assertNotEqual(catalog()["components"][0]["defaults"]["capacity_rps"], 0)

    def test_invalid_graphs_configs_and_events_raise_value_error(self):
        cases = [None, {}, project([node(), node()]), project([node(kind="invented")]),
                 project(edges=[edge("app", "missing")]), project(edges=[edge("app", "app")]),
                 project([node("a"), node("b")], [edge("a", "b"), edge("b", "a")]),
                 project([node(capacity_rps=0)]), project([node(queue_limit=-1)]),
                 project([node(concurrency=1.2)]), project([node(latency_ms=float("nan"))]),
                 project([node(cache_hit_rate=1.1)]), project([node(retries=2)]),
                 project([node(latency_ms=True)]), project(duration=0), project(duration=3601),
                 project(rps=-1), project(seed="42"), project(events=[event("x", "reboot")]),
                 project(events=[event("x", "fail", "missing")]),
                 project(events=[event("x", "fail", time=11)]),
                 project(events=[event("x", "scale", value=0)]),
                 project(events=[event("x", "scale", field=[], value=1)]),
                 project(events=[event("x", "traffic", "app", value=1)]),
                 project(events=[dict(id="x", type="fail", target="app", window=[4, 2])]),
                 project(events=[event("x", "fail"), event("x", "recover")]),
                 project(events=[dict(id="x", type="fail", target="app", trigger=dict(metric="cpu", target="app", operator="gte", value=1))]),
                 project(events=[dict(id="x", type="fail", target="app", trigger=dict(metric="errors", target="missing", operator="gte", value=1))]),
                 project(events=[dict(id="x", type="fail", target="app", trigger=dict(metric="errors", target="app", operator="lt", value=1))]),
                 project([node(hourly_cost=10**1000)]), project(edges=[dict(id="e", source=[], target="app")])]
        cases.extend([project(events=[event("bad-value", "fail", value={})]),
                      project([dict(node(), x=float("inf"))]), project([dict(node(), label=[])])])
        for p in cases:
            with self.subTest(project=p):
                self.assertTrue(validate(p))
                with self.assertRaises(ValueError):
                    simulate(p)

    def test_unknown_behavior_and_bad_collections_rejected(self):
        cases = []
        for key, value in [("scenario", []), ("monthly", []), ("edges", {}), ("nodes", [None])]:
            p = project()
            p[key] = value
            cases.append(p)
        for key, value in [("events", {}), ("arrival_distribution", "magic")]:
            p = project()
            p["scenario"][key] = value
            cases.append(p)
        p = project([node("a"), node("b")], [edge("a", "b", retries=3)])
        cases.append(p)
        p = project([node("a"), node("b")], [edge("a", "b", **{"async": "yes"})])
        cases.append(p)
        for p in cases:
            self.assertTrue(validate(p))

    def test_bounded_runs_reject_arrivals_and_exponential_fanout(self):
        self.assertTrue(any("budget" in e for e in validate(project(duration=3600, rps=10000))))
        self.assertTrue(any("budget" in e for e in validate(project(rps=0, events=[event("surge", "traffic", "global", value=20000)]))))
        # Only 25 nodes but 2^12 paths: reject before creating any workload.
        nodes = [node("root")]
        edges = []
        previous = ["root"]
        for level in range(12):
            current = [f"n{level}a", f"n{level}b"]
            nodes.extend(node(key) for key in current)
            edges.extend(edge(a, b) for a in previous for b in current)
            previous = current
        self.assertTrue(any("expansion" in e for e in validate(project(nodes, edges, duration=1, rps=1))))
        parallel = [dict(edge("a", "b"), id=f"e{i}") for i in range(100)]
        self.assertTrue(any("frame budget" in e for e in validate(project([node("a"), node("b")], parallel, duration=3600, rps=0))))
        r = simulate(project([node(capacity_rps=10000, latency_ms=0)], duration=10, rps=1000))
        self.assertEqual(r["summary"]["requests"], 10000)
        self.assertEqual(r["summary"]["completed"], 10000)
        self.assertLess(r["budget"]["node_visits"], MAX_VISITS)
        self.assertLess(r["budget"]["operations"], MAX_OPERATIONS)


if __name__ == "__main__":
    unittest.main()
