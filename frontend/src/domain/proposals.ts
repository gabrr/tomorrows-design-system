import type { Project } from "./types";
import { canonical, humanize } from "./evidence.js";

export type ReviewStatus = "pending" | "applied" | "superseded";

/** Applied is a recorded successful command, never inferred from model text or a fence. */
export function reviewStatus(input: {
  applied: boolean;
  generation: number;
  currentGeneration: number;
  isPending: boolean;
  isCurrent: boolean;
}): ReviewStatus {
  if (input.applied) return "applied";
  return input.isPending &&
    input.isCurrent &&
    input.generation === input.currentGeneration
    ? "pending"
    : "superseded";
}

/** Group complete objects by identity so added defaults do not become dozens of rows. */
export function summarizeProposal(before: Project, after: Project): string[] {
  const lines: string[] = [];
  function collection(
    label: string,
    old: { id: string; label?: string }[],
    next: { id: string; label?: string }[],
  ) {
    const previous = new Map(old.map((item) => [item.id, item]));
    const proposed = new Map(next.map((item) => [item.id, item]));
    const added = next.filter((item) => !previous.has(item.id));
    const removed = old.filter((item) => !proposed.has(item.id));
    const updated = next.filter(
      (item) =>
        previous.has(item.id) &&
        canonical(previous.get(item.id)) !== canonical(item),
    );
    const describe = (
      items: { id: string; label?: string }[],
      action: string,
    ) =>
      items.length
        ? `${items.length} to ${action} (${items
            .slice(0, 3)
            .map((item) => item.label || item.id)
            .join(", ")}${items.length > 3 ? ", …" : ""})`
        : "";
    const parts = [
      describe(added, "add"),
      describe(removed, "remove"),
      describe(updated, "update"),
    ].filter(Boolean);
    if (parts.length) lines.push(`${label}: ${parts.join("; ")}.`);
  }
  collection("Components", before.nodes, after.nodes);
  collection("Connections", before.edges, after.edges);
  collection("Scenario events", before.scenario.events, after.scenario.events);
  const changedEvents = after.scenario.events.filter((event) => {
    const old = before.scenario.events.find((item) => item.id === event.id);
    return !old || canonical(old) !== canonical(event);
  });
  for (const event of changedEvents.slice(0, 3)) {
    const target =
      after.nodes.find((node) => node.id === event.target)?.label ||
      event.target;
    const when = event.trigger
      ? `when ${humanize(event.trigger.metric)} ${event.trigger.operator} ${event.trigger.value}`
      : event.window
        ? `between ${event.window[0]}–${event.window[1]} s`
        : `at ${event.time} s`;
    lines.push(
      `${humanize(event.type)} ${target} ${when}${event.value === undefined ? "" : ` → ${event.value}`}.`,
    );
  }
  const details: string[] = [];
  const units: Record<string, string> = {
    capacity_rps: "req/s",
    latency_ms: "ms",
    health_check_delay: "s",
    hourly_cost: "USD/hour",
    hours: "hours/month",
    traffic_multiplier: "×",
    input_cost_per_million: "USD/million input tokens",
    output_cost_per_million: "USD/million output tokens",
    cost_per_request: "USD/request",
    request_cost_per_million: "USD/million requests",
    egress_cost_per_gb: "USD/GB",
    throughput_rps: "req/s",
    bandwidth_mbps: "Mbps",
    payload_bytes: "bytes",
    input_tokens: "input tokens/request",
    output_tokens: "output tokens/request",
    cache_hit_rate: "fraction",
  };
  const describe = (value: unknown, key: string) =>
    value === undefined
      ? "unset"
      : typeof value === "object"
        ? JSON.stringify(value).slice(0, 100)
        : `${String(value)}${units[key] ? " " + units[key] : ""}`;
  for (const key of ["hours", "traffic_multiplier"] as const)
    if (before.monthly[key] !== after.monthly[key])
      details.push(
        `Monthly ${humanize(key).toLowerCase()}: ${describe(before.monthly[key], key)} → ${describe(after.monthly[key], key)}.`,
      );
  for (const edge of after.edges) {
    const old = before.edges.find((item) => item.id === edge.id);
    const defaults: Record<string, unknown> = {
      weight: 1,
      latency_ms: 0,
      async: false,
    };
    if (!old) {
      const assumptions = Object.keys(edge).filter(
        (key) => !["id", "source", "target", "label"].includes(key),
      );
      details.push(
        `Connection ${edge.id} · ${edge.source} → ${edge.target}${assumptions.length ? "; " + assumptions.map((key) => `${humanize(key)} ${describe(edge[key], key)}`).join("; ") : ""}.`,
      );
      continue;
    }
    for (const key of new Set([...Object.keys(old), ...Object.keys(edge)])) {
      if (["id", "label"].includes(key)) continue;
      if (
        canonical(old[key] ?? defaults[key]) !==
        canonical(edge[key] ?? defaults[key])
      )
        details.push(
          `Connection ${edge.id} · ${humanize(key)}: ${describe(old[key] ?? defaults[key], key)} → ${describe(edge[key] ?? defaults[key], key)}.`,
        );
    }
  }
  const priority = [
    "health_check_delay",
    "capacity_rps",
    "latency_ms",
    "replicas",
    "concurrency",
    "queue_limit",
    "hourly_cost",
    "input_cost_per_million",
    "output_cost_per_million",
  ];
  for (const node of after.nodes) {
    const old = before.nodes.find((item) => item.id === node.id);
    if (!old) {
      const keys = Object.keys(node.config);
      const main = keys.filter(
        (key) =>
          [
            "capacity_rps",
            "latency_ms",
            "cache_hit_rate",
            "routing",
            "async_dispatch",
            "initial_state",
            "replicas",
            "model",
            "input_tokens",
            "output_tokens",
          ].includes(key) || key.includes("cost"),
      );
      const displayed = main.slice(0, 10);
      if (displayed.length)
        details.push(
          `${node.label} · proposed assumptions: ${displayed.map((key) => `${humanize(key)} ${describe(node.config[key], key)}`).join("; ")}.`,
        );
      const omitted = keys.length - displayed.length;
      if (omitted)
        details.push(
          `${node.label} · ${omitted} other proposed settings in the complete diff.`,
        );
      continue;
    }
    const keys = [
      ...new Set([...Object.keys(old.config), ...Object.keys(node.config)]),
    ].sort(
      (a, b) =>
        (priority.includes(a) ? priority.indexOf(a) : 100) -
        (priority.includes(b) ? priority.indexOf(b) : 100),
    );
    for (const key of keys) {
      if (canonical(old.config[key]) !== canonical(node.config[key]))
        details.push(
          `${node.label} · ${humanize(key)}: ${describe(old.config[key], key)} → ${describe(node.config[key], key)}.`,
        );
    }
  }
  lines.push(...details.slice(0, 10));
  if (details.length > 10)
    lines.push(
      `${details.length - 10} additional property/assumption changes: expand the complete diff before applying.`,
    );
  const { events: oldEvents, ...oldScenario } = before.scenario;
  const { events: nextEvents, ...nextScenario } = after.scenario;
  for (const key of ["rps", "duration", "seed"] as const)
    if (oldScenario[key] !== nextScenario[key])
      lines.push(
        `${humanize(key === "rps" ? "requests_per_second" : key)}: ${oldScenario[key]} → ${nextScenario[key]}.`,
      );

  if (before.name !== after.name)
    lines.push(`Project name: ${before.name} → ${after.name}.`);
  return lines.length
    ? lines
    : ["No architecture, scenario or monthly assumption changes."];
}
