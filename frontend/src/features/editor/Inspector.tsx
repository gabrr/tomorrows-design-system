import { BulkInspector } from "./BulkInspector";
import { useState, useEffect } from "react";
import { X, Copy, Trash2 } from "lucide-react";
import {
  Card,
  Text,
  Input,
  Numeric,
  Select,
  Switch,
  Area,
  Action,
  IconAction,
  Disclosure,
  Message,
} from "../../ui";
import { workspace, useWorkspace } from "../../workspace/store";
import { humanize } from "../../domain/evidence.js";
import { write } from "../../services/api";
import type { Json } from "../../domain/types";
import { numericField } from "../../domain/validation";
function ConfigValue({
  nodeId,
  name,
  value,
}: {
  nodeId: string;
  name: string;
  value: Json;
}) {
  const { constraints } = useWorkspace();
  const rule = constraints?.node_config[name];
  const label =
    (
      {
        capacity_rps: "Capacity · requests / second",
        latency_ms: "Service latency · ms",
        hourly_cost: "Hourly price · USD",
        concurrency: "Concurrent requests",
        queue_limit: "Queue limit",
        provider: "Provider",
        region: "Region",
        model: "Model",
      } as Record<string, string>
    )[name] || humanize(name);
  const change = (v: Json) =>
    workspace.edit((p) => {
      const n = p.nodes.find((n) => n.id === nodeId);
      if (n) n.config[name] = v;
    }, "Edit " + label);
  if (typeof value === "boolean")
    return <Switch label={label} value={value} onChange={change} />;
  if (typeof value === "number")
    return (
      <Numeric
        label={label}
        value={value}
        onChange={change}
        {...numericField(constraints, "node_config", name)}
        description={
          name === "capacity_rps"
            ? "Minimum 0.001 requests/second. Use a failure event to stop a server."
            : name === "cache_hit_rate"
              ? "A fraction from 0 to 1."
              : rule?.integer
                ? "Whole numbers only."
                : undefined
        }
        step={
          ["concurrency", "queue_limit", "replicas"].includes(name) ? 1 : 0.01
        }
        isWheelEnabled={false}
      />
    );
  if (typeof value === "string")
    return <Input label={label} value={value} onChange={change} />;
  return null;
}
function Advanced({ kind, id }: { kind: "node" | "edge"; id: string }) {
  const s = useWorkspace(),
    value =
      kind === "node"
        ? s.project.nodes.find((n) => n.id === id)
        : s.project.edges.find((n) => n.id === id);
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <Disclosure title="Advanced JSON configuration">
      <Area
        label="Advanced component or connection JSON"
        value={text}
        onChange={setText}
        rows={8}
      />
      {error && <Message text={error} error />}
      <Action
        label="Validate and apply JSON"
        busy={busy}
        action={async () => {
          const f = workspace.fence();
          setBusy(true);
          setError("");
          try {
            const parsed = JSON.parse(text);
            if (parsed.id !== id)
              throw Error("Keep the component/connection ID.");
            const p = structuredClone(workspace.get().project);
            if (kind === "node")
              p.nodes[p.nodes.findIndex((n) => n.id === id)] = parsed;
            else p.edges[p.edges.findIndex((n) => n.id === id)] = parsed;
            const valid = await write("/api/validate", p);
            workspace.requireCurrent(f);
            if (!valid.valid) throw Error(valid.errors.join(" · "));
            workspace.apply(p, f, "Apply advanced configuration");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Disclosure>
  );
}
export function InspectorPanel() {
  const s = useWorkspace(),
    selection = s.selected,
    node = s.project.nodes.find(
      (n) => selection?.kind === "node" && n.id === selection.id,
    ),
    edge = s.project.edges.find(
      (n) => selection?.kind === "edge" && n.id === selection.id,
    ),
    frame =
      s.run && s.runRevision === s.revision ? s.run.frames[s.frame] : null,
    edgeStats = edge ? frame?.edges[edge.id] : null,
    entry = node ? s.catalog.find((c) => c.type === node.type) : null;
  return (
    <Card className="floating-panel inspector-panel" padding={4}>
      <div className="panel-heading">
        <Text
          id="inspector-heading"
          tabIndex={-1}
          type="label"
          weight="semibold"
          as="h2"
        >
          {selection?.kind === "nodes"
            ? `${selection.ids.length} components`
            : node
              ? "Component"
              : edge
                ? "Connection"
                : "System settings"}
        </Text>
        <IconAction
          label="Close inspector"
          icon={<X size={16} />}
          variant="ghost"
          onClick={() => workspace.set({ panel: null })}
        />
      </div>
      <div className="panel-scroll stack">
        {selection?.kind === "nodes" ? (
          <BulkInspector key={selection.ids.join("|")} ids={selection.ids} />
        ) : node ? (
          <>
            <Input
              label="Component name"
              value={node.label}
              onChange={(v) =>
                workspace.edit(
                  (p) => {
                    p.nodes.find((n) => n.id === node.id)!.label = v;
                  },
                  "Rename component",
                  "name:" + node.id,
                )
              }
            />
            <div className="two-columns">
              <Numeric
                label="Position X · canvas units"
                value={node.x}
                onChange={(v) =>
                  workspace.edit((p) => {
                    p.nodes.find((n) => n.id === node.id)!.x = v;
                  }, "Move component")
                }
                isWheelEnabled={false}
              />
              <Numeric
                label="Position Y · canvas units"
                value={node.y}
                onChange={(v) =>
                  workspace.edit((p) => {
                    p.nodes.find((n) => n.id === node.id)!.y = v;
                  }, "Move component")
                }
                isWheelEnabled={false}
              />
            </div>
            {Object.entries(node.config)
              .filter(([, v]) => v !== null && typeof v !== "object")
              .map(([key, value]) => (
                <ConfigValue
                  key={key}
                  nodeId={node.id}
                  name={key}
                  value={value}
                />
              ))}
            <Advanced key={node.id} kind="node" id={node.id} />
            <Disclosure title="Model assumptions and limitations">
              <Text>{entry?.model || "Generic service-station model"}</Text>
              {entry?.limitations.map((l, i) => (
                <Text key={i}>{l}</Text>
              ))}
            </Disclosure>
            <div className="stack">
              <Action
                label="Duplicate"
                icon={<Copy size={16} />}
                onClick={workspace.duplicateSelected}
              />
              <Action
                label="Delete component"
                variant="destructive"
                icon={<Trash2 size={16} />}
                onClick={workspace.removeSelected}
              />
            </div>
          </>
        ) : edge ? (
          <>
            {edgeStats && frame && (
              <Message
                text={`At ${frame.time}s: ${edgeStats.rps} requests/second · ${edgeStats.requests} requests routed so far.`}
              />
            )}
            <Select
              label="Source"
              value={edge.source}
              options={s.project.nodes.map((n) => ({
                value: n.id,
                label: n.label,
              }))}
              onChange={(v) =>
                workspace.edit((p) => {
                  p.edges.find((e) => e.id === edge.id)!.source = v;
                }, "Change source")
              }
              presentation="popover"
            />
            <Select
              label="Destination"
              value={edge.target}
              options={s.project.nodes.map((n) => ({
                value: n.id,
                label: n.label,
              }))}
              onChange={(v) =>
                workspace.edit((p) => {
                  p.edges.find((e) => e.id === edge.id)!.target = v;
                }, "Change destination")
              }
              presentation="popover"
            />
            <Numeric
              label="Network latency · ms"
              value={edge.latency_ms ?? 0}
              {...numericField(s.constraints, "edge", "latency_ms")}
              onChange={(v) =>
                workspace.edit((p) => {
                  p.edges.find((e) => e.id === edge.id)!.latency_ms = v;
                })
              }
              isWheelEnabled={false}
            />
            <Numeric
              label="Routing weight"
              value={edge.weight ?? 1}
              {...numericField(s.constraints, "edge", "weight")}
              onChange={(v) =>
                workspace.edit((p) => {
                  p.edges.find((e) => e.id === edge.id)!.weight = v;
                })
              }
              isWheelEnabled={false}
            />
            <Switch
              label="Asynchronous delivery"
              value={edge.async ?? false}
              onChange={(v) =>
                workspace.edit((p) => {
                  p.edges.find((e) => e.id === edge.id)!.async = v;
                })
              }
            />
            <Advanced key={edge.id} kind="edge" id={edge.id} />
            <Action
              label="Delete connection"
              variant="destructive"
              onClick={workspace.removeSelected}
            />
          </>
        ) : (
          <>
            <Text>
              Select a component or connection to configure it. All defaults are
              illustrative until measured.
            </Text>
            <Numeric
              label="Monthly operating hours"
              value={s.project.monthly.hours}
              {...numericField(s.constraints, "monthly", "hours")}
              onChange={(v) =>
                workspace.edit((p) => {
                  p.monthly.hours = v;
                }, "Change monthly hours")
              }
              isWheelEnabled={false}
            />
            <Numeric
              label="Monthly traffic multiplier"
              value={s.project.monthly.traffic_multiplier}
              {...numericField(s.constraints, "monthly", "traffic_multiplier")}
              step={0.1}
              onChange={(v) =>
                workspace.edit((p) => {
                  p.monthly.traffic_multiplier = v;
                }, "Change traffic projection")
              }
              isWheelEnabled={false}
            />
            <Text color="secondary">
              Prices and capacities are estimates. Cloud labels do not establish
              production accuracy.
            </Text>
          </>
        )}
      </div>
    </Card>
  );
}
