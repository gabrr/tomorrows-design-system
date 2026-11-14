import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadPyodide } from "pyodide";
import "fake-indexeddb/auto";

const python = await loadPyodide();
python.unpackArchive(new Uint8Array(readFileSync("dist/browser/model.zip")), "zip");
python.runPython("from tds.hosted import dispatch_json");
const projects = JSON.parse(readFileSync("dist/browser/presets.json", "utf8")).presets;
function dispatch(path, body) {
  python.globals.set("path", path);
  python.globals.set("body", JSON.stringify(body));
  return JSON.parse(python.runPython("dispatch_json(path, body)"));
}
globalThis.window = globalThis;
globalThis.Worker = class {
  terminated = false;
  postMessage({ id, path, body }) {
    setTimeout(() => {
      if (this.terminated) return;
      try { this.onmessage({ data: { id, value: dispatch(path, body) } }); }
      catch (error) { this.onmessage({ data: { id, error: error.message } }); }
    }, 0);
  }
  terminate() { this.terminated = true; }
};
const { browserRequest: request } = await import("../artifacts/browser-test.mjs");
const post = (path, body, extra = {}) => request(path, { method: "POST", body: JSON.stringify(body), ...extra });

test("all four presets produce the same outcomes in WebAssembly and CPython", () => {
  const reference = JSON.parse(execFileSync("python3", ["-c", "import json; from tds.catalog import presets; from tds.simulation import simulate; print(json.dumps([simulate(p) for p in presets()]))"], { maxBuffer: 20_000_000 }));
  projects.forEach((project, index) => {
    const actual = dispatch("/api/simulate", project);
    // CPython and WebAssembly can differ in their last floating-point bits.
    const rounded = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "number" ? Number(item.toPrecision(11)) : item));
    assert.deepEqual(rounded(actual), rounded(reference[index]), project.name);
  });
});
test("project saves validate, survive client re-import and stay separate", async () => {
  const p = structuredClone(projects[0]); p.id = "browser-save-test";
  await request(`/api/projects/${p.id}`, { method: "PUT", body: JSON.stringify(p) });
  const reloaded = (await import("../artifacts/browser-test.mjs?reloaded")).browserRequest;
  assert.deepEqual(await reloaded(`/api/projects/${p.id}`), p);
  assert.equal((await request("/api/projects")).projects.length, 1);
  const invalid = { ...p, nodes: [{ id: "bad", type: "nonexistent" }] };
  await assert.rejects(request(`/api/projects/${p.id}`, { method: "PUT", body: JSON.stringify(invalid) }));
  assert.deepEqual(await request(`/api/projects/${p.id}`), p);
  await request(`/api/projects/${p.id}`, { method: "DELETE" });
  await assert.rejects(request(`/api/projects/${p.id}`));
});
test("simulation evidence is retained and can be fetched for replay", async () => {
  const result = await post("/api/simulate", projects[0]);
  assert.equal(result.project_snapshot.id, projects[0].id);
  assert.ok(result.frames.length > 0);
  assert.deepEqual(await request(`/api/runs/${result.run_id}`), result);
});
test("cancellation stops pending work and the engine can restart", async () => {
  const controller = new AbortController();
  const run = post("/api/simulate", projects[0], { signal: controller.signal });
  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  assert.equal((await post("/api/validate", projects[0])).valid, true);
});
test("AI is explicitly unavailable and invalid bodies are rejected", async () => {
  assert.deepEqual((await request("/api/ai")).providers, []);
  await assert.rejects(post("/api/ai/generate", {}), /local edition/);
  await assert.rejects(post("/api/pricing/refresh", {}), /manual/);
  await assert.rejects(request("/api/projects/wrong", { method: "PUT", body: JSON.stringify(projects[0]) }), /identifier/);
  await assert.rejects(post("/api/validate", { giant: "a".repeat(2 * 1024 * 1024) }), /2 MiB/);
});
