import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Workspace } from "../src/workspace/store";
import type { Project } from "../src/domain/types";
Object.assign(globalThis, { window: { dispatchEvent: () => true } });
const fixture = (): Project => ({
  id: "bulk",
  name: "Bulk draft",
  nodes: ["a", "b", "c"].map((id, i) => ({
    id,
    label: id,
    type: "api_service",
    x: i * 200,
    y: 0,
    config: { capacity_rps: 100 + i * 100, latency_ms: 10 },
  })),
  edges: [],
  scenario: { duration: 2, seed: 42, rps: 2, events: [] },
  monthly: { hours: 730, traffic_multiplier: 1 },
});
function setup() {
  const w = new Workspace();
  w.replace(fixture());
  w.set({ dirty: false });
  w.selectNodes(["a", "b"]);
  w.editBulkDraft(["a", "b"], "capacity_rps", 250);
  return w;
}
const response = (body: unknown) => new Response(JSON.stringify(body));
test("navigate, close and return retain frozen draft; other groups cannot replace it", () => {
  const w = setup(),
    draft = w.get().bulkDraft;
  w.set({ panel: "experiment" });
  w.set({ panel: null });
  w.selectNodes(["b", "c"]);
  assert.throws(
    () => w.editBulkDraft(["b", "c"], "capacity_rps", 400),
    /Recover or discard/,
  );
  assert.equal(w.get().bulkDraft, draft);
  w.recoverBulkDraft();
  assert.deepEqual(w.get().selected, { kind: "nodes", ids: ["a", "b"] });
  assert.equal(w.get().panel, "inspector");
  w.selectNodes(["b", "a"]);
  assert.equal(w.get().bulkDraft, draft);
  assert.ok(Object.isFrozen(draft));
  assert.equal(w.hasUnsavedWork(), true);
});
test("changed and deleted targets preserve typed values and stale fence until explicit discard", async () => {
  const w = setup(),
    draft = w.get().bulkDraft;
  w.removeSelected();
  assert.equal(w.get().bulkDraft, draft);
  await assert.rejects(w.applyBulkDraft(), /Workspace changed/);
  w.undo();
  await assert.rejects(w.applyBulkDraft(), /Workspace changed/);
  assert.equal(w.get().bulkDraft?.value, 250);
  w.cancelBulkDraft();
  assert.equal(w.get().bulkDraft, null);
  w.editBulkDraft(["b", "c"], "capacity_rps", 350);
  assert.equal(w.isCurrent(w.get().bulkDraft!.fence), true);
});
test("explicit cancel clears unsaved scratch; replacement clears retained scratch", () => {
  const w = setup();
  w.cancelBulkDraft();
  assert.equal(w.hasUnsavedWork(), false);
  w.editBulkDraft(["a", "b"], "capacity_rps", 300);
  w.replace(fixture());
  assert.equal(w.get().bulkDraft, null);
});
test("unchanged shared values do not create pending work and non-finite input is rejected", () => {
  const w = setup();
  w.cancelBulkDraft();
  w.editBulkDraft(["a", "b"], "latency_ms", 10);
  assert.equal(w.get().bulkDraft, null);
  assert.equal(w.hasUnsavedWork(), false);
  assert.throws(
    () => w.editBulkDraft(["a", "b"], "latency_ms", Infinity),
    /bounds or value types/,
  );
  assert.equal(w.get().bulkDraft, null);
});
test("pending bulk draft guards save, run and reviewed proposal without network or loss", async () => {
  const original = globalThis.fetch,
    w = setup(),
    draft = w.get().bulkDraft;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("Unexpected request");
  };
  try {
    w.set({ panel: null });
    const saved = await w.save();
    assert.equal(saved.saved, false);
    assert.match(saved.message, /pending group edit/);
    await w.run();
    assert.match(w.get().notice!.text, /pending group edit/);
    assert.throws(() => w.apply(fixture(), w.fence()), /pending group edit/);
    assert.equal(calls, 0);
    assert.equal(w.get().bulkDraft, draft);
    assert.equal(w.get().panel, "inspector");
    assert.equal(w.get().runBusy, false);
    assert.equal(w.get().saveBusy, false);
  } finally {
    globalThis.fetch = original;
  }
});
for (const change of ["cancel", "refine", "revision", "replace"] as const) {
  test(`${change} during delayed validation fences the old apply`, async () => {
    const original = globalThis.fetch,
      w = setup();
    let release!: (r: Response) => void;
    globalThis.fetch = async () =>
      new Promise((resolve) => {
        release = resolve;
      });
    try {
      const pending = w.applyBulkDraft();
      if (change === "cancel") w.cancelBulkDraft();
      if (change === "refine") w.editBulkDraft(["b", "a"], "capacity_rps", 375);
      if (change === "revision")
        w.edit((p) => {
          p.name = "Newer";
        });
      if (change === "replace") w.replace(fixture());
      release(response({ valid: true }));
      await assert.rejects(pending, /draft changed|Workspace changed/);
      assert.deepEqual(
        w.get().project.nodes.map((n) => n.config.capacity_rps),
        [100, 200, 300],
      );
      if (change === "refine") assert.equal(w.get().bulkDraft?.value, 375);
      if (change === "cancel") assert.equal(w.get().bulkDraft, null);
    } finally {
      globalThis.fetch = original;
    }
  });
}
test("actual backend validates owned draft; commit and clear publish atomically with one Undo", async () => {
  const original = globalThis.fetch,
    w = setup(),
    before = structuredClone(w.get().project);
  let validations = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/validate");
    validations++;
    const result = spawnSync(
      "python3",
      [
        "-c",
        "import json,sys;from tds.simulation import validate;errors=validate(json.load(sys.stdin));print(json.dumps({'valid':not errors,'errors':errors}))",
      ],
      { input: String(options?.body), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return new Response(result.stdout);
  };
  try {
    w.editBulkDraft(["a", "b"], "capacity_rps", -1);
    await assert.rejects(w.applyBulkDraft());
    assert.deepEqual(w.get().project, before);
    assert.equal(w.get().bulkDraft?.value, -1);
    w.editBulkDraft(["a", "b"], "capacity_rps", 250);
    const observed: boolean[] = [];
    const unsubscribe = w.subscribe(() => {
      if (w.get().project.nodes[0].config.capacity_rps === 250)
        observed.push(w.get().bulkDraft === null);
    });
    await w.applyBulkDraft();
    unsubscribe();
    assert.equal(validations, 2);
    assert.ok(observed.length > 0);
    assert.ok(observed.every(Boolean));
    assert.deepEqual(
      w.get().project.nodes.map((n) => n.config.capacity_rps),
      [250, 250, 300],
    );
    w.undo();
    assert.deepEqual(w.get().project, before);
    assert.equal(w.get().history.canUndo, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("new bulk scratch supersedes the previous success notice without hiding an error", () => {
  const w = setup();
  w.cancelBulkDraft();
  w.notify("Updated 2 components. Undo restores all previous values.");
  w.editBulkDraft(["a", "b"], "capacity_rps", 220);
  assert.equal(w.get().notice, null);
  assert.equal(w.get().bulkDraft?.value, 220);
  assert.deepEqual(
    w.get().project.nodes.map((n) => n.config.capacity_rps),
    [100, 200, 300],
  );
  w.notify("Validation failed", true);
  w.editBulkDraft(["a", "b"], "capacity_rps", 230);
  assert.equal(w.get().notice?.text, "Validation failed");
});
