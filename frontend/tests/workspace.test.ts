import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Workspace } from "../src/workspace/store";
import type { Project, Run } from "../src/domain/types";
Object.assign(globalThis, { window: { dispatchEvent: () => true } });
const project = (): Project => ({
  id: "workspace-fixture",
  name: "Workspace fixture",
  nodes: [
    {
      id: "service",
      label: "Service",
      type: "api_service",
      x: 0,
      y: 0,
      config: { capacity_rps: 100, latency_ms: 10, hourly_cost: 0.1 },
    },
  ],
  edges: [],
  scenario: { duration: 2, rps: 2, seed: 42, events: [] },
  monthly: { hours: 730, traffic_multiplier: 1 },
});
function engine(p: Project): Run {
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import json,sys;from tds.simulation import simulate;print(json.dumps(simulate(json.load(sys.stdin))))",
    ],
    { input: JSON.stringify(p), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(result.stdout), project_snapshot: structuredClone(p) };
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
test("transient gestures never mutate committed projects and block proposal application", () => {
  const w = new Workspace();
  w.replace(project());
  const fence = w.fence(),
    before = structuredClone(w.get().project);
  w.setGesture(true);
  assert.deepEqual(w.get().project, before);
  assert.deepEqual(w.fence(), fence);
  assert.throws(() => w.apply(project(), fence), /drag/);
  w.setGesture(false);
  const next = project();
  next.name = "Applied";
  w.apply(next, fence, "Apply AI design");
  assert.equal(w.get().history.canUndo, true);
  w.undo();
  assert.equal(w.get().project.name, before.name);
  assert.throws(() => w.apply(next, fence), /Workspace changed/);
});
test("simulation response after a same-workspace edit is retained only as stale evidence", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  let release!: (v: Response) => void, captured!: Project;
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(String(options?.body));
    return new Promise((r) => (release = r));
  };
  try {
    const running = w.run();
    w.edit((p) => {
      p.name = "Newer design";
    });
    release(response(engine(captured)));
    await running;
    assert.equal(w.get().project.name, "Newer design");
    assert.equal(w.get().run?.summary.requests, 4);
    assert.notEqual(w.get().runRevision, w.get().revision);
    assert.equal(w.get().runBusy, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("simulation reply cannot populate a replacement workspace sharing node IDs", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  let release!: (v: Response) => void, captured!: Project;
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(String(options?.body));
    return new Promise((r) => (release = r));
  };
  try {
    const running = w.run();
    const next = project();
    next.id = "replacement";
    w.replace(next);
    release(response(engine(captured)));
    await running;
    assert.equal(w.get().run, null);
    assert.equal(w.get().project.id, "replacement");
    assert.equal(w.get().runBusy, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("a failed experiment preserves last successful evidence and a pinned baseline", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  globalThis.fetch = async (_u, options) =>
    response(engine(JSON.parse(String(options?.body))));
  try {
    await w.run();
    w.pinBaseline();
    const baseline = structuredClone(w.get().baseline);
    globalThis.fetch = async () =>
      response({ error: "Synthetic backend failure" }, 503);
    await w.run();
    assert.deepEqual(w.get().baseline, baseline);
    assert.equal(w.get().run?.summary.requests, 4);
    assert.equal(w.get().notice?.error, true);
    assert.equal(w.get().runBusy, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("pinned baseline survives later runs independently of the previous run", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  globalThis.fetch = async (_u, options) =>
    response(engine(JSON.parse(String(options?.body))));
  try {
    await w.run();
    w.pinBaseline();
    w.edit((p) => {
      p.scenario.rps = 3;
    });
    await w.run();
    w.edit((p) => {
      p.scenario.rps = 4;
    });
    await w.run();
    assert.equal(w.get().baseline?.summary.requests, 4);
    assert.equal(w.get().previous?.summary.requests, 6);
    assert.equal(w.get().run?.summary.requests, 8);
    w.clearBaseline();
    assert.equal(w.get().baseline, null);
    assert.equal(w.get().previous?.summary.requests, 6);
  } finally {
    globalThis.fetch = original;
  }
});
test("save persists captured revision, never clears newer dirty edits, and serializes submissions", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  let release!: (v: Response) => void,
    calls = 0,
    captured!: Project;
  globalThis.fetch = async (_u, options) => {
    calls++;
    captured = JSON.parse(String(options?.body));
    return new Promise((r) => (release = r));
  };
  try {
    const saving = w.save();
    await w.save();
    assert.equal(calls, 1);
    w.edit((p) => {
      p.name = "Edited during save";
    });
    release(response({ ok: true }));
    await saving;
    assert.equal(captured.name, "Workspace fixture");
    assert.equal(w.get().dirty, true);
    assert.equal(w.get().saveBusy, false);
    assert.equal(w.get().project.name, "Edited during save");
  } finally {
    globalThis.fetch = original;
  }
});
test("save reply cannot mark a replacement workspace saved", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  let release!: (v: Response) => void;
  globalThis.fetch = async () => new Promise((r) => (release = r));
  try {
    const saving = w.save();
    w.replace({ ...project(), id: "other" });
    release(response({ ok: true }));
    await saving;
    assert.equal(w.get().dirty, true);
    assert.equal(w.get().saveBusy, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("contradictory imported baseline is rejected without replacing current architecture", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  const valid = engine(project()),
    forged = structuredClone(valid);
  forged.summary.completed++;
  const p = {
    ...project(),
    name: "Unaccepted replacement",
    _workspace: {
      format_version: 1,
      current_run: valid,
      run_project: project(),
      baseline_run: forged,
    },
  };
  globalThis.fetch = async () => response({ valid: true });
  try {
    const text = JSON.stringify(p);
    await w.importFile({ size: text.length, text: async () => text } as File);
    assert.equal(w.get().project.name, "Workspace fixture");
    assert.match(w.get().importRejected!.reason, /conservation|contradicts/);
    assert.equal(w.get().modal, "import-rejected");
    w.importArchitectureOnly();
    assert.equal(w.get().project.name, "Unaccepted replacement");
    assert.equal(w.get().run, null);
    assert.equal(w.get().baseline, null);
  } finally {
    globalThis.fetch = original;
  }
});
test("valid imported evidence is always external and stale, ignoring forged freshness flag", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  const run = engine(project()),
    p = {
      ...project(),
      _workspace: {
        format_version: 1,
        current_run: run,
        run_project: project(),
        previous_run: run,
        baseline_run: run,
        results_stale: false,
      },
    };
  globalThis.fetch = async () => response({ valid: true });
  try {
    const text = JSON.stringify(p);
    await w.importFile({ size: text.length, text: async () => text } as File);
    assert.equal(w.get().run?.evidence_origin, "Unverified external evidence");
    assert.equal(
      w.get().baseline?.evidence_origin,
      "Unverified external evidence",
    );
    assert.notEqual(w.get().runRevision, w.get().revision);
  } finally {
    globalThis.fetch = original;
  }
});
test("delayed import validation cannot replace edits or an identically shaped new workspace", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  let release!: (v: Response) => void;
  globalThis.fetch = async () => new Promise((r) => (release = r));
  try {
    const text = JSON.stringify(project()),
      file = { size: text.length, text: async () => text } as File;
    const importing = w.importFile(file);
    await new Promise((r) => setTimeout(r, 0));
    w.replace({ ...project(), name: "Keep this workspace" });
    release(response({ valid: true }));
    await assert.rejects(importing, /Workspace changed/);
    assert.equal(w.get().project.name, "Keep this workspace");
  } finally {
    globalThis.fetch = original;
  }
});

test("project replacement clears old notices and panels, while a pristine new canvas needs no discard warning", () => {
  const w = new Workspace();
  w.replace(project());
  w.notify("Design saved locally.");
  w.set({ panel: "experiment" });
  w.beginScenarioDraft();
  w.newProject();
  assert.equal(w.get().notice, null);
  assert.equal(w.get().panel, null);
  assert.equal(w.get().scenarioDraft, null);
  assert.equal(w.get().run, null);
  assert.equal(w.hasUnsavedWork(), false);
  assert.equal(w.get().history.canUndo, false);
  w.edit((p) => {
    p.name = "My next system";
  });
  assert.equal(w.hasUnsavedWork(), true);
});

test("pending scenario edits count as unsaved and cannot silently run or save the old events", async () => {
  const w = new Workspace(),
    original = globalThis.fetch;
  w.replace(project());
  w.set({ dirty: false });
  const retained = engine(project());
  w.set({ run: retained });
  w.beginScenarioDraft();
  assert.equal(w.hasUnsavedWork(), false);
  w.editScenarioDraft((events) => [
    ...events,
    { id: "outage", type: "fail", target: "service", time: 1 },
  ]);
  assert.equal(w.get().dirty, false);
  assert.equal(w.hasUnsavedWork(), true);
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw Error("Must not reach HTTP");
  };
  try {
    await w.run();
    assert.match(w.get().notice!.text, /scenario draft before running/);
    assert.equal(w.get().run, retained);
    assert.equal(w.get().runBusy, false);
    await w.save();
    assert.match(w.get().notice!.text, /scenario draft before saving/);
    assert.equal(w.get().saveBusy, false);
    assert.equal(requests, 0);
    assert.equal(w.get().scenarioDraft?.events.length, 1);
    w.cancelScenarioDraft();
    assert.equal(w.hasUnsavedWork(), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("a successful edit clears obsolete result/error notices without dropping retained evidence", () => {
  const w = new Workspace();
  w.replace(project());
  const retained = engine(project());
  w.set({ run: retained });
  w.notify("Old invalid value", true);
  w.edit((p) => {
    p.nodes[0].config.capacity_rps = 200;
  });
  assert.equal(w.get().notice, null);
  assert.equal(w.get().run, retained);
});

test("legacy project-only run evidence is normalized for current, previous and baseline tables", async () => {
  const original = globalThis.fetch,
    w = new Workspace(),
    p = project();
  const evidence = engine(p) as Run & { project?: Project };
  evidence.project = structuredClone(p);
  delete (evidence as Partial<Run>).project_snapshot;
  const bundle = {
    ...p,
    _workspace: {
      format_version: 1,
      current_run: evidence,
      previous_run: evidence,
      baseline_run: evidence,
      run_project: p,
    },
  };
  const text = JSON.stringify(bundle);
  globalThis.fetch = async () => response({ valid: true });
  try {
    await w.importFile({ size: text.length, text: async () => text } as File);
    for (const run of [w.get().run, w.get().previous, w.get().baseline]) {
      assert.deepEqual(run?.project_snapshot, p);
      assert.equal(run?.evidence_origin, "Unverified external evidence");
    }
    assert.equal(w.get().runRevision, -1);
  } finally {
    globalThis.fetch = original;
  }
});

test("scenario validation cannot commit during a gesture and retains the draft for retry", async () => {
  const original = globalThis.fetch,
    w = new Workspace();
  w.replace(project());
  w.beginScenarioDraft();
  w.editScenarioDraft(() => [
    { id: "fail", type: "fail", target: "service", time: 1 },
  ]);
  const initial = w.fence();
  let release!: (value: Response) => void;
  globalThis.fetch = async () =>
    new Promise((resolve) => {
      release = resolve;
    });
  try {
    w.setGesture(true);
    await assert.rejects(w.saveScenarioDraft(), /canvas gesture/);
    w.setGesture(false);
    const saving = w.saveScenarioDraft();
    w.setGesture(true);
    release(response({ valid: true }));
    await assert.rejects(saving, /canvas gesture/);
    assert.deepEqual(w.fence(), initial);
    assert.equal(w.get().project.scenario.events.length, 0);
    assert.equal(w.get().scenarioDraft?.events.length, 1);
    assert.equal(w.get().gestureActive, true);
    w.setGesture(false);
    globalThis.fetch = async () => response({ valid: true });
    await w.saveScenarioDraft();
    assert.equal(w.get().project.scenario.events.length, 1);
    w.undo();
    assert.equal(w.get().project.scenario.events.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
