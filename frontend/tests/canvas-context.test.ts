import { test } from "node:test";
import assert from "node:assert/strict";
import { clickNodePosition, revealGraph } from "../src/domain/graph";
import type { Project } from "../src/domain/types";

const nodes: Project["nodes"] = [
  {
    id: "lb",
    label: "Balancer",
    type: "load_balancer",
    x: 80,
    y: 160,
    config: {},
  },
  { id: "a", label: "App A", type: "api_service", x: 340, y: 80, config: {} },
  { id: "b", label: "App B", type: "api_service", x: 340, y: 240, config: {} },
  { id: "db", label: "Database", type: "postgres", x: 620, y: 300, config: {} },
];
const area = { left: 90, right: 890, top: 120, bottom: 490 };
test("a diagram beyond the zoom floor still reveals the selected working group", () => {
  const huge = [...nodes, { ...nodes[3], id: "far", x: 20000 }];
  const camera = revealGraph(huge, { x: 0, y: 0, zoom: 1 }, area, [nodes[1]]);
  assert.ok(nodes[1].x * camera.zoom + camera.x >= area.left);
  assert.ok((nodes[1].x + 200) * camera.zoom + camera.x <= area.right);
});
test("opening inspector keeps database and services in unobscured canvas; repeated selection is stable", () => {
  const camera = revealGraph(nodes, { x: 297, y: 60, zoom: 0.9 }, area);
  for (const n of nodes) {
    assert.ok(n.x * camera.zoom + camera.x >= area.left - 1e-9);
    assert.ok((n.x + 200) * camera.zoom + camera.x <= area.right + 1e-9);
    assert.ok(n.y * camera.zoom + camera.y >= area.top - 1e-9);
    assert.ok((n.y + 110) * camera.zoom + camera.y <= area.bottom + 1e-9);
  }
  assert.deepEqual(revealGraph(nodes, camera, area), camera);
  assert.equal(camera.zoom, 0.9); // No unnecessary zoom when a translation suffices.
});
test("click-add extends working selection or downstream graph and avoids occupied cards", () => {
  const selected = clickNodePosition(nodes, { kind: "node", id: "a" });
  assert.ok(selected.x > nodes[1].x);
  const downstream = clickNodePosition(nodes, null);
  assert.ok(downstream.x > nodes[3].x);
  const all = structuredClone(nodes);
  for (let i = 0; i < 12; i++) {
    const point = clickNodePosition(all, { kind: "node", id: "a" });
    assert.ok(
      !all.some(
        (n) =>
          point.x < n.x + 224 &&
          point.x + 224 > n.x &&
          point.y < n.y + 134 &&
          point.y + 134 > n.y,
      ),
    );
    all.push({ ...nodes[1], id: `added-${i}`, ...point });
  }
  assert.deepEqual(clickNodePosition([], null), { x: 200, y: 180 });
});
