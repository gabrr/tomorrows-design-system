// Runtime evidence invariants extracted from the previously verified implementation.
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const uid = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const configLabels = {
  capacity_rps: "Capacity · requests / second",
  concurrency: "Concurrent requests",
  latency_ms: "Service latency · ms",
  queue_limit: "Queue limit",
  hourly_cost: "Hourly price · USD",
  provider: "Provider",
  region: "Region",
  input_tokens: "Input tokens / request",
  output_tokens: "Output tokens / request",
  input_tokens_per_request: "Input tokens / request",
  output_tokens_per_request: "Output tokens / request",
  input_cost_per_million: "Input price / million tokens",
  output_cost_per_million: "Output price / million tokens",
  cache_hit_ratio: "Cache hit ratio",
  hit_rate: "Cache hit ratio",
  model: "Model",
  tokens_per_second: "Tokens / second",
  replicas: "Replicas",
  failure_rate: "Failure probability",
  routing: "Routing strategy",
  timeout_ms: "Timeout · ms",
};
export function checkProject(p) {
  if (
    !p ||
    typeof p !== "object" ||
    !Array.isArray(p.nodes) ||
    !Array.isArray(p.edges) ||
    !p.scenario ||
    !Array.isArray(p.scenario.events)
  )
    throw new Error(
      "Project needs nodes, edges, and a scenario with an events array.",
    );
  if (p.nodes.length > 1000 || p.edges.length > 5000)
    throw new Error("Project is too large to edit safely.");
  const ids = new Set();
  for (const n of p.nodes) {
    if (
      !n ||
      typeof n.id !== "string" ||
      ids.has(n.id) ||
      typeof n.type !== "string" ||
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y) ||
      !n.config ||
      typeof n.config !== "object"
    )
      throw new Error(
        "Each node needs a unique ID, type, coordinates and config.",
      );
    ids.add(n.id);
  }
  const edgeIds = new Set();
  for (const e of p.edges) {
    if (
      !e ||
      typeof e.id !== "string" ||
      edgeIds.has(e.id) ||
      !ids.has(e.source) ||
      !ids.has(e.target)
    )
      throw new Error(
        "Connections must have unique IDs and valid node endpoints.",
      );
    edgeIds.add(e.id);
  }
  if (
    !Number.isFinite(p.scenario.duration) ||
    p.scenario.duration <= 0 ||
    !Number.isFinite(p.scenario.rps) ||
    p.scenario.rps < 0 ||
    !Number.isInteger(p.scenario.seed)
  )
    throw new Error(
      "Scenario needs positive duration, nonnegative traffic and an integer seed.",
    );
  if (
    p.scenario.events.some((e) => !e || typeof e.id !== "string") ||
    new Set(p.scenario.events.map((e) => e.id)).size !==
      p.scenario.events.length
  )
    throw new Error("Events require unique string IDs.");
  return p;
}

export function humanize(s) {
  return s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

export function fmt(n, d = 1) {
  return typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: d })
    : "Unavailable";
}

export function money(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "Unavailable";
  const magnitude = Math.abs(n);
  if (magnitude > 0 && magnitude < 1e-6) return n.toExponential(3) + " USD";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: magnitude < 0.01 ? 6 : 2,
  }).format(n);
}

export function describeValue(value, key = "") {
  if (value === undefined || value === null) return "Not supplied";
  if (typeof value === "object") return JSON.stringify(value);
  const units = {
    capacity_rps: " req/s",
    latency_ms: " ms",
    concurrency: " concurrent requests",
    queue_limit: " queued requests",
    hourly_cost: " USD/hour",
    cost_per_request: " USD/request",
    input_cost_per_million: " USD/million input tokens",
    output_cost_per_million: " USD/million output tokens",
    duration: " s",
    rps: " req/s",
    hours: " hours",
    time: " s",
  };
  return String(value) + (units[key] || "");
}

export function architecture(p) {
  return {
    id: p.id,
    nodes: p.nodes,
    edges: p.edges,
    scenario: p.scenario,
    monthly: p.monthly,
  };
}

export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export function nearestFrame(time, frames) {
  return frames.reduce(
    (best, frame, i) =>
      Math.abs(frame.time - time) < Math.abs(frames[best].time - time)
        ? i
        : best,
    0,
  );
}

export function validateMeasurements(value, project) {
  const records = Array.isArray(value) ? value : value?.measurements;
  if (!Array.isArray(records) || !records.length || records.length > 100)
    throw new Error(
      "Supply an array of 1–100 measurement records, or {measurements:[…]}.",
    );
  const ids = new Set(project.nodes.map((n) => n.id)),
    seen = new Set();
  for (const [i, r] of records.entries()) {
    const prefix = `Measurement ${i + 1}: `;
    if (!r || !ids.has(r.node_id) || seen.has(r.node_id))
      throw new Error(prefix + "choose a known, unique node_id.");
    seen.add(r.node_id);
    if (
      typeof r.source !== "string" ||
      !r.source.trim() ||
      r.source.length > 2000
    )
      throw new Error(prefix + "source is required (up to 2,000 characters).");
    if (
      !Array.isArray(r.samples_ms) ||
      r.samples_ms.length < 10 ||
      r.samples_ms.length > 10000 ||
      r.samples_ms.some(
        (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
      )
    )
      throw new Error(
        prefix +
          "provide 10–10,000 finite nonnegative service-time samples in ms.",
      );
    if (
      "capacity_rps" in r &&
      (typeof r.capacity_rps !== "number" ||
        !Number.isFinite(r.capacity_rps) ||
        r.capacity_rps <= 0)
    )
      throw new Error(prefix + "measured capacity_rps must be positive.");
    if ("measured_at" in r && typeof r.measured_at !== "string")
      throw new Error(prefix + "measured_at must be a string.");
  }
  return records;
}

export function priceText(r) {
  const units = {
    hourly_cost: "hour",
    input_per_million: "million input tokens",
    output_per_million: "million output tokens",
    request_cost: "request",
    price: r.unit || "unknown unit",
  };
  return (
    [
      "hourly_cost",
      "input_per_million",
      "output_per_million",
      "request_cost",
      "price",
    ]
      .filter((k) => r[k] != null)
      .map(
        (k) =>
          `${humanize(k)}: ${r[k]} ${r.currency || "currency unknown"} / ${units[k]}`,
      )
      .join("\n") + `\nPublished unit: ${r.unit || "Not supplied"}`
  );
}

export function costRateEvidence(cost) {
  if (cost.rate_sources && typeof cost.rate_sources === "object") {
    const rows = Object.entries(cost.rate_sources)
      .filter(([, rate]) => rate?.value != null)
      .map(
        ([key, rate]) =>
          `${humanize(key)}: ${describeValue(rate.value, key)} · ${rate.kind || "Unverified source"}${rate.source ? " · " + rate.source : ""}${rate.retrieved_at ? " · retrieved " + rate.retrieved_at : ""}`,
      );
    if (cost.defaulted_rates?.length)
      rows.push(
        "Illustrative defaults: " +
          cost.defaulted_rates.map(humanize).join(", "),
      );
    if (rows.length) return rows.join("\n");
  }
  return (
    (cost.provenance_summary ||
      "Per-rate source verification unavailable; rates are estimates.") +
    "\nRecorded metadata: " +
    (typeof cost.provenance === "string"
      ? cost.provenance
      : JSON.stringify(cost.provenance || "Not supplied"))
  );
}
// Engine defaults for empty samples remain intact; presentation requires observations.

export function metricUnavailableReason(summary, key) {
  if (key === "availability" && !(summary.requests > 0))
    return "No observations: no requests";
  if (["p50_ms", "p95_ms", "p99_ms"].includes(key) && !(summary.completed > 0))
    return "No observations: no completed requests";
  if (typeof summary[key] !== "number" || !Number.isFinite(summary[key]))
    return "Metric not supplied";
  return "";
}

export function projectChanges(before, after) {
  const changes = [];
  const diff = (a, b, path) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
      const av = a?.[key],
        bv = b?.[key];
      if (canonical(av) === canonical(bv)) continue;
      if (
        (av === undefined ||
          (av && typeof av === "object" && !Array.isArray(av))) &&
        bv &&
        typeof bv === "object" &&
        !Array.isArray(bv)
      )
        diff(av || {}, bv, `${path} · ${humanize(key)}`);
      else
        changes.push(
          `${path} · ${configLabels[key] || humanize(key)}: ${describeValue(av, key)} → ${describeValue(bv, key)}`,
        );
    }
  };
  for (const [key, label] of [
    ["nodes", "Component"],
    ["edges", "Connection"],
  ]) {
    const old = new Map(before[key].map((n) => [n.id, n])),
      next = new Map(after[key].map((n) => [n.id, n]));
    for (const [id, n] of old)
      if (!next.has(id))
        changes.push(
          `Removed ${label.toLowerCase()}: ${n.label || id} (${id})`,
        );
    for (const [id, n] of next) {
      const path = `${label} ${n.label || id} (${id})`;
      if (!old.has(id)) {
        changes.push(`Added ${path.toLowerCase()}`);
        diff({}, n, path);
      } else diff(old.get(id), n, path);
    }
  }
  const eventText = (e) => {
    if (!e) return "Absent";
    const target =
      after.nodes.find((n) => n.id === e.target)?.label ||
      before.nodes.find((n) => n.id === e.target)?.label ||
      e.target;
    const timing = e.trigger
      ? `when ${e.trigger.metric} ${e.trigger.operator || "gte"} ${e.trigger.value} on ${e.trigger.target}${e.window ? ` within ${e.window[0]}–${e.window[1]}s` : ""}`
      : e.window
        ? `sampled within ${e.window[0]}–${e.window[1]}s`
        : `at ${e.time ?? 0}s`;
    const unit =
      e.type === "latency"
        ? " ms"
        : e.type === "traffic" ||
            (e.type === "scale" && (!e.field || e.field === "capacity_rps"))
          ? " req/s"
          : e.field === "replicas"
            ? " replicas"
            : e.field === "concurrency"
              ? " concurrent requests"
              : "";
    return `${humanize(e.type)} ${target} (${e.target}) · ${timing}${["fail", "recover"].includes(e.type) ? "" : ` · ${e.value}${unit}`}`;
  };
  const oldEvents = new Map(before.scenario.events.map((e) => [e.id, e])),
    nextEvents = new Map(after.scenario.events.map((e) => [e.id, e]));
  for (const id of new Set([...oldEvents.keys(), ...nextEvents.keys()]))
    if (canonical(oldEvents.get(id)) !== canonical(nextEvents.get(id)))
      changes.push(
        `Event ${id}: ${eventText(oldEvents.get(id))} → ${eventText(nextEvents.get(id))}`,
      );
  const { events: oldIgnored, ...oldScenario } = before.scenario,
    { events: newIgnored, ...newScenario } = after.scenario;
  diff(oldScenario, newScenario, "Scenario");
  diff(before.monthly, after.monthly, "Monthly assumptions");
  if (before.name !== after.name)
    changes.push(`Project name: ${before.name} → ${after.name}`);
  return changes;
}

export function validateResult(result, snapshot) {
  checkProject(snapshot);
  const fail = (message) => {
    throw new Error("Result evidence: " + message);
  };
  const finite = (v, label, min = 0) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min)
      fail(label + " must be a finite number ≥ " + min);
  };
  if (
    !result ||
    typeof result !== "object" ||
    !result.summary ||
    !Array.isArray(result.frames) ||
    !result.frames.length ||
    result.frames.length > 10000
  )
    fail("nonempty frames and summary are required (up to 10,000 frames).");
  if (typeof result.model_version !== "string" || !result.model_version.trim())
    fail("model version is required.");
  if (
    result.seed !== snapshot.scenario.seed ||
    result.duration !== snapshot.scenario.duration
  )
    fail("seed/duration must match the submitted architecture snapshot.");
  const embedded = result.project_snapshot || result.project;
  if (
    !embedded ||
    [result.project_snapshot, result.project]
      .filter(Boolean)
      .some(
        (p) => canonical(architecture(p)) !== canonical(architecture(snapshot)),
      )
  )
    fail("matching embedded architecture snapshot is required.");
  const summary = result.summary;
  if (Array.isArray(summary)) fail("summary must be an object.");
  for (const [key, value] of Object.entries(summary))
    finite(value, "summary." + key);
  for (const key of [
    "requests",
    "completed",
    "failed",
    "pending",
    "availability",
    "p50_ms",
    "p95_ms",
    "p99_ms",
    "experiment_cost",
    "monthly_cost",
  ])
    finite(summary[key], "summary." + key);
  if (
    Math.abs(
      summary.availability -
        (summary.requests ? summary.completed / summary.requests : 1),
    ) > 1e-10
  )
    fail("availability contradicts foreground completion counts.");
  if (summary.availability > 1)
    fail("availability must be a ratio from 0 to 1.");
  if (summary.p50_ms > summary.p95_ms || summary.p95_ms > summary.p99_ms)
    fail("latency percentiles must be ordered.");
  const conserve = (row, pending, label) => {
    for (const key of ["requests", "completed", "failed", pending]) {
      finite(row[key], label + "." + key);
      if (!Number.isInteger(row[key]))
        fail(label + "." + key + " must be an integer count.");
    }
    if (row.requests !== row.completed + row.failed + row[pending])
      fail(label + " foreground request conservation failed.");
  };
  conserve(summary, "pending", "summary");
  const background = (row, label) => {
    if (
      [
        "background_jobs",
        "background_completed",
        "background_failed",
        "background_pending",
      ].some((k) => k in row)
    ) {
      for (const key of [
        "background_jobs",
        "background_completed",
        "background_failed",
        "background_pending",
      ]) {
        finite(row[key], label + "." + key);
        if (!Number.isInteger(row[key]))
          fail(label + "." + key + " must be an integer.");
      }
      if (
        row.background_jobs !==
        row.background_completed +
          row.background_failed +
          row.background_pending
      )
        fail(label + " background conservation failed.");
    }
  };
  background(summary, "summary");
  function numbers(value, label) {
    if (typeof value === "number" && !Number.isFinite(value))
      fail(label + " contains a nonfinite number.");
    if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) numbers(v, label + "." + k);
  }
  numbers(result, "result");
  const nodes = new Set(snapshot.nodes.map((n) => n.id)),
    edges = new Set(snapshot.edges.map((e) => e.id));
  let last = -1;
  let prior = null;
  for (const [index, frame] of result.frames.entries()) {
    finite(frame.time, `frames[${index}].time`);
    if (frame.time <= last || frame.time > result.duration)
      fail("frame times must increase within duration.");
    last = frame.time;
    if (index === 0 && frame.time !== 0)
      fail("first frame must start at time zero.");
    conserve(frame, "inflight", `frames[${index}]`);
    background(frame, `frames[${index}]`);
    if (
      prior &&
      [
        "requests",
        "completed",
        "failed",
        "background_jobs",
        "background_completed",
        "background_failed",
      ].some((k) => k in frame && k in prior && frame[k] < prior[k])
    )
      fail("cumulative foreground counts must not decrease.");
    prior = frame;
    if (
      !frame.nodes ||
      typeof frame.nodes !== "object" ||
      Array.isArray(frame.nodes) ||
      !frame.edges ||
      typeof frame.edges !== "object" ||
      Array.isArray(frame.edges)
    )
      fail("each frame needs node and connection telemetry.");
    if (
      Object.keys(frame.nodes).some((id) => !nodes.has(id)) ||
      [...nodes].some((id) => !frame.nodes[id]) ||
      Object.keys(frame.edges).some((id) => !edges.has(id)) ||
      [...edges].some((id) => !frame.edges[id])
    )
      fail("frame telemetry must match architecture IDs.");
    for (const [id, stats] of Object.entries(frame.nodes)) {
      if (!stats || typeof stats !== "object")
        fail("invalid node telemetry " + id);
      for (const key of [
        "utilization",
        "queue_depth",
        "inflight",
        "completed",
        "failed",
      ])
        finite(stats[key], id + "." + key);
      for (const [key, value] of Object.entries(stats))
        if (key !== "state") finite(value, id + "." + key);
      for (const key of [
        "queue_depth",
        "inflight",
        "received",
        "started",
        "completed",
        "failed",
        "cache_hits",
        "cache_misses",
        "replicas",
      ])
        if (key in stats && !Number.isInteger(stats[key]))
          fail(id + "." + key + " must be an integer count.");
      if (typeof stats.state !== "string") fail("node state must be text.");
    }
    for (const [id, stats] of Object.entries(frame.edges)) {
      if (!stats || typeof stats !== "object")
        fail("invalid connection telemetry " + id);
      for (const key of ["requests", "rps"]) finite(stats[key], id + "." + key);
      for (const [key, value] of Object.entries(stats))
        finite(value, id + "." + key);
      for (const key of ["requests", "delivered", "failed", "inflight"])
        if (key in stats && !Number.isInteger(stats[key]))
          fail(id + "." + key + " must be an integer count.");
      if (
        ["delivered", "failed", "inflight"].every((k) => k in stats) &&
        stats.requests !== stats.delivered + stats.failed + stats.inflight
      )
        fail("connection conservation failed for " + id);
    }
  }
  for (const key of ["costs", "events", "assumptions"])
    if (!Array.isArray(result[key])) fail(key + " must be an array.");
  for (const [index, cost] of (result.costs || []).entries()) {
    if (
      !cost ||
      typeof cost !== "object" ||
      (!nodes.has(cost.id) && !edges.has(cost.id))
    )
      fail("cost row " + index + " has an unknown component/connection.");
    finite(cost.experiment_cost, "cost.experiment_cost");
    finite(cost.monthly_cost, "cost.monthly_cost");
  }
  {
    for (const key of ["experiment_cost", "monthly_cost"])
      if (
        Math.abs(
          result.costs.reduce((sum, c) => sum + c[key], 0) - summary[key],
        ) >
        1e-8 * Math.max(1, summary[key])
      )
        fail("cost total contradicts summary." + key);
  }
  if ((result.assumptions || []).some((a) => typeof a !== "string"))
    fail("assumptions must contain readable text.");
  for (const event of result.events || []) {
    if (!event || typeof event !== "object" || typeof event.type !== "string")
      fail("observed events must be objects with an action type.");
    finite(event.time, "event.time");
    if (event.time > result.duration)
      fail("observed event falls outside duration.");
    if (
      !["fail", "recover", "traffic", "latency", "scale"].includes(
        event.type,
      ) ||
      (event.type === "traffic"
        ? event.target !== "global"
        : !nodes.has(event.target))
    )
      fail("observed event has an unsupported action or unknown target.");
  }
  const final = result.frames.at(-1);
  if (
    final.time !== result.duration ||
    ["requests", "completed", "failed"].some((k) => final[k] !== summary[k]) ||
    final.inflight !== summary.pending
  )
    fail("final frame must match duration and summary counts.");
  for (const key of [
    "background_jobs",
    "background_completed",
    "background_failed",
    "background_pending",
  ])
    if ((key in final || key in summary) && final[key] !== summary[key])
      fail("final frame contradicts summary." + key);
  return result;
}

export function priceReason(record) {
  if (record.currency !== "USD")
    return "Unavailable: explicit USD currency required.";
  const fields = [
    "hourly_cost",
    "input_per_million",
    "output_per_million",
    "request_cost",
  ].filter((k) => k in record);
  if (!fields.length)
    return "Unavailable: no supported hourly, request or token rate mapping.";
  if (
    fields.some(
      (k) =>
        typeof record[k] !== "number" ||
        !Number.isFinite(record[k]) ||
        record[k] < 0,
    )
  )
    return "Unavailable: rate must be a finite nonnegative number.";
  if (
    "hourly_cost" in record &&
    !["instance-hour", "hour", "1 Hour", "Hrs"].includes(record.unit)
  )
    return "Unavailable: billing unit conflicts with USD/hour.";
  if (
    fields.some((k) => k.includes("per_million")) &&
    record.unit !== "USD / million tokens"
  )
    return "Unavailable: token unit must be USD / million tokens.";
  if (
    "request_cost" in record &&
    !["request", "USD / request"].includes(record.unit) &&
    !(
      record.unit === "USD / million tokens" &&
      fields.some((k) => k.includes("per_million"))
    )
  )
    return "Unavailable: request billing unit is unsupported.";
  if (typeof record.id !== "string" || typeof record.provider !== "string")
    return "Unavailable: record identity missing.";
  return "";
}
