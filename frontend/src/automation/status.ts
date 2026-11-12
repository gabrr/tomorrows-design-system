export type AgentActivity = {
  name: string;
  label: string;
  ok: boolean;
  at: string;
};
type Status = {
  state: "starting" | "available" | "unavailable" | "failed";
  transport: string;
  tools: string[];
  error: string;
  activity: AgentActivity[];
};
let status: Status = {
  state: "starting",
  transport: "",
  tools: [],
  error: "",
  activity: [],
};
const listeners = new Set<() => void>();
export const agentStatus = {
  get: () => status,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  update(patch: Partial<Status>) {
    status = { ...status, ...patch };
    listeners.forEach((fn) => fn());
  },
  record(item: AgentActivity) {
    this.update({ activity: [item, ...status.activity].slice(0, 20) });
  },
};
