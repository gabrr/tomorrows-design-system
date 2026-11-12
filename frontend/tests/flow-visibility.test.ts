import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { sampledTraffic, connectionRatePosition } from "../src/domain/graph";
import type { Frame, Project, Run } from "../src/domain/types";
import { Workspace } from "../src/workspace/store";

Object.assign(globalThis, { window: { dispatchEvent: () => true } });
const project: Project = {
  id: "flow-visibility",
  name: "Failure routing",
  nodes: [
    {
      id: "lb",
      type: "load_balancer",
      label: "Balancer",
      x: 80,
      y: 160,
      config: { capacity_rps: 100, latency_ms: 1, health_check_delay: 5 },
    },
    {
      id: "a",
      type: "api_service",
      label: "App A",
      x: 340,
      y: 80,
      config: { capacity_rps: 100, latency_ms: 30 },
    },
    {
      id: "b",
      type: "api_service",
      label: "App B",
      x: 340,
      y: 240,
      config: { capacity_rps: 100, latency_ms: 30 },
    },
  ],
  edges: [
    { id: "la", source: "lb", target: "a" },
    { id: "lb", source: "lb", target: "b" },
  ],
  scenario: {
    duration: 60,
    seed: 42,
    rps: 20,
    events: [
      { id: "fail-a", type: "fail", target: "a", time: 15 },
      { id: "recover-a", type: "recover", target: "a", time: 40 },
    ],
  },
  monthly: { hours: 730, traffic_multiplier: 1 },
};
const result = spawnSync(
  "python3",
  [
    "-c",
    "import json,sys; from tds.simulation import simulate; print(json.dumps(simulate(json.load(sys.stdin))))",
  ],
  { input: JSON.stringify(project), encoding: "utf8" },
);
assert.equal(result.status, 0, result.stderr);
const run = { ...JSON.parse(result.stdout), project_snapshot: project } as Run;

test("actual failure frames distinguish arrivals from utilization and successful completions", () => {
  for (const second of [10, 17, 25, 45, 49]) {
    const index = run.frames.findIndex((f) => f.time === second);
    const sample = sampledTraffic(run.frames, index, true);
    assert.equal(sample.interval?.seconds, 1);
    for (const edge of project.edges)
      assert.equal(
        sample.edgeRates[edge.id],
        run.frames[index].edges[edge.id].rps,
      );
    assert.equal(sample.nodeRates.a, sample.edgeRates.la);
    assert.equal(sample.nodeRates.b, sample.edgeRates.lb);
    assert.equal(sample.nodeRates.lb, 20);
  }
  const down = sampledTraffic(
    run.frames,
    run.frames.findIndex((f) => f.time === 17),
    true,
  );
  assert.equal(down.frame?.nodes.a.state, "down");
  assert.equal(down.frame?.nodes.a.utilization, 0);
  assert.ok(
    down.nodeRates.a! > 0,
    "Rejected arrivals still reach the failed server",
  );
  const rerouted = sampledTraffic(
    run.frames,
    run.frames.findIndex((f) => f.time === 25),
    true,
  );
  assert.equal(rerouted.nodeRates.a, 0);
  assert.equal(rerouted.nodeRates.b, 20);
  const recovered = sampledTraffic(
    run.frames,
    run.frames.findIndex((f) => f.time === 45),
    true,
  );
  assert.equal(recovered.frame?.nodes.a.state, "up");
  assert.equal(
    recovered.nodeRates.a,
    0,
    "Up with no arrivals is an observed fact, not a made-up health phase",
  );
});

const frame = (time: number, received: number, requests = received): Frame => ({
  time,
  requests,
  completed: 0,
  failed: 0,
  inflight: 0,
  nodes: { n: { state: "up", utilization: 0, queue_depth: 0, received } },
  edges: { e: { requests, rps: 999 } },
});
test("rates use the actual partial sample duration, not a fixed one-second assumption", () => {
  const sample = sampledTraffic([frame(2, 40), frame(2.5, 45)], 1, true);
  assert.deepEqual(sample.interval, { from: 2, to: 2.5, seconds: 0.5 });
  assert.equal(sample.nodeRates.n, 10);
  assert.equal(
    sample.edgeRates.e,
    10,
    "Derived from counters rather than trusting an inconsistent rps fixture",
  );
  const actual = spawnSync(
    "python3",
    [
      "-c",
      "import json,sys; from tds.simulation import simulate; print(json.dumps(simulate(json.load(sys.stdin))))",
    ],
    {
      input: JSON.stringify({
        ...project,
        scenario: { ...project.scenario, duration: 2.5, events: [] },
      }),
      encoding: "utf8",
    },
  );
  assert.equal(actual.status, 0, actual.stderr);
  const frames = JSON.parse(actual.stdout).frames as Frame[];
  const last = sampledTraffic(frames, frames.length - 1, true);
  assert.equal(last.interval?.seconds, 0.5);
  assert.equal(last.edgeRates.la, frames.at(-1)!.edges.la.rps);
});

test("missing samples, counters, counter resets and invalid intervals remain unavailable", () => {
  assert.equal(sampledTraffic([frame(0, 0)], 0, true).nodeRates.n, null);
  for (const times of [
    [1, 1],
    [2, 1],
    [0, NaN],
    [Infinity, 2],
    [-1, 0],
  ]) {
    const sample = sampledTraffic(
      [frame(times[0], 0), frame(times[1], 2)],
      1,
      true,
    );
    assert.equal(sample.interval, null);
    assert.equal(sample.nodeRates.n, null);
    assert.equal(sample.edgeRates.e, null);
  }
  for (const bad of [undefined, NaN, Infinity, -1, "2"]) {
    const first = frame(0, 0),
      second = frame(1, 2);
    second.nodes.n.received = bad as number;
    second.edges.e.requests = bad as number;
    assert.equal(sampledTraffic([first, second], 1, true).nodeRates.n, null);
    assert.equal(sampledTraffic([first, second], 1, true).edgeRates.e, null);
  }
  assert.equal(
    sampledTraffic([frame(0, 5), frame(1, 3)], 1, true).nodeRates.n,
    null,
  );
  const absent = frame(0, 0);
  absent.nodes = {};
  absent.edges = {};
  assert.equal(
    sampledTraffic([absent, frame(1, 5)], 1, true).nodeRates.n,
    null,
  );
  assert.equal(
    sampledTraffic([absent, frame(1, 5)], 1, true).edgeRates.e,
    null,
  );
  assert.equal(
    sampledTraffic([frame(0, 0), frame(1, 0)], 1, true).nodeRates.n,
    0,
  );
});

test("an actual workspace edit fences retained rates without discarding retained results", () => {
  const w = new Workspace();
  w.replace(project);
  w.set({ run, runRevision: w.get().revision, frame: 17 });
  let s = w.get();
  assert.equal(
    sampledTraffic(s.run!.frames, s.frame, s.runRevision === s.revision)
      .nodeRates.lb,
    20,
  );
  w.edit((p) => {
    p.nodes[1].config.capacity_rps = 101;
  });
  s = w.get();
  assert.equal(s.run, run);
  const stale = sampledTraffic(
    s.run!.frames,
    s.frame,
    s.runRevision === s.revision,
  );
  assert.equal(stale.frame, undefined);
  assert.equal(stale.interval, null);
  assert.deepEqual(stale.nodeRates, {});
  assert.deepEqual(stale.edgeRates, {});
});

test("normal three-node rates fit between cards without moving nodes or covering prior labels", () => {
  const first = connectionRatePosition(
    { x: 280, y: 212 },
    { x: 340, y: 132 },
    40,
    project.nodes,
  );
  assert.ok(first, "12/s fits in the actual 60px forward gap");
  const second = connectionRatePosition(
    { x: 280, y: 212 },
    { x: 340, y: 292 },
    40,
    project.nodes,
    [first.rect],
  );
  assert.ok(second);
  for (const label of [first, second])
    for (const node of project.nodes)
      assert.ok(
        label.rect.x >= node.x + 208 ||
          label.rect.x + label.rect.width <= node.x - 8 ||
          label.rect.y >= node.y + 118 ||
          label.rect.y + label.rect.height <= node.y - 8,
      );
  assert.equal(
    connectionRatePosition({ x: 280, y: 212 }, { x: 340, y: 132 }, 500, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 110 },
      { x: 200, y: 110 },
      { x: 0, y: 220 },
      { x: 200, y: 220 },
    ]),
    null,
  );
});
