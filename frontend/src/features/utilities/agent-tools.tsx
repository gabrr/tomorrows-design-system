import { useState, useSyncExternalStore } from "react";
import { agentStatus } from "../../automation/status";
import { architectureReviews } from "../../automation/reviews";
import { workspace, useWorkspace } from "../../workspace/store";
import { projectChanges } from "../../domain/evidence.js";
import { Action, Area, Badge, DataGrid, Message, Text } from "../../ui";
import type { Project } from "../../domain/types";
export function AgentTools() {
  const status = useSyncExternalStore(agentStatus.subscribe, agentStatus.get);
  return (
    <div className="stack">
      <div className="row">
        <Badge
          label={
            status.state === "available"
              ? "Agent tools available"
              : status.state === "starting"
                ? "Starting agent tools"
                : "Agent tools unavailable"
          }
        />
      </div>
      <Text>
        Agents use the same editing, review, simulation and history commands as
        the visible controls. Compound changes require a validated review before
        Apply. Your design stays visible while tools run.
      </Text>
      {status.error && (
        <Message error={status.state === "failed"} text={status.error} />
      )}
      <Text>
        Tool outcomes verify commands and data. QA must still inspect the
        canvas, dialogs, keyboard focus, pointer interactions and layout.
      </Text>
      <DataGrid
        label="Recent agent actions"
        columns={["Action", "Outcome", "Time"]}
        rows={status.activity.map((a) => [
          a.label,
          a.ok ? "Completed" : "Did not complete",
          new Date(a.at).toLocaleTimeString(),
        ])}
      />
      <Text type="supporting">
        {status.tools.length} registered tools
        {status.transport ? " · " + status.transport : ""}. No AI requests,
        provider refreshes, factory execution, saved-project deletion or
        arbitrary file operations are exposed.
      </Text>
    </div>
  );
}
export function ArchitectureJSON() {
  const s = useWorkspace(),
    [text, setText] = useState(() => JSON.stringify(s.project, null, 2)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <Message text="Optional architecture JSON editing. Validate and review before applying. You can change several components, connections and scenario events together; the current project ID must stay the same." />
      <Area
        label="Architecture JSON"
        value={text}
        onChange={setText}
        rows={10}
        isDisabled={busy}
      />
      {error && <Message text={error} error />}
      <Action
        label="Validate and review architecture"
        busy={busy}
        action={async () => {
          setBusy(true);
          setError("");
          try {
            await architectureReviews.prepare(
              JSON.parse(text) as Project,
              workspace.fence(),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
export function ArchitectureReview() {
  const review = useSyncExternalStore(
      architectureReviews.subscribe,
      architectureReviews.get,
    ),
    s = useWorkspace(),
    [error, setError] = useState("");
  if (!review)
    return (
      <Message text="No pending architecture review. Prepare a new proposal." />
    );
  const current = workspace.isCurrent(review.fence),
    changes = projectChanges(review.before, review.proposal) as string[];
  return (
    <div className="stack">
      <Message text="These changes have passed the same backend validation used by the editor. They are still a proposal. Applying records one undo step and does not save or run implicitly." />
      {!current && (
        <Message
          error
          text="The design changed after this review was prepared. Cancel and prepare a fresh proposal."
        />
      )}
      <ul aria-label="Reviewed architecture changes">
        {changes.map((change, index) => (
          <li key={index}>{change}</li>
        ))}
      </ul>
      {changes.length === 0 && <Text>No architecture changes.</Text>}
      {error && <Message error text={error} />}
      <div className="row">
        <Action
          label="Cancel architecture review"
          onClick={() => {
            architectureReviews.cancel();
            workspace.set({ modal: null });
          }}
        />
        <Action
          label="Apply reviewed architecture"
          variant="primary"
          disabled={!current || s.gestureActive}
          onClick={() => {
            try {
              architectureReviews.apply(review.id, review.fence);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      </div>
    </div>
  );
}
