import { useState } from "react";
import { Search, X, Layers } from "lucide-react";
import {
  Card,
  Input,
  Select,
  Action,
  IconAction,
  Badge,
  Text,
  ModalShell,
} from "../../ui";
import { workspace, useWorkspace } from "../../workspace/store";
import { clickNodePosition } from "../../domain/graph";
export function LibraryPanel() {
  const s = useWorkspace(),
    [query, setQuery] = useState(""),
    [preset, setPreset] = useState<number | null>(null);
  const list = s.catalog.filter((c) =>
    `${c.label} ${c.type} ${c.category}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Card className="floating-panel library-panel" padding={4}>
      <div className="panel-heading">
        <Text type="label" weight="semibold" as="h2">
          Components
        </Text>
        <Badge label={s.catalog.length} />
        <IconAction
          label="Close components"
          icon={<X size={16} />}
          variant="ghost"
          onClick={() => workspace.set({ panel: null })}
        />
      </div>
      <Text color="secondary">
        Click to add near your selection, or drag onto the canvas.
      </Text>
      <Select
        label="Architecture preset"
        value=""
        placeholder="Start from a preset…"
        options={s.presets.map((p, i) => ({ value: String(i), label: p.name }))}
        onChange={(v) => {
          if (workspace.hasUnsavedWork()) setPreset(Number(v));
          else workspace.loadPreset(Number(v));
        }}
        presentation="popover"
      />
      <Input
        label="Search components"
        isLabelHidden
        type="search"
        value={query}
        onChange={setQuery}
        hasClear
        startIcon={Search}
        placeholder="Find a component…"
      />
      <div className="catalog-list" key={query}>
        {[...new Set(list.map((c) => c.category))].map((category) => (
          <section key={category}>
            <Text type="supporting" weight="semibold">
              {category}
            </Text>
            {list
              .filter((c) => c.category === category)
              .map((c) => (
                <div
                  key={c.type}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-tds-component",
                      c.type,
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <Action
                    label={c.label}
                    icon={<Layers size={16} />}
                    variant="ghost"
                    className="catalog-action"
                    onClick={() => {
                      const { project, selected } = workspace.get();
                      try {
                        const point = clickNodePosition(
                          project.nodes,
                          selected,
                        );
                        workspace.add(c.type, point.x, point.y);
                        queueMicrotask(() =>
                          window.dispatchEvent(new Event("tds:fit")),
                        );
                      } catch (error) {
                        workspace.notify((error as Error).message, true);
                      }
                    }}
                    tooltip={c.description}
                  />
                </div>
              ))}
          </section>
        ))}
        {!list.length && (
          <Text>No matching components. Try another search.</Text>
        )}
      </div>
      <ModalShell
        title="Replace unsaved architecture?"
        open={preset !== null}
        onClose={() => setPreset(null)}
        width={460}
      >
        <Text>
          {workspace.hasScenarioChanges()
            ? "Your scenario draft has unsaved edits. Review and save or cancel them before replacing the design."
            : "Save or export this design first to preserve the current changes."}
        </Text>
        {workspace.hasScenarioChanges() && (
          <Action
            label="Review scenario draft"
            onClick={() => {
              setPreset(null);
              workspace.set({ modal: "events" });
            }}
          />
        )}
        <div className="row">
          <Action label="Cancel" onClick={() => setPreset(null)} />
          <Action
            label="Replace with preset"
            variant="destructive"
            onClick={() => {
              if (preset !== null) workspace.loadPreset(preset);
              setPreset(null);
            }}
          />
        </div>
      </ModalShell>
    </Card>
  );
}
