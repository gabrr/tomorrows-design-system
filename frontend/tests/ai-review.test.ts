import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "../src/domain/types";
import {
  proposalSummaryGroups,
  reviewStatus,
  summarizeProposal,
} from "../src/domain/proposals";

const pending = {
  applied: false,
  generation: 4,
  currentGeneration: 4,
  isPending: true,
  isCurrent: true,
};

test("successful Apply remains applied history after revisions, newer generations and undo", () => {
  assert.equal(reviewStatus(pending), "pending");
  // Applying consumes the pending proposal and advances the workspace revision.
  const applied = {
    ...pending,
    applied: true,
    isPending: false,
    isCurrent: false,
    currentGeneration: 5,
  };
  assert.equal(reviewStatus(applied), "applied");
  assert.equal(reviewStatus({ ...applied, currentGeneration: 20 }), "applied");
  // Undo is a new revision; it does not erase the historical Apply command.
  assert.equal(reviewStatus({ ...applied, isCurrent: false }), "applied");
});

test("unapplied proposals are superseded independently by revision, generation or cancellation", () => {
  assert.equal(reviewStatus({ ...pending, isCurrent: false }), "superseded");
  assert.equal(
    reviewStatus({ ...pending, currentGeneration: 5 }),
    "superseded",
  );
  assert.equal(reviewStatus({ ...pending, isPending: false }), "superseded");
  // Matching project content again cannot restore a consumed pending reference.
  assert.equal(
    reviewStatus({ ...pending, isPending: false, isCurrent: true }),
    "superseded",
  );
});

const before: Project = {
  id: "p",
  name: "Review fixture",
  nodes: [],
  edges: [],
  scenario: { duration: 60, seed: 42, rps: 100, events: [] },
  monthly: { hours: 730, traffic_multiplier: 1 },
};

test("property changes are grouped separately from inventory without parsing human labels", () => {
  const original: Project = {
    ...before,
    nodes: [
      {
        id: "lb",
        label: "Components: traffic",
        type: "load_balancer",
        x: 0,
        y: 0,
        config: { health_check_delay: 3 },
      },
    ],
  };
  const proposed = structuredClone(original);
  proposed.nodes[0].config.health_check_delay = 1;
  const groups = proposalSummaryGroups(original, proposed);
  assert.deepEqual(groups.changes, [
    "Components: traffic · Health check delay: 3 s → 1 s.",
  ]);
  assert.deepEqual(groups.inventory, [
    "Components: 1 to update (Components: traffic).",
  ]);
  assert.deepEqual(summarizeProposal(original, proposed), [
    ...groups.inventory,
    ...groups.changes,
  ]);
  const removal = proposalSummaryGroups(original, before);
  assert.deepEqual(removal.changes, []);
  assert.deepEqual(removal.inventory, [
    "Components: 1 to remove (Components: traffic).",
  ]);
  assert.equal(original.nodes[0].config.health_check_delay, 3);
});

test("summary groups added defaults and detects changes to existing objects without mutating inputs", () => {
  const after: Project = {
    ...before,
    nodes: [
      {
        id: "cache",
        label: "Cache",
        type: "redis",
        x: 0,
        y: 0,
        config: Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`field_${i}`, i]),
        ),
      },
    ],
  };
  const original = JSON.stringify(after);
  assert.deepEqual(summarizeProposal(before, after), [
    "Components: 1 to add (Cache).",
    "Cache · 40 other proposed settings in the complete diff.",
  ]);
  const refined: Project = {
    ...after,
    nodes: [{ ...after.nodes[0], config: { latency_ms: 12 } }],
  };
  const summary = summarizeProposal(after, refined);
  assert.ok(summary.includes("Components: 1 to update (Cache)."));
  assert.ok(summary.includes("Cache · Service latency: unset → 12 ms."));
  assert.ok(
    summary.some((line) =>
      line.includes("additional property/assumption changes"),
    ),
  );
  assert.deepEqual(summarizeProposal(after, before), [
    "Components: 1 to remove (Cache).",
  ]);
  assert.equal(JSON.stringify(after), original);
});

test("summary retains connection, event, workload, monthly and name changes", () => {
  const after: Project = {
    ...before,
    name: "Proposed name",
    edges: [{ id: "link", source: "a", target: "b" }],
    scenario: {
      ...before.scenario,
      rps: 200,
      events: [
        {
          id: "traffic",
          type: "traffic",
          target: "global",
          time: 1,
          value: 300,
        },
      ],
    },
    monthly: { ...before.monthly, hours: 100 },
  };
  assert.deepEqual(summarizeProposal(before, after), [
    "Connections: 1 to add (a → b).",
    "Scenario events: 1 to add (traffic).",
    "Traffic global at 1 s → 300.",
    "Monthly hours: 730 hours/month → 100 hours/month.",
    "Connection a → b.",
    "Requests per second: 100 → 200.",
    "Project name: Review fixture → Proposed name.",
  ]);
  assert.deepEqual(summarizeProposal(before, before), [
    "No architecture, scenario or monthly assumption changes.",
  ]);
});

test("a compact review exposes the actual changed assumption without listing added defaults", () => {
  const original: Project = {
    ...before,
    nodes: [
      {
        id: "lb",
        label: "Load balancer",
        type: "load_balancer",
        x: 0,
        y: 0,
        config: { health_check_delay: 3 },
      },
    ],
  };
  const proposal = structuredClone(original);
  proposal.nodes[0].config.health_check_delay = 1;
  assert.ok(
    summarizeProposal(original, proposal).includes(
      "Load balancer · Health check delay: 3 s → 1 s.",
    ),
  );
});

test("review exposes routing, cost and added/removed settings beyond four changes", () => {
  const original: Project = {
    ...structuredClone(before),
    nodes: [
      {
        id: "api",
        label: "API",
        type: "api_service",
        x: 0,
        y: 0,
        config: {
          timeout: 4,
          capacity_rps: 100,
          latency_ms: 20,
          concurrency: 10,
          queue_limit: 50,
          hourly_cost: 0.1,
        },
      },
    ],
    edges: [{ id: "route", source: "a", target: "api", weight: 1 }],
  };
  const proposal = structuredClone(original);
  delete proposal.nodes[0].config.timeout;
  Object.assign(proposal.nodes[0].config, {
    new_timeout: 8,
    capacity_rps: 200,
    latency_ms: 15,
    concurrency: 20,
    queue_limit: 100,
    hourly_cost: 0.2,
  });
  proposal.edges[0].weight = 2;
  proposal.monthly.hours = 100;
  const summary = summarizeProposal(original, proposal).join("\n");
  for (const expected of [
    "Traffic weight: 1 → 2",
    "730 hours/month → 100 hours/month",
    "Timeout: 4 → unset",
    "New timeout: unset → 8",
    "0.1 USD/hour → 0.2 USD/hour",
  ])
    assert.ok(summary.includes(expected), expected);
});

test("new cache/AI costs and connection constraints are visible with omitted settings counted", () => {
  const proposed: Project = {
    ...structuredClone(before),
    nodes: [
      {
        id: "cache",
        label: "Cache",
        type: "cache",
        x: 0,
        y: 0,
        config: {
          capacity_rps: 100,
          latency_ms: 20,
          concurrency: 100,
          queue_limit: 1000,
          hourly_cost: 0.1,
          cache_hit_rate: 0.8,
          provider: "generic",
        },
      },
      {
        id: "ai",
        label: "AI",
        type: "ai_service",
        x: 260,
        y: 0,
        config: {
          input_tokens: 1000,
          output_tokens: 200,
          input_cost_per_million: 1,
          output_cost_per_million: 2,
        },
      },
    ],
    edges: [
      {
        id: "link",
        source: "cache",
        target: "ai",
        bandwidth_mbps: 100,
        payload_bytes: 1000,
        queue_limit: 10,
        egress_cost_per_gb: 0.09,
      },
    ],
  };
  const text = summarizeProposal(before, proposed).join("\n");
  for (const value of [
    "100 Mbps",
    "1000 bytes",
    "Queue limit 10",
    "0.09 USD/GB",
    "0.1 USD/hour",
    "0.8 fraction",
    "1000 input tokens/request",
    "2 USD/million output tokens",
    "3 other proposed settings",
  ])
    assert.ok(text.includes(value), value);
  const changed = structuredClone(proposed);
  changed.edges[0].bandwidth_mbps = 50;
  delete changed.edges[0].egress_cost_per_gb;
  const edit = summarizeProposal(proposed, changed).join("\n");
  assert.ok(edit.includes("Bandwidth: 100 Mbps → 50 Mbps"));
  assert.ok(edit.includes("Egress cost: 0.09 USD/GB → unset"));
});

test("endpoint and model identifier suffixes are never silently erased in review", () => {
  const first = "a".repeat(100) + "_first",
    second = "a".repeat(100) + "_second";
  const original: Project = {
    ...structuredClone(before),
    edges: [{ id: "route", source: "client", target: first }],
    nodes: [
      {
        id: "ai",
        type: "ai_service",
        label: "AI",
        x: 0,
        y: 0,
        config: { model: first },
      },
    ],
  };
  const proposal = structuredClone(original);
  proposal.edges[0].target = second;
  proposal.nodes[0].config.model = second;
  const summary = summarizeProposal(original, proposal).join("\n");
  assert.ok(summary.includes(`${first} → ${second}`));
  assert.ok(summary.includes(`Model: ${first} → ${second}`));
});

test("proposal summaries translate connection endpoints and delivery while complete IDs remain data", () => {
  const original = structuredClone(before);
  original.nodes = ["app_a", "shared_postgres"].map((id, i) => ({
    id,
    label: i ? "Shared PostgreSQL" : "App A",
    type: "api_service",
    x: i * 280,
    y: 0,
    config: { capacity_rps: 100, latency_ms: 10 },
  }));
  const next = structuredClone(original);
  next.edges.push({
    id: "app_a-postgres",
    source: "app_a",
    target: "shared_postgres",
    latency_ms: 5,
    weight: 1,
    async: false,
  });
  const summary = summarizeProposal(original, next).join("\n");
  assert.ok(
    summary.includes("Connections: 1 to add (App A → Shared PostgreSQL)"),
  );
  assert.ok(
    summary.includes(
      "Network latency 5 ms; Traffic weight 1; Delivery synchronous",
    ),
  );
  assert.equal(next.edges[0].id, "app_a-postgres");
  assert.ok(!summary.includes("Async false"));
});
