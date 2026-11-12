import type { Project, Selection } from "./types";
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
