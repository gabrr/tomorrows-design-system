import { createAgentTools, type AgentTool } from "./tools";
import { agentStatus } from "./status";
export type ModelContext = {
  registerTool: (
    tool: AgentTool,
    options?: { signal: AbortSignal },
  ) => void | Promise<void>;
  unregisterTool?: (name: string) => void;
};
// Register once at the application root, outside React's repeated render/effect lifecycle.
// Older agent-enabled Chromium builds expose navigator.modelContext instead.
export async function registerAgentTools(
  context: ModelContext | undefined,
  transport: string,
  tools: AgentTool[] = createAgentTools(),
) {
  if (!context || typeof context.registerTool !== "function") {
    agentStatus.update({
      state: "unavailable",
      transport: "",
      tools: [],
      error:
        "This browser does not expose WebMCP. All normal UI controls remain available.",
    });
    return () => {};
  }
  const controller = new AbortController(),
    registered: string[] = [];
  const cleanup = () => {
    controller.abort();
    // Compatibility with older navigator implementations which ignore the signal.
    if (context.unregisterTool)
      for (const name of registered) {
        try {
          context.unregisterTool(name);
        } catch {
          /* Already removed by the AbortSignal. */
        }
      }
  };
  agentStatus.update({ state: "starting", transport, tools: [], error: "" });
  try {
    for (const tool of tools) {
      await context.registerTool(tool, { signal: controller.signal });
      registered.push(tool.name);
    }
    agentStatus.update({
      state: "available",
      transport,
      tools: [...registered],
      error: "",
    });
  } catch (e) {
    cleanup();
    agentStatus.update({
      state: "failed",
      transport,
      tools: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return cleanup;
}
export function startAgentTools() {
  const doc = document as Document & { modelContext?: ModelContext },
    nav = navigator as Navigator & { modelContext?: ModelContext };
  let cleanup = () => {},
    generation = 0;
  const start = async () => {
    const request = ++generation;
    const dispose = await registerAgentTools(
      doc.modelContext || nav.modelContext,
      doc.modelContext ? "document.modelContext" : "navigator.modelContext",
    );
    if (request !== generation) dispose();
    else cleanup = dispose;
  };
  const hide = () => {
    generation++;
    cleanup();
  };
  const show = (event: PageTransitionEvent) => {
    if (event.persisted) void start();
  };
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  void start();
  return () => {
    hide();
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
  };
}
