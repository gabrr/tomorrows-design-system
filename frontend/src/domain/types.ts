export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface Node {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  config: Record<string, Json>;
}
export interface Edge {
  id: string;
  source: string;
  target: string;
  latency_ms?: number;
  weight?: number;
  async?: boolean;
  [key: string]: Json | undefined;
}
export interface Event {
  id: string;
  type: "fail" | "recover" | "traffic" | "latency" | "scale";
  target: string;
  time?: number;
  value?: number;
  field?: string;
  window?: [number, number];
  trigger?: { metric: string; target: string; operator: "gte"; value: number };
}
export interface Project {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  scenario: { duration: number; seed: number; rps: number; events: Event[] };
  monthly: { hours: number; traffic_multiplier: number };
}
export interface Frame {
  time: number;
  requests: number;
  completed: number;
  failed: number;
  inflight: number;
  background_pending?: number;
  nodes: Record<
    string,
    {
      state: string;
      utilization: number;
      queue_depth: number;
      [key: string]: string | number;
    }
  >;
  edges: Record<string, Record<string, number>>;
  [key: string]: unknown;
}
export interface Run {
  run_id?: string;
  model_version: string;
  seed: number;
  duration: number;
  summary: Record<string, number>;
  frames: Frame[];
  events: { time: number; type: string; target: string; message?: string }[];
  costs: Array<{
    id: string;
    label: string;
    experiment_cost: number;
    monthly_cost: number;
    [key: string]: unknown;
  }>;
  assumptions: string[];
  project_snapshot: Project;
  project?: Project;
  evidence_origin?: string;
}
export interface CatalogEntry {
  type: string;
  label: string;
  category: string;
  description: string;
  defaults: Record<string, Json>;
  model: string;
  limitations: string[];
}
export type Selection =
  | { kind: "node" | "edge"; id: string }
  | { kind: "nodes"; ids: string[] }
  | null;
export interface Fence {
  identity: number;
  revision: number;
}
export interface NumericConstraint {
  min: number;
  max: number;
  integer: boolean;
}
export type NumericScope = "node_config" | "edge" | "scenario" | "monthly";
export type NumericConstraints = Record<
  NumericScope,
  Record<string, NumericConstraint>
>;
export type Modal =
  | "projects"
  | "pricing"
  | "calibration"
  | "factory"
  | "events"
  | "settings"
  | "agent-tools"
  | "architecture-json"
  | "architecture-review"
  | "import-rejected"
  | null;
export interface WorkspaceState {
  project: Project;
  catalog: CatalogEntry[];
  constraints: NumericConstraints | null;
  presets: Project[];
  selected: Selection;
  panel: "library" | "inspector" | "experiment" | null;
  aiReviewOpen: boolean;
  modal: Modal;
  source: string | null;
  scenarioDraft: { events: Event[]; fence: Fence } | null;
  bulkDraft: {
    ids: string[];
    field: string;
    value: Json | undefined;
    numericText?: string;
    fence: Fence;
  } | null;
  camera: { x: number; y: number; zoom: number };
  identity: number;
  revision: number;
  dirty: boolean;
  run: Run | null;
  previous: Run | null;
  baseline: Run | null;
  runRevision: number;
  frame: number;
  playing: boolean;
  speed: number;
  runBusy: boolean;
  saveBusy: boolean;
  notice: { text: string; error: boolean } | null;
  ready: boolean;
  gestureActive: boolean;
  history: {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string;
    redoLabel: string;
  };
  importRejected: { project: Project; reason: string; fence: Fence } | null;
}
