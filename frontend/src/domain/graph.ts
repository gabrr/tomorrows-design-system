import type { Frame, Project, Selection } from "./types";

/** Rates over two retained samples, never utilization or successful completions.
 * received includes rejected arrivals; requests counts routed calls on an edge.
 * A missing baseline, counter or positive interval is unavailable, not zero.
 */
export function sampledTraffic(
  frames: readonly Frame[],
  index: number,
  fresh: boolean,
) {
  const frame = fresh ? frames[index] : undefined;
  const previous = fresh && index > 0 ? frames[index - 1] : undefined;
  const seconds = frame && previous ? frame.time - previous.time : NaN;
  const interval =
    frame &&
    previous &&
    Number.isFinite(frame.time) &&
    Number.isFinite(previous.time) &&
    previous.time >= 0 &&
    Number.isFinite(seconds) &&
    seconds > 0
      ? { from: previous.time, to: frame.time, seconds }
      : null;
  const rate = (now: unknown, before: unknown): number | null => {
    if (
      !interval ||
      typeof now !== "number" ||
      typeof before !== "number" ||
      !Number.isFinite(now) ||
      !Number.isFinite(before) ||
      before < 0 ||
      now < before
    )
      return null;
    const value = (now - before) / interval.seconds;
    return Number.isFinite(value) ? value : null;
  };
  return {
    frame,
    interval,
    nodeRates: Object.fromEntries(
      Object.entries(frame?.nodes ?? {}).map(([id, n]) => [
        id,
        rate(n.received, previous?.nodes[id]?.received),
      ]),
    ) as Record<string, number | null>,
    edgeRates: Object.fromEntries(
      Object.entries(frame?.edges ?? {}).map(([id, e]) => [
        id,
        rate(e.requests, previous?.edges[id]?.requests),
      ]),
    ) as Record<string, number | null>,
  };
}

type LabelRect = { x: number; y: number; width: number; height: number };
const overlaps = (a: LabelRect, b: LabelRect) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/** Try nearby points on the actual connection curve; never cover cards/other labels.
 * Returns the SVG text baseline and its reserved box, or null (node rates remain visible).
 */
export function connectionRatePosition(
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  nodes: readonly { x: number; y: number }[],
  occupied: readonly LabelRect[] = [],
) {
  const bend =
    b.x >= a.x ? (b.x - a.x) * 0.45 : Math.max(60, Math.abs(b.x - a.x) * 0.45);
  for (const t of [0.5, 0.35, 0.65]) {
    const u = 1 - t;
    const x =
      u ** 3 * a.x +
      3 * u ** 2 * t * (a.x + bend) +
      3 * u * t ** 2 * (b.x - bend) +
      t ** 3 * b.x;
    const y =
      u ** 3 * a.y + 3 * u ** 2 * t * a.y + 3 * u * t ** 2 * b.y + t ** 3 * b.y;
    for (const offset of [-8, -24, 22]) {
      const baseline = y + offset;
      const rect = { x: x - width / 2, y: baseline - 13, width, height: 18 };
      if (
        nodes.some((n) =>
          overlaps(rect, { x: n.x - 8, y: n.y - 8, width: 216, height: 126 }),
        ) ||
        occupied.some((r) => overlaps(rect, r))
      )
        continue;
      return { x, y: baseline, rect };
    }
  }
  return null;
}
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
