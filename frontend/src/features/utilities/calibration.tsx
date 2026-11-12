import {
  checkCalibration,
  type Measurement,
  type Report,
} from "./calibration-logic";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../../domain/types";
import { clone, fmt, validateMeasurements } from "../../domain/evidence.js";
import { write } from "../../services/api";
import { useWorkspace, workspace } from "../../workspace/store";
import { Action, Area, DataGrid, FileInput, Message } from "../../ui";
import { Changes, errorText, guard, validateProposal } from "./review";
export function Calibration() {
  useWorkspace();
  const [session] = useState(() => ({
    fence: workspace.fence(),
    before: clone(workspace.get().project) as Project,
  }));
  const [text, setText] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Paste measurements or choose a JSON file."),
    [review, setReview] = useState<{
      proposal: Project;
      reports: Report[];
      warnings: string[];
      version: number;
    } | null>(null);
  const version = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
    };
  }, []);
  function invalidate() {
    version.current++;
    setReview(null);
  }
  async function readFile(value: File | File[] | null) {
    const selected = Array.isArray(value) ? value[0] : value;
    setFile(selected || null);
    invalidate();
    if (!selected) return;
    const token = version.current;
    setError("");
    try {
      if (selected.size > 2 * 1024 * 1024)
        throw new Error("Measurement JSON limit is 2 MB.");
      const contents = await selected.text();
      guard(session.fence, () => alive.current && token === version.current);
      setText(contents);
      setStatus("File loaded. Inspect JSON then request calibration.");
    } catch (e) {
      if (alive.current && token === version.current) setError(errorText(e));
    }
  }
  async function propose() {
    const token = ++version.current,
      current = () => alive.current && token === version.current;
    setReview(null);
    setBusy(true);
    setError("");
    try {
      guard(session.fence, current);
      if (text.length > 2 * 1024 * 1024)
        throw new Error("Measurement JSON limit is 2 MB.");
      const measurements = validateMeasurements(
        JSON.parse(text),
        session.before,
      ) as Measurement[];
      const data = await write("/api/calibration", {
        project: session.before,
        measurements,
      });
      guard(session.fence, current);
      await validateProposal(data.proposal, session.fence, current);
      guard(session.fence, current);
      checkCalibration(data.calibration, measurements);
      setReview({
        proposal: clone(data.proposal),
        reports: data.calibration,
        warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [],
        version: token,
      });
      setStatus(
        "Proposal ready. Review heldout evidence and changes before applying.",
      );
    } catch (e) {
      if (current()) setError("Calibration failed: " + errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const stale = !workspace.isCurrent(session.fence);
  return (
    <div className="utility-stack">
      <Message text="Supply node_id, identifiable source and 10–10,000 service-time samples_ms per component. Service time excludes network and queue time. Optional capacity_rps must be explicitly measured; it is never inferred from latency." />
      <p>
        Known targets:{" "}
        {session.before.nodes.map((n) => `${n.label} (${n.id})`).join(", ") ||
          "Add a component first."}
      </p>
      {stale && (
        <Message
          error
          text="Workspace changed. Reopen calibration to review the current revision."
        />
      )}
      <FileInput
        label="Measurement JSON file"
        value={file}
        onChange={(value) => {
          void readFile(value);
        }}
        accept=".json,application/json"
        maxSize={2 * 1024 * 1024}
      />
      <Area
        label="Measurement JSON"
        value={text}
        rows={9}
        onChange={(v) => {
          setText(v);
          invalidate();
          setStatus("Input changed. Request a fresh calibration review.");
        }}
      />
      <Message text={status} />
      {error && <Message error text={error} />}
      <Action
        label="Review calibration proposal"
        variant="primary"
        busy={busy}
        disabled={stale || !text.trim()}
        action={propose}
      />
      {review && (
        <section className="utility-review">
          <DataGrid
            label="Calibration source and heldout report"
            columns={[
              "Component / source",
              "Samples",
              "Measured service parameters",
            ]}
            rows={review.reports.map((r) => [
              <div>
                {session.before.nodes.find((n) => n.id === r.node_id)?.label} (
                {r.node_id})
                <p>
                  {r.source} · measured {r.measured_at || "Not supplied"}
                </p>
              </div>,
              `${r.sample_count} total · ${r.training_count} training / ${r.holdout_count} holdout`,
              `${fmt(r.service_mean_ms)} ms service mean · ${fmt(r.holdout_mean_absolute_error_ms)} ms heldout mean absolute error`,
            ])}
          />
          {review.warnings.map((w, i) => (
            <Message key={i} text={w} />
          ))}
          <Message text="This evidence covers supplied service samples and workload only. It does not establish production or whole-system accuracy. Unmeasured components remain illustrative." />
          <Changes before={session.before} after={review.proposal} />
          <div className="utility-actions">
            <Action label="Cancel calibration review" onClick={invalidate} />
            <Action
              label="Apply reviewed calibration"
              variant="primary"
              disabled={stale || busy}
              action={async () => {
                try {
                  guard(
                    session.fence,
                    () => alive.current && review.version === version.current,
                  );
                  workspace.apply(
                    review.proposal,
                    session.fence,
                    "Apply reviewed calibration",
                  );
                  invalidate();
                  workspace.set({ modal: null });
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            />
          </div>
        </section>
      )}
    </div>
  );
}
