import { useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import { Action, Badge, DataGrid, Disclosure, Message } from "../../ui";
import { errorText } from "./review";
type Task = {
  id: string;
  role?: string;
  actor?: string;
  state?: string;
  attempts?: number;
  heartbeat?: number;
  error?: string;
  evidence?: unknown;
};
type Status = {
  initialized: boolean;
  paused?: boolean;
  message?: string;
  tasks?: Task[];
};
export function Factory() {
  const [data, setData] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, []);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const next = await api("/api/factory");
      if (
        typeof next.initialized !== "boolean" ||
        (next.tasks != null &&
          (!Array.isArray(next.tasks) ||
            next.tasks.some((t: Task) => !t || typeof t.id !== "string")))
      )
        throw new Error("Factory status response is invalid.");
      if (alive.current) setData(next);
    } catch (e) {
      if (alive.current)
        setError("Factory status unavailable: " + errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const tasks = data?.tasks || [];
  return (
    <div className="utility-stack">
      <Message text="Read-only local standalone CLI worker status. This view does not start, pause or change tasks." />
      <Action label="Refresh factory status" busy={busy} action={refresh} />
      {error && <Message error text={error} />}{" "}
      {data && (
        <>
          <Badge
            label={
              error
                ? "Retained status · refresh unavailable"
                : data.initialized
                  ? data.paused
                    ? "Factory paused"
                    : "Factory initialized"
                  : "Factory not initialized"
            }
            variant={error ? "warning" : "neutral"}
          />
          {!data.initialized && (
            <Message
              text={
                data.message ||
                "The local factory has not been initialized. No task status is available."
              }
            />
          )}
          <DataGrid
            label="Factory task counts"
            columns={["Total", "Running", "Integrated", "Needs attention"]}
            rows={[
              [
                tasks.length,
                tasks.filter((t) => t.state === "running").length,
                tasks.filter((t) => t.state === "integrated").length,
                tasks.filter((t) =>
                  ["failed", "blocked", "review_failed"].includes(
                    t.state || "",
                  ),
                ).length,
              ],
            ]}
          />
          {data.initialized && !tasks.length && (
            <Message text="No factory tasks have been recorded." />
          )}
          <DataGrid
            label="Factory tasks"
            columns={[
              "Task / role",
              "State",
              "Attempt",
              "Heartbeat / evidence",
            ]}
            rows={tasks.map((t) => [
              `${t.id} · ${t.role || t.actor || "worker"}`,
              <Badge
                label={t.state || "Unknown"}
                variant={
                  ["failed", "blocked", "review_failed"].includes(t.state || "")
                    ? "warning"
                    : "neutral"
                }
              />,
              t.attempts ?? 0,
              <div>
                {t.error ||
                  (t.heartbeat
                    ? new Date(t.heartbeat * 1000).toLocaleString()
                    : "No heartbeat recorded")}
                {t.evidence != null && (
                  <pre>{JSON.stringify(t.evidence, null, 2)}</pre>
                )}
              </div>,
            ])}
          />
          <Disclosure title="Complete factory status">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </Disclosure>
        </>
      )}
    </div>
  );
}
