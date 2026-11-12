import { agentStatus } from "../../automation/status";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowUp,
  Network,
  Plus,
  Settings2,
  ChartNoAxesCombined,
  Undo2,
  Redo2,
  Minus,
  Maximize2,
  Save,
  Play,
  MoreHorizontal,
  FolderOpen,
} from "lucide-react";
import {
  Card,
  Input,
  Action,
  IconAction,
  DropdownMenu,
  ModalShell,
  Text,
} from "../../ui";
import { workspace, useWorkspace } from "../../workspace/store";
export function WorkspaceChrome() {
  const activity = useSyncExternalStore(agentStatus.subscribe, agentStatus.get)
    .activity[0];
  const s = useWorkspace(),
    file = useRef<HTMLInputElement>(null),
    [replacement, setReplacement] = useState<null | (() => void)>(null);
  function replace(action: () => void) {
    if (workspace.hasUnsavedWork()) setReplacement(() => action);
    else action();
  }
  const menuItems = [
    {
      id: "agent-tools",
      label: "Agent tools and activity",
      onClick: () => workspace.set({ modal: "agent-tools" }),
    },
    {
      id: "architecture-json",
      label: "Review architecture JSON",
      onClick: () => workspace.set({ modal: "architecture-json" }),
    },
    {
      id: "projects",
      label: "Saved designs",
      onClick: () => workspace.set({ modal: "projects" }),
    },
    {
      id: "new",
      label: "New architecture",
      onClick: () => replace(workspace.newProject),
    },
    {
      id: "import",
      label: "Import JSON",
      onClick: () => file.current?.click(),
    },
    {
      id: "export",
      label: "Export design and evidence",
      onClick: () => workspace.exportFile(),
    },
    { type: "divider" as const },
    {
      id: "pricing",
      label: "Pricing sources",
      onClick: () => workspace.set({ modal: "pricing" }),
    },
    {
      id: "measurements",
      label: "Measurements and calibration",
      onClick: () => workspace.set({ modal: "calibration" }),
    },
    {
      id: "factory",
      label: "Factory status",
      onClick: () => workspace.set({ modal: "factory" }),
    },
    {
      id: "settings",
      label: "Workspace settings",
      onClick: () => workspace.set({ modal: "settings" }),
    },
  ];
  return (
    <>
      <header className="workspace-header">
        <Card className="project-bar" padding={2}>
          <IconAction
            label="Tomorrow’s Design System"
            icon={<Network size={20} />}
            variant="ghost"
            onClick={() => workspace.set({ panel: null })}
          />
          <div className="project-name-field">
            <Input
              label="Project name"
              isLabelHidden
              value={s.project.name}
              onChange={(v) =>
                workspace.edit(
                  (p) => {
                    p.name = v;
                  },
                  "Rename design",
                  "project-name",
                )
              }
            />
            <Text type="supporting">
              {workspace.hasUnsavedWork()
                ? "Unsaved local changes"
                : "Local workspace"}
              {activity
                ? activity.ok
                  ? " · Agent activity"
                  : " · Agent error"
                : ""}
            </Text>
          </div>
        </Card>
        <Card className="command-bar" padding={2}>
          <DropdownMenu
            presentation="popover"
            renderTrigger={(props) => (
              <IconAction
                {...props}
                label="Workspace menu"
                icon={<MoreHorizontal size={18} />}
                variant="ghost"
              />
            )}
            items={menuItems}
          />
          <Action
            label="Projects"
            icon={<FolderOpen size={16} />}
            onClick={() => workspace.set({ modal: "projects" })}
          />
          <Action
            label="Save"
            icon={<Save size={16} />}
            busy={s.saveBusy}
            disabled={!s.project.nodes.length}
            onClick={() => void workspace.save()}
          />
          <Action
            label="Run simulation"
            variant="primary"
            icon={<Play size={16} />}
            busy={s.runBusy}
            disabled={!s.project.nodes.length}
            onClick={() => void workspace.run()}
          />
        </Card>
      </header>
      <Card className="tool-rail" padding={1}>
        <IconAction
          label="Components"
          selected={s.panel === "library"}
          icon={<Plus size={18} />}
          onClick={() =>
            workspace.set({ panel: s.panel === "library" ? null : "library" })
          }
        />
        <IconAction
          label="Inspector"
          selected={s.panel === "inspector"}
          icon={<Settings2 size={18} />}
          onClick={() =>
            workspace.set({
              panel: s.panel === "inspector" ? null : "inspector",
            })
          }
        />
        <IconAction
          label="Experiment and results"
          selected={s.panel === "experiment"}
          icon={<ChartNoAxesCombined size={18} />}
          onClick={() =>
            workspace.set({
              panel: s.panel === "experiment" ? null : "experiment",
            })
          }
        />
        <div className="rail-separator" />
        <IconAction
          label="Undo design edit"
          icon={<Undo2 size={18} />}
          disabled={!s.history.canUndo || s.gestureActive}
          onClick={workspace.undo}
        />
        <IconAction
          label="Redo design edit"
          icon={<Redo2 size={18} />}
          disabled={!s.history.canRedo || s.gestureActive}
          onClick={workspace.redo}
        />
      </Card>
      <Card className="camera-toolbar" padding={1}>
        <IconAction
          label="Zoom out"
          icon={<Minus size={16} />}
          onClick={() =>
            workspace.set({
              camera: {
                ...s.camera,
                zoom: Math.max(0.25, s.camera.zoom / 1.15),
              },
            })
          }
        />
        <Text type="supporting">{Math.round(s.camera.zoom * 100)}%</Text>
        <IconAction
          label="Zoom in"
          icon={<Plus size={16} />}
          onClick={() =>
            workspace.set({
              camera: {
                ...s.camera,
                zoom: Math.min(2.5, s.camera.zoom * 1.15),
              },
            })
          }
        />
        <DropdownMenu
          renderTrigger={(triggerProps) => (
            <IconAction
              {...triggerProps}
              label="Pan view"
              icon={<ArrowUp size={16} />}
            />
          )}
          items={(
            [
              ["left", 80, 0],
              ["right", -80, 0],
              ["up", 0, 80],
              ["down", 0, -80],
            ] as const
          ).map(([direction, x, y]) => ({
            id: direction,
            label: "Pan " + direction,
            onClick: () =>
              workspace.set({
                camera: { ...s.camera, x: s.camera.x + x, y: s.camera.y + y },
              }),
          }))}
        />
        <IconAction
          label="Fit view"
          icon={<Maximize2 size={16} />}
          onClick={() => window.dispatchEvent(new Event("tds:fit"))}
        />
      </Card>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Import project JSON"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          replace(
            () =>
              void workspace
                .importFile(f)
                .catch((err) => workspace.notify(err.message, true)),
          );
        }}
      />
      <ModalShell
        title="Replace unsaved architecture?"
        open={!!replacement}
        onClose={() => setReplacement(null)}
        width={460}
      >
        <Text>
          {workspace.hasScenarioChanges()
            ? "Your scenario draft has unsaved edits. Review and save or cancel them before leaving, or discard them explicitly here."
            : "Export or save your design first to keep these changes."}
        </Text>
        {workspace.hasScenarioChanges() && (
          <Action
            label="Review scenario draft"
            onClick={() => {
              setReplacement(null);
              workspace.set({ modal: "events" });
            }}
          />
        )}
        <div className="row">
          <Action label="Cancel" onClick={() => setReplacement(null)} />
          <Action
            label="Replace workspace"
            variant="destructive"
            onClick={() => {
              const action = replacement;
              setReplacement(null);
              action?.();
            }}
          />
        </div>
      </ModalShell>
    </>
  );
}
