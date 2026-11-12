import {
  AgentTools,
  ArchitectureJSON,
  ArchitectureReview,
} from "./agent-tools";
import { architectureReviews } from "../../automation/reviews";
import { saveCurrent } from "./review-logic";
import { useState } from "react";
import { workspace, useWorkspace } from "../../workspace/store";
import { Action, Message, ModalShell, Numeric, Select } from "../../ui";
import { ScenarioPanel } from "../editor";
import { Projects } from "./projects";
import { Pricing } from "./pricing";
import { Calibration } from "./calibration";
import { Factory } from "./factory";
import { errorText } from "./review";
import { numericField } from "../../domain/validation";
import "./utilities.css";
type Mode = "system" | "light" | "dark";
type Props = { mode: Mode; onModeChange: (mode: Mode) => void };
function Settings({ mode, onModeChange }: Props) {
  const { project, constraints } = useWorkspace();
  return (
    <div className="utility-stack">
      <Select
        label="Appearance"
        value={mode}
        onChange={(v) => onModeChange(v as Mode)}
        options={[
          { value: "system", label: "System appearance" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        presentation="popover"
      />
      <Numeric
        label="Monthly operating hours"
        value={project.monthly.hours}
        {...numericField(constraints, "monthly", "hours")}
        step={1}
        isWheelEnabled={false}
        onChange={(v) =>
          workspace.edit(
            (p) => {
              p.monthly.hours = v;
            },
            "Edit monthly operating hours",
            "monthly-hours",
          )
        }
      />
      <Numeric
        label="Monthly traffic multiplier"
        value={project.monthly.traffic_multiplier}
        {...numericField(constraints, "monthly", "traffic_multiplier")}
        step={0.1}
        isWheelEnabled={false}
        onChange={(v) =>
          workspace.edit(
            (p) => {
              p.monthly.traffic_multiplier = v;
            },
            "Edit monthly traffic multiplier",
            "monthly-traffic",
          )
        }
      />
      <Message text="Capacity and cost defaults are illustrative estimates unless supported by a recorded live source or calibration. This simulator is not a production benchmark." />
    </div>
  );
}
function ImportRejected() {
  const { importRejected } = useWorkspace();
  const [error, setError] = useState("");
  return (
    <div className="utility-stack">
      <Message
        error
        text={importRejected?.reason || "Imported evidence was rejected."}
      />
      <Message text="You may import only the architecture, discarding rejected run and comparison evidence. This replaces the current workspace and its unsaved work; save or export first to preserve it." />
      {error && <Message error text={error} />}
      <div className="utility-actions">
        <Action
          label="Save current project"
          action={async () => {
            try {
              await saveCurrent();
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
        <Action
          label="Export current project"
          onClick={() => workspace.exportFile()}
        />
        <Action
          label="Cancel import"
          onClick={() => workspace.set({ importRejected: null, modal: null })}
        />
        <Action
          label="Replace with architecture only"
          variant="primary"
          disabled={
            !importRejected || !workspace.isCurrent(importRejected.fence)
          }
          onClick={() => {
            try {
              if (!importRejected)
                throw new Error("No rejected import is available.");
              workspace.requireCurrent(importRejected.fence);
              workspace.importArchitectureOnly();
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
      </div>
    </div>
  );
}
export function UtilityDialogs(props: Props) {
  const { modal } = useWorkspace();
  const titles = {
    "agent-tools": "Agent tools and activity",
    "architecture-json": "Edit architecture JSON",
    "architecture-review": "Review architecture changes",
    projects: "Your local projects",
    pricing: "Published pricing · review rates",
    calibration: "Measurements · calibration review",
    factory: "Local factory · read only",
    settings: "Workspace settings",
    events: "Scenario events",
    "import-rejected": "Review rejected import",
  };
  return (
    <ModalShell
      title={modal ? titles[modal] : "Workspace utilities"}
      open={!!modal}
      onClose={() => {
        if (modal === "architecture-review" || modal === "architecture-json")
          architectureReviews.cancel();
        workspace.set({ modal: null });
      }}
      width={modal === "pricing" ? 1100 : 820}
    >
      {modal && (
        <div className="utility-layout" key={modal}>
          {modal === "agent-tools" ? (
            <AgentTools />
          ) : modal === "architecture-json" ? (
            <ArchitectureJSON />
          ) : modal === "architecture-review" ? (
            <ArchitectureReview />
          ) : modal === "projects" ? (
            <Projects />
          ) : modal === "pricing" ? (
            <Pricing />
          ) : modal === "calibration" ? (
            <Calibration />
          ) : modal === "factory" ? (
            <Factory />
          ) : modal === "settings" ? (
            <Settings {...props} />
          ) : modal === "events" ? (
            <ScenarioPanel />
          ) : (
            <ImportRejected />
          )}
        </div>
      )}
    </ModalShell>
  );
}
