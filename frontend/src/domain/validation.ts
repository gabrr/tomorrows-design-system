import type {
  Event,
  NumericConstraint,
  NumericConstraints,
  NumericScope,
  Project,
} from "./types";
import { humanize } from "./evidence.js";

/** An explicit batch form retains incomplete text without committing it to a node. */
export function numericDraft(text: string, rule?: NumericConstraint) {
  if (!rule)
    return {
      value: undefined,
      error: "Field limits are unavailable. Reload the local app.",
    };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim()))
    return {
      value: undefined,
      error: "Enter a complete number using a decimal point.",
    };
  const value = Number(text);
  if (!Number.isFinite(value))
    return { value: undefined, error: "Enter a finite number." };
  if (rule.integer && !Number.isInteger(value))
    return { value: undefined, error: "Enter a whole number." };
  if (value < rule.min || value > rule.max)
    return {
      value: undefined,
      error: `Enter a value between ${rule.min.toLocaleString("en-US")} and ${rule.max.toLocaleString("en-US")}.`,
    };
  return { value, error: "" };
}

export function numericField(
  constraints: NumericConstraints | null,
  scope: NumericScope,
  name: string,
) {
  const rule = constraints?.[scope]?.[name];
  return {
    min: rule?.min,
    max: rule?.max,
    isIntegerOnly: rule?.integer,
    isDisabled: !rule,
    disabledMessage: !rule
      ? "Field limits are unavailable. Reload the local app."
      : undefined,
  };
}

export function eventNumericField(
  constraints: NumericConstraints | null,
  event: Event,
) {
  return event.type === "traffic"
    ? numericField(constraints, "scenario", "rps")
    : numericField(
        constraints,
        "node_config",
        event.type === "latency" ? "latency_ms" : event.field || "capacity_rps",
      );
}

// Changing an action must not leave an invisible missing value behind a
// visible numeric default, or carry fractional capacity into integer replicas.
export function initializeEventValue(
  event: Event,
  project: Project,
  constraints: NumericConstraints | null,
) {
  if (event.type === "fail" || event.type === "recover") {
    delete event.value;
    return;
  }
  const rule = eventNumericField(constraints, event);
  const field =
    event.type === "latency" ? "latency_ms" : event.field || "capacity_rps";
  const defaultValue =
    event.type === "traffic"
      ? project.scenario.rps
      : project.nodes.find((n) => n.id === event.target)?.config[field];
  let value =
    event.value ??
    (typeof defaultValue === "number" ? defaultValue : (rule.min ?? 0));
  if (rule.isIntegerOnly) value = Math.round(value);
  event.value = Math.max(
    rule.min ?? -Infinity,
    Math.min(rule.max ?? Infinity, value),
  );
}

export function validationMessage(
  message: string,
  project: Project,
  constraints: NumericConstraints | null,
) {
  const range = (scope: NumericScope, name: string) => {
    const rule = constraints?.[scope]?.[name];
    return rule
      ? `must be ${rule.integer ? "a whole number " : ""}between ${rule.min.toLocaleString("en-US")} and ${rule.max.toLocaleString("en-US")}`
      : "has an unsupported value";
  };
  return message
    .replace(
      /nodes\[(\d+)\]\.config\.([a-z_]+) is outside its supported numeric range/g,
      (_, index, name) =>
        `${project.nodes[Number(index)]?.label || "Component"}: ${humanize(name)} ${range("node_config", name)}`,
    )
    .replace(
      /nodes\[(\d+)\]\.config\.([a-z_]+)/g,
      (_, index, name) =>
        `${project.nodes[Number(index)]?.label || "Component"}: ${humanize(name)}`,
    )
    .replace(
      /edges\[(\d+)\]\.([a-z_]+) is outside its supported numeric range/g,
      (_, index, name) => {
        const edge = project.edges[Number(index)];
        const label = (id?: string) =>
          project.nodes.find((n) => n.id === id)?.label || "component";
        return `${label(edge?.source)} → ${label(edge?.target)}: ${humanize(name)} ${range("edge", name)}`;
      },
    )
    .replace(
      /scenario\.(duration|rps|seed)/g,
      (_, name) =>
        ({
          duration: "Experiment duration",
          rps: "Traffic (requests/second)",
          seed: "Random seed",
        })[name as "duration" | "rps" | "seed"],
    )
    .replace(
      /monthly\.([a-z_]+) is outside its supported numeric range/g,
      (_, name) => `${humanize(name)} ${range("monthly", name)}`,
    );
}
