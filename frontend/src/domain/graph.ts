import type { Project, Selection } from "./types";
/** Click insertion extends the selected working context downstream; explicit drops stay exact. */
export function clickNodePosition(
  nodes: Project["nodes"],
  selection: Selection,
) {
  const selected = new Set(selectedNodeIds(selection));
  const context = nodes.filter((n) => selected.has(n.id));
  const anchor = context.length ? context : nodes;
  if (!anchor.length) return { x: 200, y: 180 };
  return freeNodePosition(nodes, {
    x: Math.max(...anchor.map((n) => n.x)) + 280,
    y:
      (Math.min(...anchor.map((n) => n.y)) +
        Math.max(...anchor.map((n) => n.y))) /
      2,
  });
}

/** Keep the whole local diagram beside overlays, using the smallest camera adjustment. */
export function revealGraph(
  nodes: Project["nodes"],
  camera: { x: number; y: number; zoom: number },
  area: { left: number; right: number; top: number; bottom: number },
  focus: Project["nodes"] = [],
) {
  if (!nodes.length) return camera;
  // At the supported zoom floor, a very large diagram cannot fit. Preserve
  // access to the selected working group instead of panning it offscreen.
  if (focus.length && focus.length < nodes.length) {
    const width =
      Math.max(...nodes.map((n) => n.x + 200)) -
      Math.min(...nodes.map((n) => n.x));
    const height =
      Math.max(...nodes.map((n) => n.y + 110)) -
      Math.min(...nodes.map((n) => n.y));
    if (
      width * 0.25 > area.right - area.left ||
      height * 0.25 > area.bottom - area.top
    )
      return revealGraph(focus, camera, area);
  }
  const minX = Math.min(...nodes.map((n) => n.x)),
    maxX = Math.max(...nodes.map((n) => n.x + 200)),
    minY = Math.min(...nodes.map((n) => n.y)),
    maxY = Math.max(...nodes.map((n) => n.y + 110));
  const zoom = Math.max(
    0.25,
    Math.min(
      camera.zoom,
      (area.right - area.left) / (maxX - minX),
      (area.bottom - area.top) / (maxY - minY),
    ),
  );
  let { x, y } = camera;
  if (minX * zoom + x < area.left) x = area.left - minX * zoom;
  if (maxX * zoom + x > area.right) x = area.right - maxX * zoom;
  if (minY * zoom + y < area.top) y = area.top - minY * zoom;
  if (maxY * zoom + y > area.bottom) y = area.bottom - maxY * zoom;
  return { x, y, zoom };
}
export function freeNodePosition(
  nodes: Project["nodes"],
  point: { x: number; y: number },
) {
  const radiusLimit = Math.ceil(Math.sqrt(nodes.length) * 2) + 4;
  for (let radius = 0; radius <= radiusLimit; radius++) {
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = {
          x: Math.round(point.x + dx * 240),
          y: Math.round(point.y + dy * 150),
        };
        if (Math.abs(candidate.x) > 99800 || Math.abs(candidate.y) > 99890)
          continue;
        if (
          !nodes.some(
            (node) =>
              candidate.x < node.x + 224 &&
              candidate.x + 224 > node.x &&
              candidate.y < node.y + 134 &&
              candidate.y + 134 > node.y,
          )
        )
          return candidate;
      }
  }
  throw Error(
    "No free space nearby. Drag the component onto an open canvas area.",
  );
}
export function selectedNodeIds(selection: Selection): string[] {
  return selection?.kind === "nodes"
    ? selection.ids
    : selection?.kind === "node"
      ? [selection.id]
      : [];
}
export function connectionProblem(
  project: Project,
  source: string,
  target: string,
): string {
  if (
    !project.nodes.some((n) => n.id === source) ||
    !project.nodes.some((n) => n.id === target)
  )
    return "A connection endpoint no longer exists.";
  if (source === target) return "Connect two different components.";
  if (project.edges.some((e) => e.source === source && e.target === target))
    return "That connection already exists.";
  const pending = [target],
    seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === source)
      return "This connection would create a cycle. The simulator requires an acyclic graph.";
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of project.edges)
      if (edge.source === id) pending.push(edge.target);
  }
  return "";
}
