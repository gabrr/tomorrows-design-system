import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt } from "../ai/intent";
import { guard, validateProposal } from "./review-logic";
import { checkQuote } from "./quote-logic";
import { checkCalibration } from "./calibration-logic";
import { workspace } from "../../workspace/store";
import {
  clone,
  priceReason,
  validateMeasurements,
} from "../../domain/evidence.js";
const project = () => ({
  id: "p",
  name: "Test",
  nodes: [
    {
      id: "n",
      label: "Service",
      type: "service",
      x: 0,
      y: 0,
      config: { latency_ms: 20, hourly_cost: 1 },
    },
  ],
  edges: [],
  scenario: { duration: 60, seed: 42, rps: 100, events: [] },
  monthly: { hours: 730, traffic_multiplier: 1 },
});
// No backend, AI, provider, microphone or browser requests are made by these tests.
Object.assign(globalThis, { window: { dispatchEvent: () => true } });
test("bounded prompt keeps full latest intent and limits conversation", () => {
  const history = Array.from({ length: 12 }, () => ({
    role: "assistant",
    text: "x".repeat(3000),
  }));
  for (const length of [1, 8000, 9900, 9999]) {
    const intent = "a".repeat(length),
      prompt = buildPrompt(intent, history);
    assert.ok(prompt.length < 10000);
    assert.ok(prompt.endsWith(intent));
  }
  assert.throws(() => buildPrompt("a".repeat(10000), history));
  assert.throws(() => buildPrompt(" ", []));
});
test("workspace edits followed by undo never revive a review", () => {
  workspace.replace(project());
  const fence = workspace.fence();
  workspace.edit((p) => {
    p.name = "Changed";
  });
  workspace.undo();
  assert.equal(workspace.get().project.name, "Test");
  assert.throws(() => guard(fence, () => true), /Workspace changed/);
});
test("proposal guards before validation prevent requests; guards after await reject edits and supersession", async () => {
  workspace.replace(project());
  let calls = 0;
  const original = globalThis.fetch;
  let release;
  globalThis.fetch = async () => {
    calls++;
    return await new Promise((resolve) => {
      release = resolve;
    });
  };
  try {
    const fence = workspace.fence();
    await assert.rejects(
      validateProposal(project(), fence, () => false),
      /superseded/,
    );
    assert.equal(calls, 0);
    let current = true;
    const superseded = validateProposal(project(), fence, () => current);
    current = false;
    release(new Response(JSON.stringify({ valid: true })));
    await assert.rejects(superseded, /superseded/);
    const edited = validateProposal(project(), fence, () => true);
    workspace.edit((p) => {
      p.monthly.hours = 100;
    });
    release(new Response(JSON.stringify({ valid: true })));
    await assert.rejects(edited, /Workspace changed/);
    const replacementFence = workspace.fence(),
      replaced = validateProposal(
        clone(workspace.get().project),
        replacementFence,
        () => true,
      );
    workspace.replace(project());
    release(new Response(JSON.stringify({ valid: true })));
    await assert.rejects(replaced, /Workspace changed/);
  } finally {
    globalThis.fetch = original;
  }
});
test("invalid validation response and changed proposal identity are rejected", async () => {
  workspace.replace(project());
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ valid: false, errors: ["unsupported graph"] }),
    );
  try {
    await assert.rejects(
      validateProposal(project(), workspace.fence(), () => true),
      /unsupported graph/,
    );
    await assert.rejects(
      validateProposal(
        { ...project(), id: "other" },
        workspace.fence(),
        () => true,
      ),
      /identity/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("pricing allows real backend rate metadata but rejects other changes and changed records", () => {
  const before = project(),
    record = {
      id: "r",
      provider: "aws",
      currency: "USD",
      unit: "hour",
      hourly_cost: 2,
      sku: "sku",
      region: "region",
    };
  const proposal = clone(before);
  Object.assign(proposal.nodes[0].config, {
    hourly_cost: 2,
    provider: "aws",
    model: "",
    pricing_provenance: { ...record },
    region: "region",
    instance_class: "sku",
  });
  assert.doesNotThrow(() => checkQuote(before, proposal, record, record, "n"));
  assert.throws(
    () =>
      checkQuote(before, proposal, record, { ...record, hourly_cost: 3 }, "n"),
    /changed/,
  );
  const altered = clone(proposal);
  altered.nodes[0].config.latency_ms = 1;
  assert.throws(
    () => checkQuote(before, altered, record, record, "n"),
    /outside/,
  );
  assert.ok(priceReason({ ...record, currency: "EUR" }));
  assert.ok(priceReason({ ...record, unit: "GB-month" }));
});
test("measurement and heldout evidence validation preserves source and partition", () => {
  const measurement = {
    node_id: "n",
    source: "Recorded benchmark",
    samples_ms: Array(10).fill(20),
  };
  assert.doesNotThrow(() => validateMeasurements([measurement], project()));
  assert.throws(() =>
    validateMeasurements([{ ...measurement, samples_ms: [20] }], project()),
  );
  const report = {
    node_id: "n",
    source: measurement.source,
    sample_count: 10,
    training_count: 5,
    holdout_count: 5,
    service_mean_ms: 20,
    holdout_mean_absolute_error_ms: 0,
  };
  assert.doesNotThrow(() => checkCalibration([report], [measurement]));
  assert.throws(
    () => checkCalibration([{ ...report, holdout_count: 0 }], [measurement]),
    /partition/,
  );
  assert.throws(
    () => checkCalibration([{ ...report, source: "other" }], [measurement]),
    /source/,
  );
  assert.throws(
    () =>
      checkCalibration(
        [{ ...report, service_mean_ms: Infinity }],
        [measurement],
      ),
    /invalid/,
  );
});

test("dictation appends typed intent, never submits, and detaches handlers on stop", async () => {
  const { createDictation } = await import("../ai/dictation");
  let instance,
    typed = "Typed intent",
    listening = false,
    status = "",
    aborted = 0;
  class Speech {
    constructor() {
      instance = this;
    }
    start() {}
    abort() {
      aborted++;
    }
  }
  const controller = createDictation({
    getSpeech: () => Speech,
    language: () => "en-US",
    append: (text) => {
      typed += " " + text;
    },
    onListening: (value) => {
      listening = value;
    },
    onStatus: (value) => {
      status = value;
    },
  });
  controller.toggle();
  assert.equal(listening, true);
  assert.equal(instance.interimResults, false);
  const savedCallback = instance.onresult;
  savedCallback({
    resultIndex: 0,
    results: [
      { isFinal: false, 0: { transcript: "interim" } },
      { isFinal: true, 0: { transcript: "spoken intent" } },
    ],
  });
  assert.equal(typed, "Typed intent spoken intent");
  controller.stop();
  assert.equal(listening, false);
  assert.equal(aborted, 1);
  assert.equal(instance.onresult, null);
  assert.equal(instance.onerror, null);
  assert.equal(instance.onend, null);
  savedCallback({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "late transcript" } }],
  });
  assert.equal(typed, "Typed intent spoken intent");
  controller.toggle();
  instance.onerror({ error: "not-allowed" });
  assert.match(status, /permission denied/);
  assert.equal(listening, false);
  controller.toggle();
  instance.onerror({ error: "network" });
  assert.match(status, /could not connect/);
  const unavailable = createDictation({
    getSpeech: () => undefined,
    language: () => "en-US",
    append: () => assert.fail("unexpected append"),
    onListening: () => {},
    onStatus: (value) => {
      status = value;
    },
  });
  unavailable.toggle();
  assert.match(status, /unavailable/);
});
