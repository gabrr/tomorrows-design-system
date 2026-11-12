import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import {
  Text,
  Select,
  Numeric,
  Input,
  Action,
  Message,
  Disclosure,
} from "../../ui";
import { workspace, useWorkspace } from "../../workspace/store";
import { humanize } from "../../domain/evidence.js";
import type { Json } from "../../domain/types";
import { numericField } from "../../domain/validation";
export function BulkInspector({ ids }: { ids: string[] }) {
  const s = useWorkspace(),
    nodes = s.project.nodes.filter((n) => ids.includes(n.id));
  const common = nodes.length
    ? Object.keys(nodes[0].config).filter(
        (key) =>
          nodes.every(
            (n) =>
              Object.hasOwn(n.config, key) &&
              typeof n.config[key] === typeof nodes[0].config[key],
          ) &&
          ["number", "string", "boolean"].includes(typeof nodes[0].config[key]),
      )
    : [];
  const [chosenField, setField] = useState(() =>
    common.includes("capacity_rps") ? "capacity_rps" : common[0] || "",
  );
  const owned = s.bulkDraft;
  const sameGroup =
    !owned ||
    JSON.stringify([...new Set(ids)].sort()) === JSON.stringify(owned.ids);
  const pending = sameGroup ? owned : null;
  const field = pending?.field || chosenField;
  const shared = (key: string) =>
    nodes.length &&
    nodes.every((n) => Object.is(n.config[key], nodes[0].config[key]))
      ? nodes[0].config[key]
      : undefined;
  const draft = pending ? pending.value : shared(field);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = !pending || workspace.isCurrent(pending.fence),
    value = shared(field),
    type =
      pending && pending.value !== undefined
        ? typeof pending.value
        : typeof nodes[0]?.config[field];
  const edit = (next: Json | undefined) => {
    try {
      workspace.editBulkDraft(ids, field, next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reset = () => {
    workspace.cancelBulkDraft();
    setError("");
  };
  if (!sameGroup)
    return (
      <>
        <Message text="A pending property edit belongs to another selection. Recover or discard it before editing this group. Drafts are lost on page reload." />
        <Action
          label="Recover pending group edit"
          onClick={workspace.recoverBulkDraft}
        />
        <Action
          label="Discard pending group edit"
          onClick={workspace.cancelBulkDraft}
        />
      </>
    );
  const label =
    (
      {
        capacity_rps: "Capacity · requests / second",
        latency_ms: "Service latency · ms",
        hourly_cost: "Hourly price · USD",
        provider: "Provider",
        region: "Region",
        concurrency: "Concurrent requests",
        queue_limit: "Queue limit",
      } as Record<string, string>
    )[field] || humanize(field);
  return (
    <>
      <Text>{nodes.map((n) => n.label).join(", ")}</Text>
      <Text type="supporting">
        Apply changes this property on all {nodes.length} components.
      </Text>
      {pending && (
        <Text>
          Pending {humanize(field)}: {String(pending.value ?? "Choose a value")}
        </Text>
      )}
      {pending && !current && (
        <Message
          error
          text="The design changed or a target was deleted. Your typed value is retained; Reset discards it before editing the current design."
        />
      )}
      {pending && !common.length && (
        <Action label="Discard pending group edit" onClick={reset} />
      )}
      {!common.length ? (
        <Message text="These components have no editable properties of the same type. Inspect them separately." />
      ) : (
        <>
          <Select
            label="Shared property"
            value={field}
            options={common.map((key) => ({
              value: key,
              label: humanize(key),
            }))}
            onChange={(key) => {
              setField(key);
            }}
            presentation="popover"
            isDisabled={!!pending}
          />
          {value === undefined && (
            <Text type="supporting">
              Mixed values. Choose a new value to replace them on all{" "}
              {nodes.length} components.
            </Text>
          )}
          {type === "number" ? (
            <Numeric
              label={label}
              {...numericField(s.constraints, "node_config", field)}
              value={typeof draft === "number" ? draft : null}
              placeholder="Mixed values"
              step={
                ["concurrency", "queue_limit", "replicas"].includes(field)
                  ? 1
                  : 0.01
              }
              isWheelEnabled={false}
              isDisabled={!current || !s.constraints?.node_config[field]}
              onChange={edit}
            />
          ) : type === "boolean" ? (
            <Select
              label={label}
              value={typeof draft === "boolean" ? String(draft) : ""}
              placeholder="Mixed values"
              options={[
                { value: "true", label: "Enabled" },
                { value: "false", label: "Disabled" },
              ]}
              onChange={(v) => edit(v === "true")}
              isDisabled={!current}
              presentation="popover"
            />
          ) : (
            <Input
              label={label}
              value={typeof draft === "string" ? draft : ""}
              placeholder={value === undefined ? "Mixed values" : ""}
              onChange={edit}
              isDisabled={!current}
            />
          )}
          {error && <Message text={error} error />}
          <div className="stack">
            <Action label="Reset group edit" onClick={reset} />
            <Action
              label={`Apply to ${nodes.length} components`}
              variant="primary"
              busy={busy}
              disabled={
                !pending ||
                !current ||
                draft === undefined ||
                s.gestureActive ||
                (value !== undefined && Object.is(value, draft))
              }
              action={async () => {
                setBusy(true);
                setError("");
                try {
                  if (draft === undefined) return;
                  await workspace.applyBulkDraft();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        </>
      )}
      <div className="stack">
        <Action
          label="Duplicate selection"
          icon={<Copy size={16} />}
          onClick={workspace.duplicateSelected}
          disabled={busy || s.gestureActive}
        />
        <Action
          label="Delete selection"
          variant="destructive"
          icon={<Trash2 size={16} />}
          onClick={workspace.removeSelected}
          disabled={busy || s.gestureActive}
        />
      </div>
      <Disclosure title="Group editing help">
        <Text>
          Shift-click to change the selection; drag a selected component to move
          the group.
        </Text>
        <Text>
          Drafts survive panel navigation until page reload. Reset discards the
          pending value.
        </Text>
        <Text>
          Duplicate keeps internal connections and leaves events on originals.
          Delete removes attached connections and events. Undo restores the
          complete change.
        </Text>
      </Disclosure>
    </>
  );
}
