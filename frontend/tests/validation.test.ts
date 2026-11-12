import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  numericField,
  validationMessage,
  eventNumericField,
  initializeEventValue,
} from "../src/domain/validation";
import type { Event, NumericConstraints, Project } from "../src/domain/types";

const constraints: NumericConstraints = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      "import json;from tds.simulation import validation_constraints;print(json.dumps(validation_constraints()))",
    ],
    { encoding: "utf8" },
  ),
);
const project: Project = {
  id: "p",
  name: "Fixture",
  nodes: [
    { id: "n", label: "Read cache", type: "redis", x: 0, y: 0, config: {} },
  ],
  edges: [],
  scenario: { duration: 1, rps: 1, seed: 42, events: [] },
  monthly: { hours: 730, traffic_multiplier: 1 },
};
test("actual backend limits drive positive capacity, integer slots and fractional cache rate", () => {
  assert.equal(
    numericField(constraints, "node_config", "capacity_rps").min,
    0.001,
  );
  assert.equal(
    numericField(constraints, "node_config", "concurrency").isIntegerOnly,
    true,
  );
  assert.equal(
    numericField(constraints, "node_config", "cache_hit_rate").max,
    1,
  );
  assert.equal(numericField(constraints, "edge", "weight").min, 0.001);
  assert.equal(numericField(constraints, "scenario", "seed").min, 0);
  assert.equal(numericField(constraints, "monthly", "hours").max, 8784);
});
test("missing field metadata disables the editor instead of assuming a permissive limit", () => {
  assert.equal(
    numericField(null, "node_config", "capacity_rps").isDisabled,
    true,
  );
  assert.equal(
    numericField(constraints, "node_config", "unknown").isDisabled,
    true,
  );
  assert.equal(
    numericField(constraints, "node_config", "capacity_rps").isDisabled,
    false,
  );
});
test("validation points to the user's component and actual range rather than an array path", () => {
  const message = validationMessage(
    "nodes[0].config.capacity_rps is outside its supported numeric range",
    project,
    constraints,
  );
  assert.equal(
    message,
    "Read cache: Capacity rps must be between 0.001 and 1,000,000",
  );
  assert.doesNotMatch(message, /nodes\[/);
  assert.match(
    validationMessage(
      "scenario.rps must be between 0 and 20000",
      project,
      constraints,
    ),
    /Traffic \(requests\/second\)/,
  );
});

test("changing event actions commits visible defaults accepted by the actual engine", () => {
  const p = structuredClone(project);
  p.nodes[0].config = {
    capacity_rps: 123,
    latency_ms: 12,
    replicas: 3,
    concurrency: 8,
  };
  const cases: Project[] = [];
  for (const type of ["traffic", "latency", "scale"] as const) {
    const event: Event = {
      id: "e",
      type,
      target: type === "traffic" ? "global" : "n",
      time: 0.5,
    };
    initializeEventValue(event, p, constraints);
    assert.equal(
      event.value,
      type === "traffic" ? 1 : type === "latency" ? 12 : 123,
    );
    cases.push({ ...p, scenario: { ...p.scenario, events: [event] } });
  }
  for (const field of ["replicas", "concurrency"]) {
    const event: Event = {
      id: "e",
      type: "scale",
      target: "n",
      field,
      value: 0.2,
      time: 0.5,
    };
    initializeEventValue(event, p, constraints);
    assert.equal(event.value, 1);
    assert.equal(eventNumericField(constraints, event).isIntegerOnly, true);
    cases.push({ ...p, scenario: { ...p.scenario, events: [event] } });
    event.type = "fail";
    initializeEventValue(event, p, constraints);
    assert.equal(event.value, undefined);
    // Do not retain the mutable event reference in the engine fixture.
    cases[cases.length - 1].scenario.events = [
      { ...event, type: "scale", value: 1 },
    ];
  }
  const errors = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import json,sys;from tds.simulation import validate;print(json.dumps([validate(p) for p in json.load(sys.stdin)]))",
      ],
      { input: JSON.stringify(cases), encoding: "utf8" },
    ),
  );
  assert.deepEqual(
    errors,
    cases.map(() => []),
  );
});
