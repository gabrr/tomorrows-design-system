import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  Theme,
  Card,
  Text,
  Action,
  IconAction,
  TabList,
  Tab,
  Message,
} from "./ui";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { workspace, useWorkspace } from "./workspace/store";
import {
  Canvas,
  LibraryPanel,
  InspectorPanel,
  ScenarioPanel,
  Playback,
} from "./features/editor";
import { AIWorkspace } from "./features/ai";
import { UtilityDialogs } from "./features/utilities";
import { ResultsPanel } from "./features/results";
import { WorkspaceChrome } from "./features/layout";
type Mode = "system" | "light" | "dark";
function initialMode(): Mode {
  try {
    const m = localStorage.getItem("tds-astryx-mode");
    return m === "light" || m === "dark" ? m : "system";
  } catch {
    return "system";
  }
}
export function App() {
  const s = useWorkspace(),
    [mode, setMode] = useState<Mode>(initialMode),
    [tab, setTab] = useState("scenario");
  useEffect(() => {
    void workspace.init();
    const leave = (e: BeforeUnloadEvent) => {
      if (workspace.hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const key = (e: KeyboardEvent) => {
      const state = workspace.get();
      if (
        e.defaultPrevented ||
        document.querySelector("dialog[open],[role=listbox],[role=menu]")
      )
        return;
      const input = (e.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document
          .querySelector<HTMLTextAreaElement>(
            ".ai-workspace textarea,.ai-composer textarea,textarea",
          )
          ?.focus();
        return;
      }
      if (input && e.key !== "Escape") return;
      if (
        (e.metaKey || e.ctrlKey) &&
        !state.gestureActive &&
        ["z", "y"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        if (e.shiftKey || e.key.toLowerCase() === "y") workspace.redo();
        else workspace.undo();
      }
      if (e.key === "Escape" && !state.gestureActive) {
        const active = document.activeElement,
          owner = active?.closest(".library-panel")
            ? "Components"
            : active?.closest(".inspector-panel")
              ? "Inspector"
              : active?.closest(".experiment-panel")
                ? "Experiment and results"
                : null;
        workspace.set({ panel: null, source: null });
        if (owner)
          document
            .querySelector<HTMLButtonElement>(`button[aria-label="${owner}"]`)
            ?.focus();
      }
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    setTab(s.run ? "results" : "scenario");
  }, [s.run, s.identity]);
  function changeMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem("tds-astryx-mode", next);
    } catch {}
  }
  return (
    <Theme theme={neutralTheme} mode={mode}>
      <div className={`app-shell ${s.run ? "has-run" : ""}`}>
        <Action
          label="Skip to architecture canvas"
          href="#canvas"
          className="skip-link"
          variant="ghost"
        />
        <Canvas />
        <WorkspaceChrome />
        {s.panel === "library" && <LibraryPanel />}
        {s.panel === "inspector" && <InspectorPanel />}
        {s.panel === "experiment" && (
          <Card className="floating-panel experiment-panel" padding={4}>
            <div className="panel-heading">
              <Text type="label" as="h2">
                Experiment
              </Text>
              <IconAction
                label="Close experiment details"
                variant="ghost"
                icon={<X size={16} />}
                onClick={() => workspace.set({ panel: null })}
              />
            </div>
            <TabList
              role="tablist"
              aria-label="Experiment panels"
              value={tab}
              onChange={setTab}
              hasDivider
            >
              <Tab value="scenario" label="Scenario" panelId="scenario-panel" />
              <Tab
                value="results"
                label="Results & comparison"
                panelId="results-panel"
              />
            </TabList>
            <div className="panel-scroll">
              <div
                id="scenario-panel"
                role="tabpanel"
                aria-label="Scenario"
                hidden={tab !== "scenario"}
              >
                <ScenarioPanel />
              </div>
              <div
                id="results-panel"
                role="tabpanel"
                aria-label="Results and comparison"
                hidden={tab !== "results"}
              >
                <ResultsPanel />
              </div>
            </div>
          </Card>
        )}
        <AIWorkspace />
        <Playback />
        {s.notice && (
          <aside className="notice-layer">
            <Message text={s.notice.text} error={s.notice.error} />
            <IconAction
              label="Dismiss notice"
              icon={<X size={14} />}
              variant="ghost"
              onClick={() => workspace.set({ notice: null })}
            />
          </aside>
        )}
        <div className="model-caption">
          <Text type="supporting">
            Local simulation · illustrative estimates
          </Text>
        </div>
        <UtilityDialogs mode={mode} onModeChange={changeMode} />
      </div>
    </Theme>
  );
}
