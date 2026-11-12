import {
  Text,
  Card,
  Action,
  Disclosure,
  DataGrid,
  Message,
  Area,
} from "../../ui";
import { workspace, useWorkspace } from "../../workspace/store";
import {
  fmt,
  money,
  metricUnavailableReason,
  projectChanges,
  costRateEvidence,
} from "../../domain/evidence.js";
export function ResultsPanel() {
  const s = useWorkspace(),
    run = s.run;
  if (!run)
    return (
      <Text color="secondary">
        Run an experiment to see simulated latency, availability, costs and
        comparisons.
      </Text>
    );
  const reference = s.baseline || s.previous,
    label = s.baseline ? "baseline" : "previous",
    fresh = s.runRevision === s.revision,
    frame = run.frames[s.frame],
    evidenceProject = run.project_snapshot;
  const metrics: [string, string, (v: number) => string][] = [
    ["Availability", "availability", (v) => fmt(v * 100, 2) + "%"],
    ["p50 latency", "p50_ms", (v) => fmt(v) + " ms"],
    ["p95 latency", "p95_ms", (v) => fmt(v) + " ms"],
    ["p99 latency", "p99_ms", (v) => fmt(v) + " ms"],
    ["Experiment cost", "experiment_cost", money],
    ["Monthly estimate", "monthly_cost", money],
  ];
  return (
    <div className="stack results-panel">
      <Text type="label">Whole-run results · 0–{run.duration}s</Text>
      <div className="row spread">
        <Text type="label">
          {s.baseline ? "Pinned baseline" : "Comparison with last run"}
        </Text>
        <div className="row">
          <Action
            label="Pin this run as baseline"
            onClick={workspace.pinBaseline}
            disabled={s.baseline?.run_id === run.run_id && !!s.baseline}
          />
          {s.baseline && (
            <Action
              label="Compare with last run"
              onClick={workspace.clearBaseline}
            />
          )}
        </div>
      </div>
      {run.evidence_origin && (
        <Message
          text={run.evidence_origin + " · schema checked only; rerun locally."}
        />
      )}{" "}
      {s.baseline?.evidence_origin && (
        <Message text={"Baseline: " + s.baseline.evidence_origin} />
      )}{" "}
      {!fresh && (
        <Message text="Architecture changed. Results belong to the submitted earlier revision; run again for current graph telemetry." />
      )}
      <Text type="supporting">
        Model {run.model_version} · seed {run.seed} · {run.duration}s ·
        simulated estimates, not production measurements
      </Text>
      <div className="metric-grid">
        {metrics.map(([name, key, format]) => {
          const reason = metricUnavailableReason(run.summary, key),
            previousReason = reference
              ? metricUnavailableReason(reference.summary, key)
              : "";
          let delta = "No comparison run";
          if (reference)
            delta =
              reason || previousReason
                ? "Comparison unavailable: " + (reason || previousReason)
                : `${run.summary[key] - reference.summary[key] >= 0 ? "+" : ""}${key === "availability" ? fmt((run.summary[key] - reference.summary[key]) * 100, 2) + " pp" : key.includes("cost") ? money(run.summary[key] - reference.summary[key]) : fmt(run.summary[key] - reference.summary[key]) + " ms"} vs ${label}`;
          return (
            <Card
              key={key}
              padding={3}
              role="group"
              aria-label={name}
              data-metric-key={key}
            >
              <div className="stack small-gap">
                <Text type="supporting">{name}</Text>
                <Text type="large" weight="semibold" data-metric-value>
                  {reason ? "Unavailable" : format(run.summary[key])}
                </Text>
                {reason && <Text type="supporting">{reason}</Text>}
                <Text type="supporting">{delta}</Text>
              </div>
            </Card>
          );
        })}
      </div>
      <Text>
        {fmt(run.summary.requests, 0)} requests ·{" "}
        {fmt(run.summary.completed, 0)} completed · {fmt(run.summary.failed, 0)}{" "}
        failed · {fmt(run.summary.pending, 0)} pending
      </Text>
      <Text type="supporting">
        Background jobs: {fmt(run.summary.background_completed, 0)} completed ·{" "}
        {fmt(run.summary.background_failed, 0)} failed ·{" "}
        {fmt(run.summary.background_pending, 0)} pending
      </Text>
      {reference && (
        <Disclosure title="Comparison inputs and changed assumptions">
          <Text>
            Current: {run.project_snapshot.name}, {run.duration}s, seed{" "}
            {run.seed}. {s.baseline ? "Baseline" : "Previous"}:{" "}
            {(reference.project_snapshot || reference.project)?.name},{" "}
            {reference.duration}s, seed {reference.seed} ·{" "}
            {reference.evidence_origin || "local simulation"}.
          </Text>
          {projectChanges(
            reference.project_snapshot || reference.project,
            run.project_snapshot,
          ).map((change: string, i: number) => (
            <Text key={i}>{change}</Text>
          ))}
        </Disclosure>
      )}
      <Disclosure title="Costs and exact rate provenance">
        <DataGrid
          label="Simulated component costs"
          columns={[
            "Component",
            "Experiment · USD",
            "Monthly · USD",
            "Rate sources / assumptions",
          ]}
          rows={run.costs.map((c) => [
            c.label || c.id,
            money(c.experiment_cost),
            money(c.monthly_cost),
            costRateEvidence(c),
          ])}
        />
        <Text type="supporting">
          Monthly projections use submitted hours, traffic and provisioned
          resources. Discounts, tiering and taxes are excluded.
        </Text>
      </Disclosure>
      <Disclosure title="Assumptions and observed events">
        {run.assumptions.map((a, i) => (
          <Text key={"a" + i}>{a}</Text>
        ))}
        {run.events.map((e, i) => (
          <Text key={"e" + i}>
            {fmt(e.time)}s · {e.message || `${e.type}: ${e.target}`}
          </Text>
        ))}
      </Disclosure>
      <Disclosure title="Architecture list and exact frame telemetry">
        <Text>
          {frame
            ? `Selected ${fresh ? "frame" : "retained-run frame"}: ${frame.time}s`
            : "Current telemetry unavailable. Retained results belong to an earlier revision or external evidence."}
        </Text>
        <DataGrid
          label="Selected-frame foreground and background totals"
          columns={[
            "Workload",
            "Requests / jobs",
            "Completed",
            "Failed",
            "In flight / pending",
          ]}
          rows={[
            [
              "Foreground",
              frame ? String(frame.requests) : "Unavailable",
              frame ? String(frame.completed) : "Unavailable",
              frame ? String(frame.failed) : "Unavailable",
              frame ? String(frame.inflight) : "Unavailable",
            ],
            [
              "Background",
              frame ? String(frame.background_jobs ?? 0) : "Unavailable",
              frame ? String(frame.background_completed ?? 0) : "Unavailable",
              frame ? String(frame.background_failed ?? 0) : "Unavailable",
              frame ? String(frame.background_pending ?? 0) : "Unavailable",
            ],
          ]}
        />
        <DataGrid
          label="Components · selected-frame telemetry"
          columns={[
            "Component / ID",
            "Type / state",
            "Utilization",
            "Queue",
            "In flight",
            "Completed",
            "Failed",
          ]}
          rows={evidenceProject.nodes.map((n) => {
            const t = frame?.nodes[n.id];
            return [
              <Action
                key={n.id}
                label={`${n.label} (${n.id})`}
                variant="ghost"
                disabled={
                  !s.project.nodes.some((current) => current.id === n.id)
                }
                onClick={() => workspace.select({ kind: "node", id: n.id })}
              />,
              n.type + " / " + (t?.state ?? "Unavailable"),
              t ? fmt(t.utilization * 100) + "%" : "Unavailable",
              String(t?.queue_depth ?? "Unavailable"),
              String(t?.inflight ?? "Unavailable"),
              String(t?.completed ?? "Unavailable"),
              String(t?.failed ?? "Unavailable"),
            ];
          })}
        />
        <DataGrid
          label="Connections · endpoints, delivery and selected-frame telemetry"
          columns={[
            "Connection / ID",
            "Endpoints",
            "Delivery",
            "Latency / weight",
            "Requests",
            "Rate / second",
            "Delivered",
            "Failed",
            "In flight",
          ]}
          rows={evidenceProject.edges.map((e) => {
            const t = frame?.edges[e.id];
            return [
              <Action
                key={e.id}
                label={e.id}
                variant="ghost"
                disabled={
                  !s.project.edges.some((current) => current.id === e.id)
                }
                onClick={() => workspace.select({ kind: "edge", id: e.id })}
              />,
              `${evidenceProject.nodes.find((n) => n.id === e.source)?.label} → ${evidenceProject.nodes.find((n) => n.id === e.target)?.label}`,
              e.async ? "Asynchronous" : "Synchronous",
              `${e.latency_ms ?? 0} ms / ${e.weight ?? 1}`,
              String(t?.requests ?? "Unavailable"),
              String(t?.rps ?? "Unavailable"),
              String(t?.delivered ?? "Unavailable"),
              String(t?.failed ?? "Unavailable"),
              String(t?.inflight ?? "Unavailable"),
            ];
          })}
        />
      </Disclosure>
      <Disclosure title="Complete retained result JSON">
        <Area
          label="Complete retained result JSON"
          value={JSON.stringify(run, null, 2)}
          isReadOnly
          rows={8}
        />
      </Disclosure>
    </div>
  );
}
