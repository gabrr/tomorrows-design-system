import { browserHosted } from "../../services/runtime";
import { useEffect, useRef, useState, useCallback, useId } from "react";
import type {
  PointerEvent as RPointerEvent,
  MouseEvent as RMouseEvent,
} from "react";
import {
  Server,
  Database,
  Network,
  Layers,
  Monitor,
  Workflow,
  ArrowRight,
} from "lucide-react";
import {
  ClickableCard,
  IconAction,
  Text,
  Tooltip,
  hasVisibleTooltip,
} from "../../ui";
import { workspace, useWorkspace } from "../../workspace/store";
import type { Node, Fence } from "../../domain/types";
import { fmt } from "../../domain/evidence.js";
import {
  selectedNodeIds,
  connectionProblem,
  revealGraph,
  sampledTraffic,
  connectionRatePosition,
} from "../../domain/graph";
type Point = { x: number; y: number };
type Drag = {
  fence: Fence;
  start: Point;
  positions: Record<string, Point>;
  delta: Point;
  pointer: number;
  host: HTMLElement;
  moved: boolean;
};
type Wire = {
  source: string;
  fence: Fence;
  point: Point;
  target: string | null;
  start?: Point;
  pointer?: number;
  host?: HTMLElement;
  moved?: boolean;
};
function Glyph({ type }: { type: string }) {
  const Icon = /database|sql|storage/.test(type)
    ? Database
    : /cache/.test(type)
      ? Layers
      : /client|browser|mobile/.test(type)
        ? Monitor
        : /queue|worker/.test(type)
          ? Workflow
          : /balanc|gateway/.test(type)
            ? Network
            : Server;
  return <Icon size={20} />;
}
function NodeView({
  node,
  point,
  selected,
  source,
  target,
  stats,
  telemetry,
  arrivalRate,
  onChoose,
  onStart,
  onMove,
  onEnd,
  onCancel,
  onOutput,
  onWireMove,
  onWireEnd,
  onWireLost,
  onKeyboardOutput,
  onInput,
}: {
  node: Node;
  point: Point;
  selected: boolean;
  source: boolean;
  target: boolean;
  stats?: { state: string; utilization: number; queue_depth: number };
  telemetry: boolean;
  arrivalRate: number | null;
  onChoose: (e: RMouseEvent) => void;
  onStart: (e: RPointerEvent<HTMLElement>) => void;
  onMove: (e: RPointerEvent<HTMLElement>) => void;
  onEnd: (e: RPointerEvent<HTMLElement>) => void;
  onCancel: (e: RPointerEvent<HTMLElement>) => void;
  onOutput: (e: RPointerEvent<HTMLElement>) => void;
  onWireMove: (e: RPointerEvent<HTMLElement>) => void;
  onWireEnd: (e: RPointerEvent<HTMLElement>) => void;
  onWireLost: (e: RPointerEvent<HTMLElement>) => void;
  onKeyboardOutput: () => void;
  onInput: () => void;
}) {
  const host = useId();
  return (
    <div
      className={`diagram-node-shell ${selected ? "is-selected" : ""} ${source ? "is-source" : ""} ${target ? "is-target" : ""}`}
      style={{ left: point.x, top: point.y }}
    >
      <Tooltip
        isEnabled={!!stats}
        touchTrigger="none"
        focusTrigger="always"
        content={
          stats
            ? `Utilization ${fmt(stats.utilization * 100, 1)}% · Queue ${stats.queue_depth}. Arrivals include rejected calls.`
            : ""
        }
      >
        <ClickableCard
          data-node-id={node.id}
          data-connection-target={node.id}
          data-ui-host={host}
          label={`${node.label}, ${node.type}${selected ? ", selected" : ""}${stats ? `, ${stats.state}, utilization ${fmt(stats.utilization * 100, 1)}%, queue ${stats.queue_depth}` : ""}${telemetry ? `, ${arrivalRate === null ? "arrivals unavailable" : fmt(arrivalRate, 1) + " arrivals per simulated second"}` : ""}`}
          className={`diagram-node ${selected ? "is-selected" : ""} ${source ? "is-source" : ""} ${stats?.state === "down" ? "is-down" : ""}`}
          padding={3}
          onClick={onChoose}
          onPointerDown={onStart}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onCancel}
          onLostPointerCapture={onCancel}
        >
          <div className="node-copy">
            <div className="node-heading">
              <Glyph type={node.type} />
              <div>
                <strong>{node.label}</strong>
                <small>{node.type.replaceAll("_", " ")}</small>
              </div>
            </div>
            <div className="node-reading">
              <span>
                {telemetry
                  ? (stats?.state ?? "State unavailable")
                  : String(node.config.provider || "generic")}
              </span>
              <span>
                {telemetry ? (
                  <strong className="node-arrival">
                    {arrivalRate === null
                      ? "Arrivals —"
                      : `${fmt(arrivalRate, 1)}/s arriving`}
                  </strong>
                ) : (
                  `Capacity ${node.config.capacity_rps ?? "—"}/s`
                )}
              </span>
            </div>
          </div>
        </ClickableCard>
      </Tooltip>
      <IconAction
        label={`Connect into ${node.label}`}
        icon={<ArrowRight size={14} />}
        size="sm"
        className="connection-port input-port"
        data-connection-target={node.id}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onInput}
      />
      <IconAction
        label={`Connect from ${node.label}`}
        icon={<ArrowRight size={14} />}
        size="sm"
        className="connection-port output-port"
        onPointerDown={onOutput}
        onPointerMove={onWireMove}
        onPointerUp={onWireEnd}
        onPointerCancel={onWireLost}
        onLostPointerCapture={onWireLost}
        onClick={(e) => {
          if (e.detail === 0) onKeyboardOutput();
        }}
      />
    </div>
  );
}
function curve(a: Point, b: Point) {
  // Nearby forward connections must stay inside the gap rather than loop
  // through the destination card. Backward connections still bend outward.
  const bend =
    b.x >= a.x ? (b.x - a.x) * 0.45 : Math.max(60, Math.abs(b.x - a.x) * 0.45);
  return `M${a.x},${a.y}C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}`;
}
export function Canvas() {
  const s = useWorkspace(),
    surface = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    wire = useRef<Wire | null>(null),
    suppress = useRef(0);
  const [preview, setPreview] = useState<Record<string, Point>>({}),
    [wireView, setWireView] = useState<Wire | null>(null),
    [box, setBox] = useState<{ a: Point; b: Point } | null>(null);
  const pan = useRef<{
    start: Point;
    camera: typeof s.camera;
    host: HTMLElement;
    pointer: number;
    box: boolean;
    world: Point;
    ids: string[];
  } | null>(null);
  const selected = selectedNodeIds(s.selected),
    fresh = !!s.run && s.runRevision === s.revision,
    traffic = sampledTraffic(s.run?.frames ?? [], s.frame, fresh),
    frame = traffic.frame;
  const worldPoint = (x: number, y: number): Point => {
    const r = surface.current!.getBoundingClientRect(),
      c = workspace.get().camera;
    return { x: (x - r.left - c.x) / c.zoom, y: (y - r.top - c.y) / c.zoom };
  };
  const cancelWire = useCallback(() => {
    const w = wire.current;
    if (!w) return;
    wire.current = null;
    setWireView(null);
    workspace.set({ source: null });
    workspace.setGesture(false);
    try {
      if (
        w.host &&
        w.pointer !== undefined &&
        w.host.hasPointerCapture(w.pointer)
      )
        w.host.releasePointerCapture(w.pointer);
    } catch {
      /* Capture can already be lost. */
    }
  }, []);
  const finish = useCallback((cancel = false) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setPreview({});
    workspace.setGesture(false);
    try {
      if (d.host.hasPointerCapture(d.pointer))
        d.host.releasePointerCapture(d.pointer);
    } catch {
      /* Capture can already be lost. */
    }
    if (d.moved) {
      suppress.current = performance.now() + 180;
      if (!cancel)
        try {
          const positions = Object.fromEntries(
            Object.entries(d.positions).map(([id, p]) => [
              id,
              { x: p.x + d.delta.x, y: p.y + d.delta.y },
            ]),
          );
          workspace.moveNodes(positions, d.fence);
        } catch (e) {
          workspace.notify((e as Error).message, true);
        }
    }
  }, []);
  const fit = useCallback(() => {
    const current = workspace.get(),
      p = current.project,
      r = surface.current?.getBoundingClientRect();
    if (!r || !p.nodes.length) return;
    const minX = Math.min(...p.nodes.map((n) => n.x)),
      maxX = Math.max(...p.nodes.map((n) => n.x + 200)),
      minY = Math.min(...p.nodes.map((n) => n.y)),
      maxY = Math.max(...p.nodes.map((n) => n.y + 110));
    const leftInset =
      current.panel === "library"
        ? 296
        : current.panel === "experiment"
          ? 480
          : 0;
    const rightInset = current.aiReviewOpen
      ? 390
      : current.panel === "inspector"
        ? 350
        : 0;
    const availableWidth = r.width - leftInset - rightInset;
    const zoom = Math.min(
      1.15,
      Math.max(
        0.25,
        Math.min(
          (availableWidth - 220) / (maxX - minX),
          (r.height - 330) / (maxY - minY),
        ),
      ),
    );
    workspace.set({
      camera: {
        zoom,
        x:
          leftInset + (availableWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
        y: 110 + (r.height - 300 - (maxY - minY) * zoom) / 2 - minY * zoom,
      },
    });
  }, []);
  useEffect(() => {
    if (
      (s.panel === "library" || s.panel === "experiment") &&
      !workspace.get().gestureActive
    )
      fit();
  }, [s.panel, fit]);
  useEffect(() => {
    if (s.aiReviewOpen && !s.gestureActive) fit();
  }, [s.aiReviewOpen, s.gestureActive, fit]);
  useEffect(() => {
    window.addEventListener("tds:fit", fit);
    const resize = new ResizeObserver(() => {
      if (workspace.get().ready) fit();
    });
    if (surface.current) resize.observe(surface.current);
    return () => {
      window.removeEventListener("tds:fit", fit);
      resize.disconnect();
      finish(true);
      cancelWire();
    };
  }, [fit, finish, cancelWire]);
  useEffect(() => {
    if (drag.current && !workspace.isCurrent(drag.current.fence)) finish(true);
    if (wire.current && !workspace.isCurrent(wire.current.fence)) cancelWire();
    pan.current = null;
    setBox(null);
  }, [s.identity, s.revision, finish, cancelWire]);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      if (drag.current || wire.current?.pointer !== undefined) return;
      e.preventDefault();
      const c = workspace.get().camera;
      if (e.ctrlKey || e.metaKey) {
        const r = element.getBoundingClientRect(),
          zoom = Math.min(
            2.5,
            Math.max(0.25, c.zoom * Math.exp(-e.deltaY * 0.004)),
          ),
          x = e.clientX - r.left,
          y = e.clientY - r.top;
        workspace.set({
          camera: {
            zoom,
            x: x - ((x - c.x) * zoom) / c.zoom,
            y: y - ((y - c.y) * zoom) / c.zoom,
          },
        });
      } else
        workspace.set({
          camera: { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY },
        });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  // Selection may open/move an overlay. Preserve the whole diagram, never move the camera mid-gesture.
  useEffect(() => {
    if (s.panel !== "inspector" || workspace.get().gestureActive) return;
    const current = workspace.get(),
      r = surface.current?.getBoundingClientRect();
    if (!r) return;
    const ids = selectedNodeIds(current.selected);
    const camera = revealGraph(
      current.project.nodes,
      current.camera,
      {
        left: 90,
        right: r.width - (current.aiReviewOpen ? 410 : 390),
        top: 120,
        bottom: r.height - 230,
      },
      current.project.nodes.filter((n) => ids.includes(n.id)),
    );
    if (
      camera.x !== current.camera.x ||
      camera.y !== current.camera.y ||
      camera.zoom !== current.camera.zoom
    )
      workspace.set({ camera });
  }, [s.selected, s.panel, s.gestureActive]);
  useEffect(() => {
    if (wire.current && s.source !== wire.current.source) cancelWire();
  }, [s.source, cancelWire]);
  const position = (n: Node) => preview[n.id] || n;
  function setWire(next: Wire) {
    wire.current = next;
    setWireView({ ...next });
    if (workspace.get().source !== next.source)
      workspace.set({ source: next.source, playing: false });
  }
  function startWire(id: string) {
    cancelWire();
    const n = workspace.get().project.nodes.find((n) => n.id === id);
    if (!n) return;
    setWire({
      source: id,
      fence: workspace.fence(),
      point: { x: n.x + 240, y: n.y + 52 },
      target: null,
    });
  }
  function connectTo(target: string) {
    const w = wire.current;
    if (!w) {
      workspace.notify("Choose a component’s output handle first.");
      return;
    }
    const f = w.fence,
      source = w.source;
    cancelWire();
    try {
      workspace.connect(source, target, f);
    } catch (e) {
      workspace.notify((e as Error).message, true);
    }
  }
  function wireMove(e: RPointerEvent<HTMLElement>) {
    const w = wire.current;
    if (!w || w.pointer !== e.pointerId) return;
    const hit = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-connection-target]"),
      target = hit?.dataset.connectionTarget || null;
    setWire({
      ...w,
      point: worldPoint(e.clientX, e.clientY),
      target,
      moved:
        w.moved ||
        (!!w.start &&
          Math.hypot(e.clientX - w.start.x, e.clientY - w.start.y) > 4),
    });
  }
  function wireEnd(e: RPointerEvent<HTMLElement>) {
    const w = wire.current;
    if (!w || w.pointer !== e.pointerId) return;
    if (w.moved) {
      if (w.target) connectTo(w.target);
      else {
        cancelWire();
        workspace.notify(
          "Connection cancelled. Drop on a component input to connect.",
        );
      }
    } else {
      const pending = {
        ...w,
        pointer: undefined,
        host: undefined,
        start: undefined,
      };
      setWire(pending);
      workspace.setGesture(false);
      try {
        if (w.host?.hasPointerCapture(w.pointer))
          w.host.releasePointerCapture(w.pointer);
      } catch {
        /* Already released. */
      }
    }
  }
  function choose(n: Node, e: RMouseEvent) {
    if (performance.now() < suppress.current) return;
    if (drag.current || pan.current || wire.current?.pointer !== undefined)
      return;
    if (wire.current) {
      connectTo(n.id);
      return;
    }
    workspace.selectNode(n.id, e.shiftKey || e.metaKey || e.ctrlKey);
  }
  function start(e: RPointerEvent<HTMLElement>, n: Node) {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (drag.current || pan.current || wire.current?.pointer !== undefined)
      return;
    e.stopPropagation();
    if (!selectedNodeIds(workspace.get().selected).includes(n.id))
      workspace.selectNode(n.id, false, false);
    const ids = selectedNodeIds(workspace.get().selected);
    e.currentTarget.setPointerCapture(e.pointerId);
    workspace.set({ playing: false });
    workspace.setGesture(true);
    drag.current = {
      fence: workspace.fence(),
      start: { x: e.clientX, y: e.clientY },
      positions: Object.fromEntries(
        workspace
          .get()
          .project.nodes.filter((item) => ids.includes(item.id))
          .map((item) => [item.id, { x: item.x, y: item.y }]),
      ),
      delta: { x: 0, y: 0 },
      pointer: e.pointerId,
      host: e.currentTarget,
      moved: false,
    };
  }
  function move(e: RPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const zoom = workspace.get().camera.zoom,
      dx = Math.round((e.clientX - d.start.x) / zoom),
      dy = Math.round((e.clientY - d.start.y) / zoom);
    if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > 4)
      d.moved = true;
    if (!d.moved) return;
    if (wire.current) {
      cancelWire();
      workspace.setGesture(true);
    }
    d.delta = { x: dx, y: dy };
    setPreview(
      Object.fromEntries(
        Object.entries(d.positions).map(([id, p]) => [
          id,
          { x: p.x + dx, y: p.y + dy },
        ]),
      ),
    );
  }
  function endPan(cancel = false) {
    const p = pan.current;
    if (!p) return;
    pan.current = null;
    setBox(null);
    try {
      if (p.host.hasPointerCapture(p.pointer))
        p.host.releasePointerCapture(p.pointer);
    } catch {
      /* Already released. */
    }
    if (cancel && !p.box) workspace.set({ camera: p.camera });
  }
  function key(e: React.KeyboardEvent) {
    if (
      e.defaultPrevented ||
      (e.target as HTMLElement).closest(
        "input,textarea,[role=combobox],[role=dialog]",
      )
    )
      return;
    const current = workspace.get();
    if (e.key === "Escape") {
      // Tooltips consume Escape through Astryx's layer stack at document level.
      // An idle canvas also defers so normal panel dismissal remains reachable.
      if (
        hasVisibleTooltip() ||
        (!drag.current && !wire.current && !pan.current)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      finish(true);
      cancelWire();
      endPan(true);
      return;
    }
    if (current.gestureActive) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      workspace.selectNodes(current.project.nodes.map((n) => n.id));
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      workspace.removeSelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      workspace.duplicateSelected();
      return;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
      selectedNodeIds(current.selected).length
    ) {
      e.preventDefault();
      cancelWire();
      const ids = selectedNodeIds(current.selected),
        step = e.shiftKey ? 20 : 5;
      const dx =
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
        dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      workspace.moveNodes(
        Object.fromEntries(
          current.project.nodes
            .filter((n) => ids.includes(n.id))
            .map((n) => [n.id, { x: n.x + dx, y: n.y + dy }]),
        ),
        workspace.fence(),
        "move:" + ids.join(","),
      );
    }
  }
  const sourceNode = wireView
      ? s.project.nodes.find((n) => n.id === wireView.source)
      : null,
    wireProblem = wireView?.target
      ? connectionProblem(s.project, wireView.source, wireView.target)
      : "";
  const rateBoxes: { x: number; y: number; width: number; height: number }[] =
    [];
  return (
    <div
      ref={surface}
      id="canvas"
      className={`editor-canvas ${wireView ? "has-source" : ""}`}
      tabIndex={0}
      aria-label="Architecture canvas. Drag nodes to move. Shift-click or Shift-drag to select several. Connect using output and input handles. Two-finger scroll pans; pinch zooms."
      onKeyDown={key}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget || e.button !== 0) return;
        if (drag.current || pan.current || wire.current?.pointer !== undefined)
          return;
        if (wire.current) {
          cancelWire();
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        pan.current = {
          start: { x: e.clientX, y: e.clientY },
          camera: workspace.get().camera,
          host: e.currentTarget,
          pointer: e.pointerId,
          box: e.shiftKey,
          world: worldPoint(e.clientX, e.clientY),
          ids: e.shiftKey ? selectedNodeIds(workspace.get().selected) : [],
        };
        workspace.set({ playing: false });
      }}
      onPointerMove={(e) => {
        const p = pan.current;
        if (!p || p.pointer !== e.pointerId) return;
        if (p.box) setBox({ a: p.world, b: worldPoint(e.clientX, e.clientY) });
        else
          workspace.set({
            camera: {
              ...p.camera,
              x: p.camera.x + e.clientX - p.start.x,
              y: p.camera.y + e.clientY - p.start.y,
            },
          });
      }}
      onPointerUp={(e) => {
        const p = pan.current;
        if (!p || p.pointer !== e.pointerId) return;
        const moved =
          Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) > 4;
        if (p.box && moved) {
          const b = worldPoint(e.clientX, e.clientY),
            left = Math.min(b.x, p.world.x),
            right = Math.max(b.x, p.world.x),
            top = Math.min(b.y, p.world.y),
            bottom = Math.max(b.y, p.world.y);
          workspace.selectNodes([
            ...p.ids,
            ...workspace
              .get()
              .project.nodes.filter(
                (n) =>
                  n.x < right &&
                  n.x + 200 > left &&
                  n.y < bottom &&
                  n.y + 110 > top,
              )
              .map((n) => n.id),
          ]);
        } else if (!moved && !p.box) workspace.select(null, false);
        endPan();
      }}
      onPointerCancel={(e) => {
        if (drag.current?.pointer === e.pointerId) finish(true);
        if (wire.current?.pointer === e.pointerId) cancelWire();
        if (pan.current?.pointer === e.pointerId) endPan(true);
      }}
      onLostPointerCapture={(e) => {
        if (pan.current?.pointer === e.pointerId) endPan(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-tds-component")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData("application/x-tds-component");
        if (!type) return;
        e.preventDefault();
        const p = worldPoint(e.clientX, e.clientY);
        workspace.add(type, p.x - 100, p.y - 50);
      }}
    >
      <div
        className="diagram-world"
        style={{
          transform: `translate(${s.camera.x}px,${s.camera.y}px) scale(${s.camera.zoom})`,
        }}
      >
        <svg className="diagram-edges">
          <defs>
            <marker
              id="tds-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" fill="currentColor" />
            </marker>
          </defs>
          {s.project.edges.map((edge) => {
            const a = s.project.nodes.find((n) => n.id === edge.source),
              b = s.project.nodes.find((n) => n.id === edge.target);
            if (!a || !b) return null;
            const pa = position(a),
              pb = position(b),
              d = curve(
                { x: pa.x + 200, y: pa.y + 52 },
                { x: pb.x, y: pb.y + 52 },
              ),
              rateValue = traffic.edgeRates[edge.id] ?? null,
              rate = fresh
                ? `${rateValue === null ? "rate unavailable" : fmt(rateValue, 1) + " req/s"}${edge.async ? " · async" : ""}`
                : edge.async
                  ? "async"
                  : "",
              visibleRate =
                fresh && rateValue !== null
                  ? `${fmt(rateValue, 1)}/s`
                  : edge.async
                    ? "async"
                    : "",
              label = visibleRate
                ? connectionRatePosition(
                    { x: pa.x + 200, y: pa.y + 52 },
                    { x: pb.x, y: pb.y + 52 },
                    visibleRate.length * 7 + 12,
                    s.project.nodes.map(position),
                    rateBoxes,
                  )
                : null;
            if (label) rateBoxes.push(label.rect);
            return (
              <g key={edge.id}>
                <path
                  d={d}
                  className={`diagram-edge ${s.selected?.kind === "edge" && s.selected.id === edge.id ? "is-selected" : ""}`}
                  markerEnd="url(#tds-arrow)"
                />
                <path
                  d={d}
                  className="diagram-edge-hit"
                  role="button"
                  tabIndex={0}
                  aria-label={`Connection ${a.label} to ${b.label}${rate ? ", " + rate : ""}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    cancelWire();
                    workspace.select({ kind: "edge", id: edge.id });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      workspace.select({ kind: "edge", id: edge.id });
                    }
                  }}
                />
                {rateValue !== null && rateValue > 0 && (
                  <path
                    d={d}
                    className={`diagram-flow ${s.playing ? "is-playing" : ""}`}
                  />
                )}
                {label && (
                  <text
                    x={label.x}
                    y={label.y}
                    className="diagram-rate"
                    aria-hidden="true"
                  >
                    {visibleRate}
                  </text>
                )}
              </g>
            );
          })}
          {wireView && sourceNode && (
            <path
              d={curve(
                { x: sourceNode.x + 200, y: sourceNode.y + 52 },
                wireView.target
                  ? s.project.nodes
                      .filter((n) => n.id === wireView.target)
                      .map((n) => ({ x: n.x, y: n.y + 52 }))[0] ||
                      wireView.point
                  : wireView.point,
              )}
              className={`connection-preview ${wireProblem ? "is-invalid" : ""}`}
              markerEnd="url(#tds-arrow)"
            />
          )}
        </svg>
        {s.project.nodes.map((n) => (
          <NodeView
            key={n.id}
            node={n}
            point={position(n)}
            selected={selected.includes(n.id)}
            source={wireView?.source === n.id}
            target={wireView?.target === n.id && !wireProblem}
            stats={frame?.nodes[n.id]}
            telemetry={fresh}
            arrivalRate={traffic.nodeRates[n.id] ?? null}
            onChoose={(e) => choose(n, e)}
            onStart={(e) => start(e, n)}
            onMove={move}
            onEnd={(e) => {
              if (drag.current?.pointer === e.pointerId) finish();
            }}
            onCancel={(e) => {
              if (drag.current?.pointer === e.pointerId) finish(true);
            }}
            onOutput={(e) => {
              if (e.button !== 0) return;
              if (
                drag.current ||
                pan.current ||
                wire.current?.pointer !== undefined
              )
                return;
              e.stopPropagation();
              e.preventDefault();
              e.currentTarget.focus();
              finish(true);
              startWire(n.id);
              const w = wire.current!;
              e.currentTarget.setPointerCapture(e.pointerId);
              setWire({
                ...w,
                host: e.currentTarget,
                pointer: e.pointerId,
                start: { x: e.clientX, y: e.clientY },
                moved: false,
              });
              workspace.setGesture(true);
            }}
            onWireMove={wireMove}
            onWireEnd={wireEnd}
            onWireLost={(e) => {
              if (wire.current?.pointer === e.pointerId) cancelWire();
            }}
            onKeyboardOutput={() => startWire(n.id)}
            onInput={() => {
              if (
                !drag.current &&
                !pan.current &&
                wire.current?.pointer === undefined
              )
                connectTo(n.id);
            }}
          />
        ))}
        {box && (
          <div
            className="selection-box"
            style={{
              left: Math.min(box.a.x, box.b.x),
              top: Math.min(box.a.y, box.b.y),
              width: Math.abs(box.a.x - box.b.x),
              height: Math.abs(box.a.y - box.b.y),
            }}
          />
        )}
      </div>
      {!s.project.nodes.length && (
        <div className="canvas-empty">
          <Network size={32} />
          <Text type="large" weight="semibold" as="h2">
            Build a system. See what happens.
          </Text>
          <Text>
            {browserHosted ? "Choose a preset below, or add and connect components from the library." : "Describe an architecture below, or add components from the library."}
          </Text>
        </div>
      )}
      <div className="canvas-caption" role="status">
        {wireView
          ? wireProblem || "Choose an input · drag to connect · Escape cancels"
          : "Drag nodes · Shift-click to select several · two-finger scroll to pan · pinch to zoom"}
        {s.run && !fresh ? " · Results belong to a previous revision" : ""}
      </div>
    </div>
  );
}
