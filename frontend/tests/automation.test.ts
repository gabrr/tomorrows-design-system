import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Workspace } from "../src/workspace/store";
import { ArchitectureReviews } from "../src/automation/reviews";
import { createAgentTools, type AgentTool } from "../src/automation/tools";
import { registerAgentTools } from "../src/automation/register";
import { agentStatus } from "../src/automation/status";
import type { Project } from "../src/domain/types";
Object.assign(globalThis, { window: { dispatchEvent: () => true } });
const project = (): Project => ({
  id: "qa",
  name: "Synthetic QA",
  nodes: [
    {
      id: "a",
      label: "A",
      type: "api_service",
      x: 100,
      y: 100,
      config: { capacity_rps: 100, latency_ms: 10, hourly_cost: 0.1 },
    },
    {
      id: "b",
      label: "B",
      type: "api_service",
      x: 400,
      y: 100,
      config: { capacity_rps: 100, latency_ms: 10, hourly_cost: 0.1 },
    },
  ],
  edges: [],
  scenario: { duration: 2, rps: 2, seed: 42, events: [] },
  monthly: { hours: 730, traffic_multiplier: 1 },
});
function setup() {
  const w = new Workspace();
  w.replace(project());
  w.set({
    ready: true,
    catalog: [
      {
        type: "cache",
        label: "Cache",
        category: "cache",
        description: "Synthetic fixture",
        defaults: { capacity_rps: 100, latency_ms: 2, hourly_cost: 0.1 },
        model: "generic",
        limitations: ["Illustrative"],
      },
    ],
  });
  const review = new ArchitectureReviews(w);
  return { w, review, tools: createAgentTools(w, review) };
}
const read = (response: Awaited<ReturnType<AgentTool["execute"]>>) =>
  JSON.parse(response.content[0].text);
async function call(
  tools: AgentTool[],
  name: string,
  args: Record<string, unknown> = {},
) {
  const tool = tools.find((t) => t.name === "tds_" + name);
  assert.ok(tool);
  return read(await tool.execute(args));
}
function python(operation: "validate" | "simulate", p: unknown) {
  const r = spawnSync(
    "python3",
    [
      "-c",
      `import json,sys;from tds.simulation import ${operation};v=${operation}(json.load(sys.stdin));print(json.dumps(v))`,
    ],
    { input: JSON.stringify(p), encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
async function withBackend(run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (String(url) === "/api/validate") {
      const errors = python("validate", body);
      return new Response(
        JSON.stringify({ valid: errors.length === 0, errors }),
      );
    }
    if (String(url) === "/api/simulate")
      return new Response(JSON.stringify(python("simulate", body)));
    throw Error("Unexpected endpoint " + url);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}
test("builder persona: discover/add/select uses the actual UI command and preserves undo semantics", async () => {
  const { w, tools } = setup();
  const ui = new Workspace();
  ui.replace(project());
  ui.set({ catalog: w.get().catalog });
  const catalog = await call(tools, "search_components", { query: "cache" });
  assert.equal(catalog.result[0].type, "cache");
  const f = w.fence();
  const added = await call(tools, "add_component", {
    type: "cache",
    x: 210,
    y: 230,
    expected: f,
  });
  assert.equal(added.ok, true);
  ui.add("cache", 210, 230);
  const a = w.get().project.nodes.at(-1)!,
    b = ui.get().project.nodes.at(-1)!;
  assert.deepEqual({ ...a, id: "same" }, { ...b, id: "same" });
  assert.equal(w.get().panel, ui.get().panel);
  assert.deepEqual(w.get().history, ui.get().history);
  const retry = await call(tools, "add_component", {
    type: "cache",
    x: 0,
    y: 0,
    expected: f,
  });
  assert.equal(retry.ok, false);
  assert.equal(w.get().project.nodes.length, 3);
  await call(tools, "history", { direction: "undo", expected: w.fence() });
  assert.equal(w.get().project.nodes.length, 2);
});
test("operator persona: compound edit/connection/scenario validates, reviews, applies once and undoes completely", async () =>
  withBackend(async () => {
    const { w, review, tools } = setup(),
      before = structuredClone(w.get().project),
      proposal = structuredClone(before);
    proposal.nodes.forEach((n) => (n.config.capacity_rps = 250));
    proposal.edges.push({
      id: "a-b",
      source: "a",
      target: "b",
      latency_ms: 1,
      weight: 1,
      async: false,
    });
    proposal.scenario.events.push({
      id: "fail-b",
      type: "fail",
      target: "b",
      time: 1,
    });
    const prepared = await call(tools, "prepare_architecture_changes", {
      project: proposal,
      expected: w.fence(),
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.result.applied, false);
    assert.deepEqual(w.get().project, before);
    assert.equal(w.get().modal, "architecture-review");
    // The human button calls this exact command, demonstrating UI/tool review parity.
    review.apply(prepared.result.reviewId, w.fence());
    assert.deepEqual(w.get().project, proposal);
    assert.equal(review.get(), null);
    w.undo();
    assert.deepEqual(w.get().project, before);
    assert.equal(w.get().history.canUndo, false);
    const stale = await call(tools, "apply_architecture_review", {
      reviewId: prepared.result.reviewId,
      confirm: true,
      expected: w.fence(),
    });
    assert.equal(stale.ok, false);
  }));
test("real topology validation rejects a cycle; invalid args, stale fences, dialogs and gestures never mutate", async () =>
  withBackend(async () => {
    const { w, tools } = setup(),
      before = structuredClone(w.get().project);
    const proposal = structuredClone(before);
    proposal.edges = [
      { id: "a-b", source: "a", target: "b" },
      { id: "b-a", source: "b", target: "a" },
    ];
    assert.equal(
      (
        await call(tools, "prepare_architecture_changes", {
          project: proposal,
          expected: w.fence(),
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await call(tools, "add_component", {
          type: "cache",
          x: Infinity,
          y: 0,
          expected: w.fence(),
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await call(tools, "add_component", {
          type: "cache",
          x: 0,
          y: 0,
          expected: w.fence(),
          unexpected: true,
        })
      ).ok,
      false,
    );
    w.setGesture(true);
    assert.equal(
      (
        await call(tools, "add_component", {
          type: "cache",
          x: 0,
          y: 0,
          expected: w.fence(),
        })
      ).ok,
      false,
    );
    w.setGesture(false);
    w.set({ modal: "calibration" });
    assert.equal(
      (
        await call(tools, "add_component", {
          type: "cache",
          x: 0,
          y: 0,
          expected: w.fence(),
        })
      ).ok,
      false,
    );
    assert.deepEqual(w.get().project, before);
  }));
test("cancelled and superseded preparations cannot publish an applicable proposal", async () => {
  const { w, review } = setup(),
    original = globalThis.fetch;
  let release!: (value: Response) => void;
  globalThis.fetch = async () => new Promise((r) => (release = r));
  try {
    const preparing = review.prepare(project(), w.fence());
    review.cancel();
    release(new Response(JSON.stringify({ valid: true })));
    await assert.rejects(preparing, /cancelled or superseded/);
    assert.equal(review.get(), null);
    const controller = new AbortController(),
      cancelled = review.prepare(project(), w.fence(), controller.signal);
    controller.abort();
    release(new Response(JSON.stringify({ valid: true })));
    await assert.rejects(cancelled);
    assert.equal(review.get(), null);
  } finally {
    globalThis.fetch = original;
  }
});
test("overlapping agent mutation fails while a real-engine run completes; failed run never reports success", async () => {
  const { w, tools } = setup(),
    original = globalThis.fetch;
  let release!: (value: Response) => void;
  globalThis.fetch = async () => new Promise((r) => (release = r));
  try {
    const running = call(tools, "run_simulation", { expected: w.fence() });
    const added = await call(tools, "add_component", {
      type: "cache",
      x: 0,
      y: 0,
      expected: w.fence(),
    });
    assert.equal(added.ok, false);
    assert.match(added.error, /Another agent action/);
    release(new Response(JSON.stringify(python("simulate", project()))));
    const result = await running;
    assert.equal(result.ok, true);
    assert.equal(result.result.run.fresh, true);
    assert.equal(result.result.run.summary.requests, 4);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Synthetic unavailable backend" }), {
        status: 503,
      });
    const failed = await call(tools, "run_simulation", { expected: w.fence() });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /unavailable backend/);
    assert.equal(w.get().run?.summary.requests, 4);
  } finally {
    globalThis.fetch = original;
  }
});
test("review invalidates after editing and undo; applying requires explicit confirmation", async () =>
  withBackend(async () => {
    const { w, tools } = setup();
    const p = project();
    p.name = "New name";
    const proposal = await call(tools, "prepare_architecture_changes", {
      project: p,
      expected: w.fence(),
    });
    const unconfirmed = await call(tools, "apply_architecture_review", {
      reviewId: proposal.result.reviewId,
      confirm: false,
      expected: w.fence(),
    });
    assert.equal(unconfirmed.ok, false);
    w.edit((d) => {
      d.name = "Intervening edit";
    });
    w.undo();
    const applied = await call(tools, "apply_architecture_review", {
      reviewId: proposal.result.reviewId,
      confirm: true,
      expected: w.fence(),
    });
    assert.equal(applied.ok, false);
    assert.equal(w.get().project.name, "Synthetic QA");
  }));
test("native registration detects missing support and rolls back partial failure, without a fake runtime transport", async () => {
  await registerAgentTools(undefined, "");
  assert.equal(agentStatus.get().state, "unavailable");
  const { tools } = setup();
  const removed: string[] = [];
  let count = 0,
    signal: AbortSignal | undefined;
  await registerAgentTools(
    {
      registerTool: (_tool, options) => {
        signal = options?.signal;
        if (++count === 2) throw Error("Synthetic registration rejection");
      },
      unregisterTool: (name) => {
        removed.push(name);
      },
    },
    "test-native-mock",
    tools,
  );
  assert.equal(agentStatus.get().state, "failed");
  assert.equal(signal?.aborted, true);
  assert.deepEqual(removed, [tools[0].name]);
  assert.deepEqual(agentStatus.get().tools, []);
  const accepted: string[] = [];
  const cleanup = await registerAgentTools(
    {
      registerTool: (tool) => {
        accepted.push(tool.name);
      },
      unregisterTool: (name) => {
        removed.push(name);
      },
    },
    "test-native-mock",
    tools,
  );
  assert.equal(agentStatus.get().state, "available");
  assert.deepEqual(
    accepted,
    tools.map((t) => t.name),
  );
  cleanup();
  assert.ok(removed.includes(tools.at(-1)!.name));
});
test("tool activity is bounded and records only action metadata, never project payloads", async () => {
  const { tools } = setup();
  for (let i = 0; i < 25; i++) await call(tools, "inspect_workspace");
  assert.equal(agentStatus.get().activity.length, 20);
  assert.equal(
    JSON.stringify(agentStatus.get().activity).includes("Synthetic QA"),
    false,
  );
});
test("agent actions honor modal UI boundaries; closing a review cancels its apply token", async () =>
  withBackend(async () => {
    const { w, review, tools } = setup();
    await call(tools, "prepare_architecture_changes", {
      project: project(),
      expected: w.fence(),
    });
    assert.ok(review.get());
    const denied = await call(tools, "add_component", {
      type: "cache",
      x: 0,
      y: 0,
      expected: w.fence(),
    });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /open dialog/);
    const closed = await call(tools, "open_view", {
      view: "canvas",
      expected: w.fence(),
    });
    assert.equal(closed.ok, true);
    assert.equal(w.get().modal, null);
    assert.equal(review.get(), null);
    w.set({ modal: "pricing" });
    const closePricing = await call(tools, "open_view", {
      view: "canvas",
      expected: w.fence(),
    });
    assert.equal(closePricing.ok, true);
    assert.equal(w.get().modal, null);
  }));
test("cancelled native simulation cannot attach a late result or replace earlier evidence", async () => {
  const { w, tools } = setup(),
    original = globalThis.fetch;
  let release!: (value: Response) => void;
  let fetchSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, options) => {
    fetchSignal = options?.signal;
    return new Promise((r) => (release = r));
  };
  try {
    const controller = new AbortController(),
      tool = tools.find((t) => t.name === "tds_run_simulation")!;
    const running = tool.execute(
      { expected: w.fence() },
      { signal: controller.signal },
    );
    assert.equal(fetchSignal, controller.signal);
    controller.abort();
    release(new Response(JSON.stringify(python("simulate", project()))));
    const result = read(await running);
    assert.equal(result.ok, false);
    assert.equal(w.get().run, null);
    assert.equal(w.get().runBusy, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("stale direct command reports useful visible recovery and cannot change project/history", async () => {
  const { w, tools } = setup(),
    old = w.fence();
  w.edit((p) => {
    p.name = "New revision";
  });
  const project = w.get().project,
    history = w.get().history;
  w.notify("Experiment complete. Play or scrub the timeline.");
  const rejected = await call(tools, "add_component", {
    type: "cache",
    x: 600,
    y: 0,
    expected: old,
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Workspace changed.*Inspect.*retry/);
  assert.doesNotMatch(rejected.error, /new review/);
  assert.match(
    w.get().notice?.text || "",
    /Agent action rejected.*Workspace changed/,
  );
  assert.equal(w.get().notice?.error, true);
  assert.equal(w.get().project, project);
  assert.equal(w.get().history, history);
  const readOnly = await call(tools, "inspect_workspace");
  const added = await call(tools, "add_component", {
    type: "cache",
    x: 600,
    y: 0,
    expected: readOnly.fence,
  });
  assert.equal(added.ok, true);
  assert.equal(w.get().project.nodes.length, 3);
});
