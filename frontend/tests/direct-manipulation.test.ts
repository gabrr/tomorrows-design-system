import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Workspace } from "../src/workspace/store";
import { selectedNodeIds } from "../src/domain/graph";
import { createAgentTools } from "../src/automation/tools";
import { ArchitectureReviews } from "../src/automation/reviews";
import type { Project } from "../src/domain/types";
Object.assign(globalThis, { window: { dispatchEvent: () => true } });
const fixture = (): Project => ({
  id: "p",
  name: "Direct interaction fixture",
  nodes: [
    {
      id: "a",
      label: "A",
      type: "api_service",
      x: 10,
      y: 10,
      config: { capacity_rps: 100, latency_ms: 10, provider: "generic" },
    },
    {
      id: "b",
      label: "B",
      type: "api_service",
      x: 310,
      y: 10,
      config: { capacity_rps: 200, latency_ms: 20, provider: "generic" },
    },
    {
      id: "c",
      label: "C",
      type: "cache",
      x: 310,
      y: 210,
      config: {
        capacity_rps: 400,
        latency_ms: 2,
        provider: "generic",
        cache_hit_rate: 0.8,
      },
    },
  ],
  edges: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
  ],
  scenario: {
    duration: 2,
    rps: 2,
    seed: 42,
    events: [
      { id: "fail", type: "fail", target: "a", time: 1 },
      {
        id: "condition",
        type: "fail",
        target: "c",
        trigger: {
          metric: "queue_depth",
          target: "b",
          operator: "gte",
          value: 3,
        },
      },
    ],
  },
  monthly: { hours: 730, traffic_multiplier: 1 },
});
const setup = () => {
  const w = new Workspace();
  w.replace(fixture());
  w.set({ ready: true });
  return w;
};
async function backend(run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const result = spawnSync(
      "python3",
      [
        "-c",
        "import json,sys;from tds.simulation import validate;print(json.dumps(validate(json.load(sys.stdin))))",
      ],
      { input: String(options?.body), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const errors = JSON.parse(result.stdout);
    return new Response(JSON.stringify({ valid: !errors.length, errors }));
  };
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}
test("Shift-style selection toggles unique nodes, supports select-all and never creates history", () => {
  const w = setup();
  w.selectNode("a");
  w.selectNode("b", true);
  assert.deepEqual(selectedNodeIds(w.get().selected), ["a", "b"]);
  w.selectNode("a", true);
  assert.deepEqual(w.get().selected, { kind: "node", id: "b" });
  w.selectNodes(["a", "a", "b", "missing", "c"]);
  assert.deepEqual(selectedNodeIds(w.get().selected), ["a", "b", "c"]);
  assert.equal(w.get().history.canUndo, false);
  w.selectNodes([]);
  assert.equal(w.get().selected, null);
});
test("group movement preserves spacing and untouched nodes and commits one reversible edit", () => {
  const w = setup(),
    before = structuredClone(w.get().project),
    f = w.fence();
  w.selectNodes(["a", "b"]);
  w.moveNodes({ a: { x: 50, y: 60 }, b: { x: 350, y: 60 } }, f);
  assert.equal(w.get().project.nodes[1].x - w.get().project.nodes[0].x, 300);
  assert.deepEqual(w.get().project.nodes[2], before.nodes[2]);
  w.undo();
  assert.deepEqual(w.get().project, before);
  assert.equal(w.get().history.canUndo, false);
  assert.throws(
    () => w.moveNodes({ a: { x: 100, y: 100 } }, f),
    /Workspace changed/,
  );
});
test("invalid or interrupted group move never changes committed positions", () => {
  const w = setup(),
    before = structuredClone(w.get().project);
  assert.throws(
    () => w.moveNodes({ a: { x: Infinity, y: 0 } }, w.fence()),
    /finite/,
  );
  assert.throws(
    () => w.moveNodes({ missing: { x: 0, y: 0 } }, w.fence()),
    /no longer exists/,
  );
  w.setGesture(true);
  assert.throws(
    () => w.moveNodes({ a: { x: 30, y: 40 } }, w.fence()),
    /active gesture/,
  );
  w.setGesture(false);
  assert.deepEqual(w.get().project, before);
});
test("connection command rejects duplicate/self/cycle and stale endpoints without history", () => {
  const w = setup();
  for (const [a, b, match] of [
    ["a", "a", /different/],
    ["a", "b", /already exists/],
    ["c", "a", /cycle/],
    ["a", "missing", /no longer exists/],
  ] as const)
    assert.throws(() => w.connect(a, b, w.fence()), match);
  assert.equal(w.get().history.canUndo, false);
  const before = structuredClone(w.get().project),
    id = w.connect("a", "c", w.fence());
  assert.equal(w.get().project.edges.at(-1)?.id, id);
  w.undo();
  assert.deepEqual(w.get().project, before);
  assert.equal(w.get().history.canUndo, false);
});
test("duplicate selected subgraph copies only internal connections and leaves original events", () => {
  const w = setup(),
    before = structuredClone(w.get().project);
  w.selectNodes(["a", "b"]);
  w.duplicateSelected();
  const ids = selectedNodeIds(w.get().selected);
  assert.equal(ids.length, 2);
  assert.equal(w.get().project.nodes.length, 5);
  assert.equal(w.get().project.edges.length, 3);
  const edge = w.get().project.edges.at(-1)!;
  assert.equal(edge.source, ids[0]);
  assert.equal(edge.target, ids[1]);
  assert.deepEqual(w.get().project.scenario.events, before.scenario.events);
  w.undo();
  assert.deepEqual(w.get().project, before);
});
test("delete group removes attached connections and direct/condition events and undoes once", () => {
  const w = setup(),
    before = structuredClone(w.get().project);
  w.selectNodes(["a", "b"]);
  w.removeSelected();
  assert.deepEqual(
    w.get().project.nodes.map((n) => n.id),
    ["c"],
  );
  assert.equal(w.get().project.edges.length, 0);
  assert.equal(w.get().project.scenario.events.length, 0);
  w.undo();
  assert.deepEqual(w.get().project, before);
  assert.equal(w.get().history.canUndo, false);
});
test("mixed shared-property edit validates against real engine, changes only chosen nodes and undoes once", async () =>
  backend(async () => {
    const w = setup(),
      before = structuredClone(w.get().project);
    w.selectNodes(["a", "b"]);
    await w.patchNodes(["a", "b"], { capacity_rps: 250 }, w.fence());
    assert.deepEqual(
      w.get().project.nodes.map((n) => n.config.capacity_rps),
      [250, 250, 400],
    );
    assert.deepEqual(
      w.get().project.nodes.map((n) => n.config.latency_ms),
      [10, 20, 2],
    );
    assert.equal(selectedNodeIds(w.get().selected).length, 2);
    w.undo();
    assert.deepEqual(w.get().project, before);
    assert.equal(w.get().history.canUndo, false);
  }));
test("invalid batch property, range, type and stale async validation never partially apply", async () =>
  backend(async () => {
    const w = setup(),
      before = structuredClone(w.get().project);
    await assert.rejects(
      w.patchNodes(["a", "c"], { cache_hit_rate: 0.2 }, w.fence()),
      /every selected/,
    );
    await assert.rejects(
      w.patchNodes(["a", "b"], { capacity_rps: -1 }, w.fence()),
    );
    await assert.rejects(
      w.patchNodes(["a", "b"], { capacity_rps: "250" }, w.fence()),
      /existing value type/,
    );
    assert.deepEqual(w.get().project, before);
    const original = globalThis.fetch;
    let release!: (v: Response) => void;
    globalThis.fetch = async () => new Promise((r) => (release = r));
    try {
      const pending = w.patchNodes(
        ["a", "b"],
        { capacity_rps: 250 },
        w.fence(),
      );
      w.edit((p) => {
        p.name = "Newer edit";
      });
      release(new Response(JSON.stringify({ valid: true })));
      await assert.rejects(pending, /Workspace changed/);
      assert.deepEqual(w.get().project.nodes, before.nodes);
    } finally {
      globalThis.fetch = original;
    }
  }));
test("WebMCP additive selection and duplicate share the same group command as UI", async () => {
  const w = setup(),
    tools = createAgentTools(w, new ArchitectureReviews(w));
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === "tds_" + name)!;
    const result = await tool.execute({ ...args, expected: w.fence() });
    return JSON.parse(result.content[0].text);
  };
  assert.equal(
    (await call("select_element", { kind: "node", id: "a" })).ok,
    true,
  );
  assert.equal(
    (await call("select_element", { kind: "node", id: "b", additive: true }))
      .ok,
    true,
  );
  assert.equal(selectedNodeIds(w.get().selected).length, 2);
  assert.equal(
    (await call("duplicate_selected", { expectedSelection: w.get().selected }))
      .ok,
    true,
  );
  assert.equal(w.get().project.nodes.length, 5);
  assert.equal(w.get().project.edges.length, 3);
});

test("agent delete and duplicate reject a human selection change without a project edit", async () => {
  const w = setup(),
    tools = createAgentTools(w, new ArchitectureReviews(w));
  w.selectNode("a");
  const expectedSelection = structuredClone(w.get().selected),
    fence = w.fence();
  w.selectNode("b");
  assert.deepEqual(w.fence(), fence);
  for (const name of ["remove_selected", "duplicate_selected"]) {
    const before = structuredClone(w.get().project);
    const result = await tools
      .find((t) => t.name === "tds_" + name)!
      .execute({
        expected: fence,
        expectedSelection,
        ...(name === "remove_selected" ? { confirm: true } : {}),
      });
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.ok, false);
    assert.match(body.error, /Selection changed/);
    assert.deepEqual(body.selection, { kind: "node", id: "b" });
    assert.deepEqual(w.get().project, before);
  }
});

test("published snapshots cannot bypass edit history or run freshness through mutation", () => {
  const w = setup(),
    snapshot = w.get();
  assert.throws(() => {
    snapshot.project.nodes[0].config.capacity_rps = 999;
  }, TypeError);
  assert.throws(() => {
    snapshot.project.nodes.push(snapshot.project.nodes[0]);
  }, TypeError);
  assert.equal(w.get().project.nodes[0].config.capacity_rps, 100);
  assert.equal(w.get().project.nodes.length, 3);
  w.edit((p) => {
    p.nodes[0].config.capacity_rps = 150;
  });
  assert.equal(w.get().project.nodes[0].config.capacity_rps, 150);
  assert.equal(snapshot.project.nodes[0].config.capacity_rps, 100);
  w.undo();
  assert.equal(w.get().project.nodes[0].config.capacity_rps, 100);
});

test("native Save identifies the submitted project when the workspace is replaced during persistence", async () => {
  const w = setup(),
    tools = createAgentTools(w, new ArchitectureReviews(w)),
    original = globalThis.fetch;
  let release!: (r: Response) => void;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  try {
    const submitted = w.fence();
    const saving = tools
      .find((t) => t.name === "tds_save_project")!
      .execute({ expected: submitted });
    w.replace({ ...fixture(), id: "replacement" });
    release(new Response(JSON.stringify({ ok: true })));
    const body = JSON.parse((await saving).content[0].text);
    assert.equal(body.ok, true);
    assert.equal(body.result.saved, true);
    assert.equal(body.result.projectId, "p");
    assert.deepEqual(body.result.submitted, submitted);
    assert.equal(body.result.current, false);
    assert.equal(w.get().project.id, "replacement");
    assert.equal(w.get().dirty, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("adding several components keeps the library available and remains separately undoable", () => {
  const w = setup();
  w.set({
    panel: "library",
    catalog: [
      {
        type: "cache",
        label: "Cache",
        category: "Data",
        description: "Cache",
        defaults: {},
        model: "generic",
        limitations: [],
      },
    ],
  });
  for (let i = 0; i < 3; i++) {
    w.add("cache", 10 + i * 200, 500);
    assert.equal(w.get().panel, "library");
  }
  assert.equal(w.get().project.nodes.length, 6);
  w.undo();
  assert.equal(w.get().project.nodes.length, 5);
});

test("reviewed changes preserve an unresolved event draft instead of stranding it", async () =>
  backend(async () => {
    const w = setup(),
      reviews = new ArchitectureReviews(w),
      proposal = structuredClone(w.get().project);
    w.beginScenarioDraft();
    w.editScenarioDraft((events) => events.slice(0, 1));
    proposal.name = "Proposed name";
    const review = await reviews.prepare(proposal, w.fence());
    const before = structuredClone(w.get());
    assert.throws(
      () => reviews.apply(review.id, review.fence),
      /Save or cancel the scenario draft/,
    );
    assert.deepEqual(w.get().project, before.project);
    assert.deepEqual(w.get().scenarioDraft, before.scenarioDraft);
    assert.deepEqual(w.get().history, before.history);
    assert.equal(reviews.get()?.id, review.id);
    w.cancelScenarioDraft();
    reviews.apply(review.id, review.fence);
    assert.equal(w.get().project.name, "Proposed name");
  }));

test("scenario scratch draft survives panel/dialog navigation and saves atomically with one undo", async () =>
  backend(async () => {
    const w = setup(),
      before = structuredClone(w.get().project);
    w.beginScenarioDraft();
    w.editScenarioDraft((events) => [
      ...events,
      { id: "extra", type: "recover", target: "a", time: 1.5 },
    ]);
    w.set({ panel: null, modal: "events" });
    w.set({ panel: "experiment", modal: null });
    assert.equal(w.get().scenarioDraft?.events.length, 3);
    assert.deepEqual(w.get().project, before);
    assert.equal(w.get().history.canUndo, false);
    await w.saveScenarioDraft();
    assert.equal(w.get().project.scenario.events.length, 3);
    assert.equal(w.get().scenarioDraft, null);
    w.undo();
    assert.deepEqual(w.get().project, before);
    assert.equal(w.get().history.canUndo, false);
  }));

test("stale event drafts remain inspectable, cancel is explicit, and project replacement clears scratch", async () => {
  const w = setup();
  w.beginScenarioDraft();
  w.editScenarioDraft((events) => events.slice(0, 1));
  w.edit((p) => {
    p.name = "Changed";
  });
  await assert.rejects(w.saveScenarioDraft(), /Workspace changed/);
  assert.equal(w.get().scenarioDraft?.events.length, 1);
  w.cancelScenarioDraft();
  assert.equal(w.get().scenarioDraft, null);
  w.beginScenarioDraft();
  w.replace(fixture());
  assert.equal(w.get().scenarioDraft, null);
});

test("changed or cancelled draft during validation cannot apply the old event list", async () => {
  const w = setup(),
    original = globalThis.fetch,
    before = structuredClone(w.get().project);
  let release!: (r: Response) => void;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  try {
    w.beginScenarioDraft();
    const saving = w.saveScenarioDraft();
    w.cancelScenarioDraft();
    release(new Response(JSON.stringify({ valid: true })));
    await assert.rejects(saving, /draft changed/);
    assert.deepEqual(w.get().project, before);
    assert.equal(w.get().history.canUndo, false);
  } finally {
    globalThis.fetch = original;
  }
});
