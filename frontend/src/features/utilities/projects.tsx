import { saveCurrent } from "./review-logic";
import { useEffect, useRef, useState } from "react";
import { api } from "../../services/api";
import { workspace } from "../../workspace/store";
import type { Fence } from "../../domain/types";
import { Action, DataGrid, Message } from "../../ui";
import { errorText } from "./review";
type Saved = { id: string; name?: string };
type Confirmation = {
  label: string;
  detail: string;
  fence: Fence;
  execute: () => Promise<void>;
};
export function Projects() {
  const [items, setItems] = useState<Saved[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [confirm, setConfirm] = useState<Confirmation | null>(null);
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
      const data = await api("/api/projects");
      if (
        !Array.isArray(data.projects) ||
        data.projects.some((p: Saved) => typeof p.id !== "string")
      )
        throw new Error("Local project list is invalid.");
      if (alive.current) {
        setItems(data.projects);
        setLoaded(true);
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function replace(label: string, execute: () => Promise<void>) {
    const fence = workspace.fence();
    if (workspace.hasUnsavedWork())
      setConfirm({
        label,
        detail: workspace.hasScenarioChanges()
          ? "Your scenario draft has unsaved edits. Review and save or cancel them, or discard them explicitly below."
          : "This replaces unsaved work. Save a local copy or export JSON first, or explicitly discard it below.",
        fence,
        execute,
      });
    else void perform(execute, fence);
  }
  async function perform(execute: () => Promise<void>, fence: Fence) {
    setBusy(true);
    setError("");
    try {
      workspace.requireCurrent(fence);
      await execute();
      if (alive.current) setConfirm(null);
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="utility-stack">
      <Message text="Projects are stored by the local backend on this machine. Export JSON for a portable copy." />
      <div className="utility-actions">
        <Action
          label="New project"
          disabled={busy}
          onClick={() =>
            replace("Start a new project", async () => {
              workspace.newProject();
              workspace.set({ modal: null });
            })
          }
        />
        <Action label="Refresh project list" busy={busy} action={refresh} />
      </div>
      {error && <Message error text={error} />}{" "}
      {loaded && !items.length && (
        <Message text="No saved projects yet. Save your architecture to start a collection." />
      )}
      <DataGrid
        label="Saved local projects"
        columns={["Project", "Actions"]}
        rows={items.map((p) => [
          p.name || p.id,
          <div className="utility-actions">
            <Action
              label={`Open ${p.name || p.id}`}
              disabled={busy}
              onClick={() =>
                replace(`Open ${p.name || p.id}`, async () => {
                  await workspace.openProject(p.id);
                  workspace.set({ modal: null });
                })
              }
            />
            <Action
              label={`Delete ${p.name || p.id}`}
              variant="destructive"
              disabled={busy}
              onClick={() =>
                setConfirm({
                  label: `Delete saved project “${p.name || p.id}”`,
                  detail:
                    "Deletes the saved local copy. The currently open workspace stays available.",
                  fence: workspace.fence(),
                  execute: async () => {
                    await api("/api/projects/" + encodeURIComponent(p.id), {
                      method: "DELETE",
                    });
                    await refresh();
                  },
                })
              }
            />
          </div>,
        ])}
      />
      {confirm && (
        <section className="utility-review" aria-label="Confirm project action">
          <Message text={confirm.label + ". " + confirm.detail} />
          {workspace.hasScenarioChanges() && (
            <Action
              label="Review scenario draft"
              onClick={() => workspace.set({ modal: "events" })}
            />
          )}
          <div className="utility-actions">
            <Action
              label="Cancel"
              disabled={busy}
              onClick={() => setConfirm(null)}
            />
            <Action
              label="Save current project first"
              disabled={busy || workspace.hasScenarioChanges()}
              action={async () => {
                setError("");
                try {
                  await saveCurrent();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            />
            <Action
              label="Export current project"
              disabled={workspace.hasScenarioChanges()}
              onClick={() => workspace.exportFile()}
            />
            <Action
              label={
                confirm.label.startsWith("Delete")
                  ? "Delete saved copy"
                  : "Discard unsaved work and continue"
              }
              variant="destructive"
              disabled={busy}
              action={() => perform(confirm.execute, confirm.fence)}
            />
          </div>
        </section>
      )}
    </div>
  );
}
