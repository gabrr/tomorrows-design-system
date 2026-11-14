import { Card, Action, Text } from "../../ui";
import { useWorkspace, workspace } from "../../workspace/store";
export function BrowserGuide() {
  const state = useWorkspace();
  return <Card padding={3} className="browser-guide" role="region" aria-label="Browser edition">
    <div><strong>Design it. Break it. See what happens.</strong>
      <Text type="supporting">Runs privately in your browser · no AI account needed</Text></div>
    <div className="browser-guide-actions">
      {!state.project.nodes.length && <Action label="Try server failover" disabled={!state.presets.length} onClick={() => {
        const index = state.presets.findIndex(p => p.id === "failover");
        if (index >= 0) { workspace.loadPreset(index); workspace.set({ panel: "experiment" }); }
      }} />}
      <Action label="Components" variant="secondary" onClick={() => workspace.set({ panel: "library" })} />
      <Action label="Get local edition + AI" variant="ghost" onClick={() => window.open("https://github.com/gabrr/tomorrows-design-system#quick-start", "_blank", "noopener,noreferrer")} />
    </div>
  </Card>;
}
