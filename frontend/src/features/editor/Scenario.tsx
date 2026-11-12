import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Card,
  Text,
  Numeric,
  Select,
  Switch,
  Action,
  Disclosure,
  Message,
  Badge,
} from "../../ui";
import { workspace, useWorkspace } from "../../workspace/store";
import { clone, uid } from "../../domain/evidence.js";
import type { Event } from "../../domain/types";
import {
  numericField,
  eventNumericField,
  initializeEventValue,
} from "../../domain/validation";
function EventFields({
  event,
  onChange,
  onRemove,
}: {
  event: Event;
  onChange: (v: Event) => void;
  onRemove: () => void;
}) {
  const s = useWorkspace(),
    e = event,
    update = (fn: (e: Event) => void) => {
      const next = clone(e);
      fn(next);
      onChange(next);
    },
    mode = e.trigger ? "condition" : e.window ? "window" : "exact",
    nodeOptions = s.project.nodes.map((n) => ({ value: n.id, label: n.label }));
  return (
    <Card padding={3} className="event-form stack">
      <div className="row spread">
        <Badge label={e.type} />
        <Action
          label="Remove event"
          variant="ghost"
          icon={<Trash2 size={14} />}
          onClick={onRemove}
        />
      </div>
      <div className="two-columns">
        <Select
          label="Action"
          value={e.type}
          options={[
            { value: "fail", label: "Fail component" },
            { value: "recover", label: "Recover component" },
            { value: "traffic", label: "Change traffic" },
            { value: "latency", label: "Change latency" },
            { value: "scale", label: "Scale capacity" },
          ]}
          onChange={(v) =>
            update((next) => {
              next.type = v as Event["type"];
              if (v === "traffic") next.target = "global";
              else if (next.target === "global")
                next.target = s.project.nodes[0]?.id || "";
              if (v !== "scale") delete next.field;
              initializeEventValue(next, s.project, s.constraints);
            })
          }
          presentation="popover"
        />
        <Select
          label="Target"
          value={e.target}
          options={
            e.type === "traffic"
              ? [{ value: "global", label: "Global traffic" }]
              : nodeOptions
          }
          onChange={(v) =>
            update((n) => {
              n.target = v;
            })
          }
          presentation="popover"
        />
      </div>
      <Select
        label="When"
        value={mode}
        options={[
          { value: "exact", label: "Exact simulated time" },
          { value: "window", label: "Sample within a time window" },
          { value: "condition", label: "When a metric reaches a threshold" },
        ]}
        onChange={(v) =>
          update((n) => {
            delete n.time;
            delete n.window;
            delete n.trigger;
            if (v === "exact")
              n.time = Math.round(s.project.scenario.duration / 2);
            if (v === "window") n.window = [0, s.project.scenario.duration];
            if (v === "condition")
              n.trigger = {
                metric: "utilization",
                target: s.project.nodes[0]?.id || "",
                operator: "gte",
                value: 0.8,
              };
          })
        }
        presentation="popover"
      />
      {mode === "exact" && (
        <Numeric
          label="At second"
          value={e.time ?? 0}
          min={0}
          max={s.project.scenario.duration}
          onChange={(v) =>
            update((n) => {
              n.time = v;
            })
          }
          isWheelEnabled={false}
        />
      )}{" "}
      {mode === "condition" && e.trigger && (
        <>
          <Select
            label="Watch component"
            value={e.trigger.target}
            options={nodeOptions}
            onChange={(v) =>
              update((n) => {
                n.trigger!.target = v;
              })
            }
            presentation="popover"
          />
          <div className="two-columns">
            <Select
              label="Metric ≥"
              value={e.trigger.metric}
              options={[
                { value: "utilization", label: "Utilization (0–1)" },
                { value: "queue_depth", label: "Queue depth" },
                { value: "errors", label: "Errors" },
              ]}
              onChange={(v) =>
                update((n) => {
                  n.trigger!.metric = v;
                })
              }
              presentation="popover"
            />
            <Numeric
              label="Threshold"
              value={e.trigger.value}
              min={0}
              step={0.1}
              onChange={(v) =>
                update((n) => {
                  n.trigger!.value = v;
                })
              }
              isWheelEnabled={false}
            />
          </div>
          <Switch
            label="Limit condition to a time window"
            value={!!e.window}
            onChange={(v) =>
              update((n) => {
                if (v) n.window = [0, s.project.scenario.duration];
                else delete n.window;
              })
            }
          />
        </>
      )}
      {e.window && (
        <div className="two-columns">
          <Numeric
            label="Window starts · seconds"
            value={e.window[0]}
            min={0}
            max={s.project.scenario.duration}
            onChange={(v) =>
              update((n) => {
                n.window![0] = v;
              })
            }
            isWheelEnabled={false}
          />
          <Numeric
            label="Window ends · seconds"
            value={e.window[1]}
            min={0}
            max={s.project.scenario.duration}
            onChange={(v) =>
              update((n) => {
                n.window![1] = v;
              })
            }
            isWheelEnabled={false}
          />
        </div>
      )}
      {e.type === "scale" && (
        <Select
          label="Scale parameter"
          value={e.field || "capacity_rps"}
          options={[
            { value: "capacity_rps", label: "Capacity · requests / second" },
            { value: "concurrency", label: "Concurrent requests" },
            { value: "replicas", label: "Replicas" },
          ]}
          onChange={(v) =>
            update((n) => {
              n.field = v;
              initializeEventValue(n, s.project, s.constraints);
            })
          }
          presentation="popover"
        />
      )}
      {!["fail", "recover"].includes(e.type) && (
        <Numeric
          label={
            e.type === "traffic"
              ? "Traffic · requests / second"
              : e.type === "latency"
                ? "Latency · ms"
                : e.field === "replicas"
                  ? "Replicas"
                  : e.field === "concurrency"
                    ? "Concurrent requests"
                    : "Capacity · requests / second"
          }
          value={e.value ?? 0}
          {...eventNumericField(s.constraints, e)}
          onChange={(v) =>
            update((n) => {
              n.value = v;
            })
          }
          isWheelEnabled={false}
        />
      )}
    </Card>
  );
}
export function ScenarioPanel() {
  const s = useWorkspace(),
    editing = s.scenarioDraft !== null,
    events = s.scenarioDraft?.events || [],
    stale = !!s.scenarioDraft && !workspace.isCurrent(s.scenarioDraft.fence),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function begin() {
    workspace.beginScenarioDraft();
    setError("");
  }
  return (
    <div className="stack scenario-panel">
      <Text color="secondary">
        Simulated time, not wall-clock time. Defaults are illustrative.
      </Text>
      <div className="three-columns">
        <Numeric
          label="Duration · seconds"
          value={s.project.scenario.duration}
          {...numericField(s.constraints, "scenario", "duration")}
          onChange={(v) =>
            workspace.edit((p) => {
              p.scenario.duration = v;
            }, "Change duration")
          }
          isWheelEnabled={false}
        />
        <Numeric
          label="Traffic · requests / second"
          value={s.project.scenario.rps}
          {...numericField(s.constraints, "scenario", "rps")}
          onChange={(v) =>
            workspace.edit((p) => {
              p.scenario.rps = v;
            }, "Change traffic")
          }
          isWheelEnabled={false}
        />
        <Numeric
          label="Random seed"
          value={s.project.scenario.seed}
          {...numericField(s.constraints, "scenario", "seed")}
          onChange={(v) =>
            workspace.edit((p) => {
              p.scenario.seed = v;
            }, "Change seed")
          }
          isWheelEnabled={false}
        />
      </div>
      <div className="row spread">
        <Text type="label" weight="semibold" as="h2">
          Scenario events
        </Text>
        <Badge
          label={editing ? events.length : s.project.scenario.events.length}
        />
        {!editing && <Action label="Edit events" onClick={begin} />}
      </div>
      {!editing && (
        <>
          {s.project.scenario.events.map((e) => (
            <div key={e.id} className="event-summary">
              <Badge label={e.type} />
              <Text>
                {s.project.nodes.find((n) => n.id === e.target)?.label ||
                  e.target}{" "}
                ·{" "}
                {e.trigger
                  ? `${e.trigger.metric} ≥ ${e.trigger.value}`
                  : e.window
                    ? `${e.window[0]}–${e.window[1]}s`
                    : `${e.time ?? 0}s`}
              </Text>
            </div>
          ))}
          {!s.project.scenario.events.length && (
            <Text color="secondary">
              No events. Add a failure or workload change, or describe one to
              AI.
            </Text>
          )}
        </>
      )}
      {editing && (
        <>
          <Message text="Unsaved event draft. You can close this panel and return; Save applies it to the design. Reloading the page discards it." />
          {stale && (
            <>
              <Message
                error
                text="The design changed. This draft is preserved, but cannot be applied to a different revision. Restart from the current events or cancel."
              />
              <Action
                label="Restart from current events"
                onClick={begin}
                disabled={busy}
              />
            </>
          )}
          {events.map((event, i) => (
            <EventFields
              key={event.id}
              event={event}
              onChange={(v) =>
                workspace.editScenarioDraft((old) =>
                  old.map((e, j) => (j === i ? v : e)),
                )
              }
              onRemove={() =>
                workspace.editScenarioDraft((old) =>
                  old.filter((_, j) => j !== i),
                )
              }
            />
          ))}
          <Action
            label="Add event"
            icon={<Plus size={16} />}
            onClick={() =>
              workspace.editScenarioDraft((old) => [
                ...old,
                {
                  id: uid("event"),
                  type: "fail",
                  target: s.project.nodes[0]?.id || "",
                  time: Math.round(s.project.scenario.duration / 2),
                },
              ])
            }
          />
          {error && <Message text={error} error />}
          <div className="row">
            <Action
              label="Cancel scenario changes"
              onClick={() => {
                workspace.cancelScenarioDraft();
                setError("");
              }}
            />
            <Action
              label="Save scenario"
              variant="primary"
              busy={busy}
              disabled={stale || s.gestureActive}
              action={async () => {
                setBusy(true);
                setError("");
                try {
                  await workspace.saveScenarioDraft();
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
      <Disclosure title="Monthly cost assumptions">
        <div className="two-columns">
          <Numeric
            label="Operating hours per month"
            value={s.project.monthly.hours}
            {...numericField(s.constraints, "monthly", "hours")}
            onChange={(v) =>
              workspace.edit((p) => {
                p.monthly.hours = v;
              })
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
              })
            }
            isWheelEnabled={false}
          />
        </div>
        <Text>
          Excludes taxes, tiering and discounts. Missing rates are disclosed in
          results.
        </Text>
      </Disclosure>
    </div>
  );
}
