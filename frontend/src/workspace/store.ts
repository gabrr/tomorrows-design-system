import { selectedNodeIds, connectionProblem } from "../domain/graph";
import { validationMessage } from "../domain/validation";
import { useSyncExternalStore } from "react";
import type {
  WorkspaceState,
  Project,
  Fence,
  Run,
  CatalogEntry,
  Selection,
  Json,
  Event as ScenarioEvent,
  NumericConstraints,
} from "../domain/types";
import {
  clone,
  uid,
  checkProject,
  validateResult,
  canonical,
  nearestFrame,
} from "../domain/evidence.js";
import { createEditHistory } from "../domain/history.js";
import { api, write } from "../services/api";
import { captureFence, sameFence, requireFence } from "../domain/fence.js";
const blank = (): Project => ({
  id: uid("project"),
  name: "Untitled architecture",
  nodes: [],
  edges: [],
  scenario: { duration: 60, rps: 20, seed: 42, events: [] },
  monthly: { hours: 730, traffic_multiplier: 1 },
});
const frozenSnapshots = new WeakSet<object>();
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === "object" && !frozenSnapshots.has(value)) {
    frozenSnapshots.add(value);
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
export class Workspace {
  private listeners = new Set<() => void>();
  private history = createEditHistory();
  private runGeneration = 0;
  private saveGeneration = 0;
  private initialising = false;
  private state: WorkspaceState = {
    project: blank(),
    catalog: [],
    constraints: null,
    presets: [],
    selected: null,
    panel: null,
    aiReviewOpen: false,
    modal: null,
    source: null,
    scenarioDraft: null,
    bulkDraft: null,
    camera: { x: 100, y: 120, zoom: 1 },
    identity: 0,
    revision: 0,
    dirty: false,
    run: null,
    previous: null,
    baseline: null,
    runRevision: -1,
    frame: 0,
    playing: false,
    speed: 1,
    runBusy: false,
    saveBusy: false,
    notice: null,
    ready: false,
    gestureActive: false,
    history: { canUndo: false, canRedo: false, undoLabel: "", redoLabel: "" },
    importRejected: null,
  };
  constructor() {
    this.history.reset(this.state.project);
  }
  get = () => freezeSnapshot(this.state);
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(patch: Partial<WorkspaceState>) {
    this.state = freezeSnapshot({ ...this.state, ...patch });
    this.listeners.forEach((fn) => fn());
  }
  set = (
    patch: Partial<
      Omit<WorkspaceState, "project" | "revision" | "identity" | "history">
    >,
  ) => this.publish(patch);
  fence = (): Fence => captureFence(this.state);
  isCurrent = (f: Fence, exact = true) => sameFence(this.state, f, exact);
  requireCurrent = (f: Fence) => requireFence(this.state, f);
  notify = (text: string, error = false) =>
    this.publish({ notice: { text, error } });
  hasScenarioChanges = () =>
    !!this.state.scenarioDraft &&
    canonical(this.state.scenarioDraft.events) !==
      canonical(this.state.project.scenario.events);
  hasUnsavedWork = () =>
    this.state.dirty || this.hasScenarioChanges() || !!this.state.bulkDraft;
  editBulkDraft = (ids: string[], field: string, value: Json | undefined) => {
    const unique = [...new Set(ids)].sort();
    const draft = this.state.bulkDraft;
    if (
      draft &&
      (canonical(unique) !== canonical(draft.ids) || field !== draft.field)
    )
      throw Error(
        "Recover or discard the pending group edit before starting another.",
      );
    if (
      !unique.length ||
      unique.length > 1000 ||
      field.length > 200 ||
      (value !== undefined &&
        !["number", "string", "boolean"].includes(typeof value)) ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      (typeof value === "string" && value.length > 10000)
    )
      throw Error("Group draft exceeds supported bounds or value types.");
    if (!draft) {
      for (const id of unique) {
        const node = this.state.project.nodes.find((n) => n.id === id);
        if (!node || !Object.hasOwn(node.config, field))
          throw Error("Choose a property present on every selected component.");
      }
    }
    if (
      !draft &&
      unique.every((id) =>
        Object.is(
          this.state.project.nodes.find((node) => node.id === id)?.config[
            field
          ],
          value,
        ),
      )
    )
      return;
    this.publish({
      bulkDraft: {
        ids: unique,
        field,
        value,
        fence: draft?.fence || this.fence(),
      },
    });
  };
  cancelBulkDraft = () => this.publish({ bulkDraft: null });
  recoverBulkDraft = () => {
    const draft = this.state.bulkDraft;
    if (draft) this.select({ kind: "nodes", ids: [...draft.ids] });
  };
  private requireResolvedBulkDraft() {
    if (!this.state.bulkDraft) return;
    this.recoverBulkDraft();
    throw Error(
      "Apply or discard the pending group edit in the inspector first. It is retained only until page reload.",
    );
  }
  async applyBulkDraft() {
    const draft = this.state.bulkDraft;
    if (!draft || draft.value === undefined)
      throw Error("Enter a group property value first.");
    await this.validateAndPatchNodes(
      draft.ids,
      { [draft.field]: draft.value },
      draft.fence,
      undefined,
      draft,
    );
  }
  beginScenarioDraft = () => {
    this.publish({
      scenarioDraft: {
        events: clone(this.state.project.scenario.events),
        fence: this.fence(),
      },
    });
  };
  editScenarioDraft = (
    change: (events: ScenarioEvent[]) => ScenarioEvent[],
  ) => {
    const draft = this.state.scenarioDraft;
    if (!draft) throw Error("Open a scenario draft first.");
    this.publish({
      scenarioDraft: { ...draft, events: clone(change(clone(draft.events))) },
    });
  };
  cancelScenarioDraft = () => this.publish({ scenarioDraft: null });
  async saveScenarioDraft() {
    if (this.state.gestureActive)
      throw Error("Finish the canvas gesture before saving scenario changes.");
    const draft = this.state.scenarioDraft;
    if (!draft) throw Error("Open a scenario draft first.");
    this.requireCurrent(draft.fence);
    const p = clone(this.state.project) as Project;
    p.scenario.events = clone(draft.events);
    const valid = await write<{ valid: boolean; errors?: string[] }>(
      "/api/validate",
      p,
    );
    this.requireCurrent(draft.fence);
    if (this.state.gestureActive)
      throw Error("Finish the canvas gesture before saving scenario changes.");
    if (this.state.scenarioDraft !== draft)
      throw Error(
        "The scenario draft changed during validation. Review and save again.",
      );
    if (valid.valid !== true)
      throw Error(valid.errors?.join(" · ") || "Scenario validation failed.");
    this.edit((d) => {
      d.scenario.events = clone(p.scenario.events);
    }, "Edit scenario events");
    this.cancelScenarioDraft();
    this.notify("Scenario saved. Run to evaluate the changes.");
  }
  edit = (
    change: (p: Project) => void,
    label = "Edit design",
    group?: string,
  ) => {
    const p = clone(this.state.project) as Project;
    change(p);
    this.commitEdit(p, label, group);
  };
  private commitEdit(
    p: Project,
    label: string,
    group?: string,
    draft?: NonNullable<WorkspaceState["bulkDraft"]>,
  ) {
    if (canonical(p) === canonical(this.state.project)) {
      if (draft && this.state.bulkDraft === draft) this.cancelBulkDraft();
      return;
    }
    this.history.record(p, { label, group });
    this.publish({
      project: p,
      ...(draft && this.state.bulkDraft === draft ? { bulkDraft: null } : {}),
      revision: this.state.revision + 1,
      dirty: true,
      playing: false,
      history: this.history.status(),
      notice: null,
    });
  }
  private normalize(p: Project) {
    const next = clone(p) as Project;
    next.monthly ??= { hours: 730, traffic_multiplier: 1 };
    for (const n of next.nodes) {
      n.label ||= n.type;
      n.config = {
        ...clone(
          this.state.catalog.find((c) => c.type === n.type)?.defaults || {},
        ),
        ...n.config,
      };
    }
    return next;
  }
  replace = (p: Project) => {
    checkProject(p);
    const next = this.normalize(p);
    this.runGeneration++;
    this.saveGeneration++;
    this.history.reset(next);
    this.publish({
      project: next,
      identity: this.state.identity + 1,
      revision: this.state.revision + 1,
      dirty: true,
      selected: null,
      panel: null,
      aiReviewOpen: false,
      notice: null,
      source: null,
      scenarioDraft: null,
      bulkDraft: null,
      run: null,
      previous: null,
      baseline: null,
      runRevision: -1,
      frame: 0,
      playing: false,
      runBusy: false,
      saveBusy: false,
      gestureActive: false,
      history: this.history.status(),
      modal: null,
      importRejected: null,
    });
    queueMicrotask(() => window.dispatchEvent(new Event("tds:fit")));
  };
  apply = (p: Project, f: Fence, label = "Apply reviewed proposal") => {
    this.requireCurrent(f);
    if (this.state.gestureActive)
      throw Error(
        "Finish or cancel the active drag before applying a proposal.",
      );
    this.requireResolvedBulkDraft();
    if (this.hasScenarioChanges())
      throw Error(
        "Save or cancel the scenario draft in Experiment before applying a proposal.",
      );
    checkProject(p);
    if (p.id !== this.state.project.id)
      throw Error("Proposal must preserve project identity.");
    this.edit((d) => Object.assign(d, clone(p)), label);
    this.publish({ source: null, selected: null });
  };
  select = (selected: Selection, inspect = true) => {
    this.publish({
      selected,
      playing: false,
      panel: selected && inspect ? "inspector" : this.state.panel,
    });
  };
  selectNodes = (ids: string[], inspect = true) => {
    const unique = [...new Set(ids)].filter((id) =>
      this.state.project.nodes.some((n) => n.id === id),
    );
    this.select(
      unique.length > 1
        ? { kind: "nodes", ids: unique }
        : unique.length
          ? { kind: "node", id: unique[0] }
          : null,
      inspect,
    );
  };
  selectNode = (id: string, additive = false, inspect = true) => {
    if (!this.state.project.nodes.some((n) => n.id === id))
      throw Error("Component no longer exists.");
    const ids = selectedNodeIds(this.state.selected);
    this.selectNodes(
      additive
        ? ids.includes(id)
          ? ids.filter((item) => item !== id)
          : [...ids, id]
        : [id],
      inspect,
    );
  };
  connect = (source: string, target: string, fence: Fence) => {
    this.requireCurrent(fence);
    if (this.state.gestureActive)
      throw Error("Finish the active gesture first.");
    const problem = connectionProblem(this.state.project, source, target);
    if (problem) throw Error(problem);
    const id = uid("edge");
    this.edit(
      (p) =>
        p.edges.push({
          id,
          source,
          target,
          latency_ms: 0,
          weight: 1,
          async: false,
        }),
      "Connect components",
    );
    this.publish({ source: null });
    this.select({ kind: "edge", id });
    return id;
  };
  moveNodes = (
    positions: Record<string, { x: number; y: number }>,
    fence: Fence,
    group?: string,
  ) => {
    this.requireCurrent(fence);
    if (this.state.gestureActive)
      throw Error("Finish the active gesture first.");
    for (const [id, point] of Object.entries(positions)) {
      if (!this.state.project.nodes.some((n) => n.id === id))
        throw Error("A moved component no longer exists.");
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        Math.abs(point.x) > 100000 ||
        Math.abs(point.y) > 100000
      )
        throw Error("Position must be finite and within canvas bounds.");
    }
    this.edit(
      (p) => {
        for (const n of p.nodes) {
          const point = positions[n.id];
          if (point) {
            n.x = Math.round(point.x);
            n.y = Math.round(point.y);
          }
        }
      },
      Object.keys(positions).length > 1 ? "Move components" : "Move component",
      group,
    );
  };
  async patchNodes(
    ids: string[],
    patch: Record<string, Json>,
    fence: Fence,
    signal?: AbortSignal,
  ) {
    return this.validateAndPatchNodes(ids, patch, fence, signal);
  }
  private async validateAndPatchNodes(
    ids: string[],
    patch: Record<string, Json>,
    fence: Fence,
    signal?: AbortSignal,
    draft?: NonNullable<WorkspaceState["bulkDraft"]>,
  ) {
    this.requireCurrent(fence);
    if (this.state.gestureActive)
      throw Error("Finish the active gesture first.");
    const unique = [...new Set(ids)];
    if (!unique.length) throw Error("Select components first.");
    const next = clone(this.state.project) as Project;
    for (const id of unique) {
      const node = next.nodes.find((n) => n.id === id);
      if (!node) throw Error("Selected component no longer exists.");
      for (const [key, value] of Object.entries(patch)) {
        if (
          ["__proto__", "constructor", "prototype"].includes(key) ||
          !(key in node.config)
        )
          throw Error("Choose a property present on every selected component.");
        if (
          !["number", "string", "boolean"].includes(typeof value) ||
          typeof value !== typeof node.config[key]
        )
          throw Error("Keep the property’s existing value type.");
        node.config[key] = value;
      }
    }
    const result = await write<{ valid: boolean; errors?: string[] }>(
      "/api/validate",
      next,
      "POST",
      { signal },
    );
    signal?.throwIfAborted();
    this.requireCurrent(fence);
    if (this.state.gestureActive)
      throw Error("Finish the active gesture first.");
    if (result.valid !== true)
      throw Error(result.errors?.join(" · ") || "Component validation failed.");
    if (draft && this.state.bulkDraft !== draft)
      throw Error(
        "The group draft changed during validation. Review and apply again.",
      );
    this.commitEdit(
      next,
      "Edit " + unique.length + " components",
      undefined,
      draft,
    );
    this.notify(
      "Updated " +
        unique.length +
        " components. Undo restores all previous values.",
    );
  }
  add = (type: string, x = 200, y = 180) => {
    const entry = this.state.catalog.find((c) => c.type === type);
    if (!entry) {
      this.notify("Component is unavailable. Reload the catalog.", true);
      return;
    }
    const n = {
      id: uid("node"),
      type,
      label: entry.label,
      x: Math.round(x),
      y: Math.round(y),
      config: clone(entry.defaults),
    };
    this.edit((p) => p.nodes.push(n), "Add component");
    this.select({ kind: "node", id: n.id }, this.state.panel !== "library");
  };
  removeSelected = () => {
    const selection = this.state.selected;
    if (!selection || this.state.gestureActive) return;
    const ids = new Set(selectedNodeIds(selection));
    this.edit(
      (p) => {
        if (ids.size) {
          p.nodes = p.nodes.filter((n) => !ids.has(n.id));
          p.edges = p.edges.filter(
            (e) => !ids.has(e.source) && !ids.has(e.target),
          );
          p.scenario.events = p.scenario.events.filter(
            (e) => !ids.has(e.target) && !ids.has(e.trigger?.target || ""),
          );
        } else if (selection.kind === "edge")
          p.edges = p.edges.filter((e) => e.id !== selection.id);
      },
      ids.size > 1 ? "Delete components" : "Delete element",
    );
    this.publish({ selected: null, source: null });
    this.notify(
      "Removed. Undo restores components and attached connections/events.",
    );
  };
  duplicateSelected = () => {
    if (this.state.gestureActive) return;
    const ids = new Set(selectedNodeIds(this.state.selected));
    const nodes = this.state.project.nodes.filter((n) => ids.has(n.id));
    if (!nodes.length) return;
    const mapping = new Map(nodes.map((n) => [n.id, uid("node")]));
    const copies = nodes.map((n) => ({
      ...clone(n),
      id: mapping.get(n.id)!,
      label: n.label + " copy",
      x: n.x + 40,
      y: n.y + 50,
    }));
    const edges = this.state.project.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        ...clone(e),
        id: uid("edge"),
        source: mapping.get(e.source)!,
        target: mapping.get(e.target)!,
      }));
    this.edit(
      (p) => {
        p.nodes.push(...copies);
        p.edges.push(...edges);
      },
      nodes.length > 1 ? "Duplicate selected subgraph" : "Duplicate component",
    );
    this.selectNodes(copies.map((n) => n.id));
    this.notify(
      "Duplicated selected components and their internal connections. Scenario events stay with the original components.",
    );
  };
  private restore(direction: "undo" | "redo") {
    const change = this.history[direction]();
    if (!change) return;
    this.publish({
      project: change.project,
      revision: this.state.revision + 1,
      dirty: true,
      playing: false,
      selected: null,
      source: null,
      gestureActive: false,
      history: this.history.status(),
    });
    this.notify(
      `${direction === "undo" ? "Undid" : "Redid"}: ${change.label}. Retained results need a rerun for current telemetry.`,
    );
  }
  undo = () => this.restore("undo");
  redo = () => this.restore("redo");
  setGesture = (active: boolean) => this.publish({ gestureActive: active });
  async run(signal?: AbortSignal) {
    const request = ++this.runGeneration,
      f = this.fence(),
      snapshot = clone(this.state.project) as Project;
    this.publish({ runBusy: true, playing: false });
    try {
      this.requireResolvedBulkDraft();
      if (this.hasScenarioChanges())
        throw Error(
          "Save or cancel the scenario draft before running the experiment.",
        );
      checkProject(snapshot);
      const data = await write<Run>("/api/simulate", snapshot, "POST", {
        signal,
      });
      signal?.throwIfAborted();
      if (!this.isCurrent(f, false) || request !== this.runGeneration) return;
      validateResult(data, snapshot);
      this.publish({
        previous: this.state.run,
        run: data,
        runRevision: f.revision,
        frame: 0,
      });
      this.notify(
        this.isCurrent(f)
          ? "Experiment complete. Play or scrub the timeline."
          : "Completed for the submitted design. Your newer edits are preserved; results are previous evidence.",
      );
    } catch (e) {
      if (this.isCurrent(f, false) && request === this.runGeneration)
        this.notify(
          validationMessage(
            (e as Error).message,
            snapshot,
            this.state.constraints,
          ),
          true,
        );
    } finally {
      if (request === this.runGeneration) this.publish({ runBusy: false });
    }
  }
  async save() {
    if (this.state.saveBusy)
      return {
        saved: false,
        submitted: this.fence(),
        projectId: this.state.project.id,
        current: true,
        message: "A save is already running.",
      };
    const request = ++this.saveGeneration,
      f = this.fence(),
      p = clone(this.state.project);
    this.publish({ saveBusy: true });
    try {
      this.requireResolvedBulkDraft();
      if (this.hasScenarioChanges())
        throw Error(
          "Save or cancel the scenario draft before saving the design.",
        );
      if (!p.nodes.length)
        throw Error("Add at least one component before saving the design.");
      checkProject(p);
      await write("/api/projects/" + encodeURIComponent(p.id), p, "PUT");
      if (this.isCurrent(f)) this.publish({ dirty: false });
      if (this.isCurrent(f, false))
        this.notify(
          this.isCurrent(f)
            ? "Design saved locally."
            : "Submitted revision saved. Newer edits remain unsaved.",
        );
      return {
        saved: true,
        submitted: f,
        projectId: p.id,
        current: this.isCurrent(f),
        message: this.isCurrent(f)
          ? "Current design saved locally."
          : "Earlier submitted revision saved; the current workspace differs.",
      };
    } catch (e) {
      const message = validationMessage(
        (e as Error).message,
        p,
        this.state.constraints,
      );
      if (this.isCurrent(f, false)) this.notify(message, true);
      return {
        saved: false,
        submitted: f,
        projectId: p.id,
        current: this.isCurrent(f),
        message,
      };
    } finally {
      if (request === this.saveGeneration) this.publish({ saveBusy: false });
    }
  }
  async openProject(id: string) {
    const f = this.fence();
    const p = await api<Project>("/api/projects/" + encodeURIComponent(id));
    this.requireCurrent(f);
    this.replace(p);
    this.publish({ dirty: false });
  }
  loadPreset(index: number) {
    const p = this.state.presets[index];
    if (!p) throw Error("Preset is unavailable.");
    this.replace({ ...clone(p), id: uid("project") });
  }
  newProject = () => {
    this.replace(blank());
    this.publish({ dirty: false });
  };
  async importFile(file: File) {
    const f = this.fence();
    if (file.size > 10 * 1024 * 1024)
      throw Error("JSON imports are limited to 10 MB.");
    const bundle = JSON.parse(await file.text());
    this.requireCurrent(f);
    const snapshots = bundle._workspace;
    delete bundle._workspace;
    checkProject(bundle);
    const valid = await write("/api/validate", bundle);
    this.requireCurrent(f);
    if (!valid.valid) throw Error((valid.errors || []).join(" · "));
    try {
      if (snapshots) {
        if (snapshots.format_version !== 1)
          throw Error("Unsupported workspace format.");
        for (const key of ["current_run", "previous_run", "baseline_run"])
          if (snapshots[key])
            validateResult(
              snapshots[key],
              key === "current_run"
                ? snapshots.run_project
                : snapshots[key].project_snapshot || snapshots[key].project,
            );
      }
    } catch (e) {
      this.publish({
        importRejected: {
          project: bundle,
          reason: (e as Error).message,
          fence: f,
        },
        modal: "import-rejected",
      });
      return;
    }
    this.requireCurrent(f);
    this.replace(bundle);
    if (snapshots) {
      for (const key of ["current_run", "previous_run", "baseline_run"])
        if (snapshots[key])
          snapshots[key] = {
            ...snapshots[key],
            project_snapshot: clone(
              snapshots[key].project_snapshot || snapshots[key].project,
            ),
            evidence_origin: "Unverified external evidence",
          };
      this.publish({
        run: snapshots.current_run || null,
        previous: snapshots.previous_run || null,
        baseline: snapshots.baseline_run || null,
        runRevision: -1,
      });
    }
    this.notify(
      "Design imported. Supplied runs are unverified external evidence; rerun locally.",
    );
  }
  importArchitectureOnly() {
    const pending = this.state.importRejected;
    if (!pending) return;
    this.requireCurrent(pending.fence);
    this.replace(pending.project);
    this.notify(
      "Imported validated architecture only; rejected run evidence was discarded.",
    );
  }
  exportFile() {
    const p = this.state.project,
      bundle = {
        ...clone(p),
        _workspace: {
          format_version: 1,
          current_run: this.state.run,
          previous_run: this.state.previous,
          baseline_run: this.state.baseline,
          run_project: this.state.run?.project_snapshot || null,
          results_stale: this.state.runRevision !== this.state.revision,
        },
      };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      (p.name || "architecture").replace(/[^a-z0-9_-]/gi, "-") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.notify("Design and available experiment evidence exported.");
  }
  pinBaseline = () => {
    if (this.state.run) this.publish({ baseline: clone(this.state.run) });
  };
  clearBaseline = () => this.publish({ baseline: null });
  seek = (index: number) => {
    const frames = this.state.run?.frames;
    if (!frames?.length) return;
    this.publish({
      frame: Math.min(frames.length - 1, Math.max(0, Math.round(index))),
      playing: false,
    });
  };
  seekTime = (time: number) => {
    const frames = this.state.run?.frames;
    if (frames?.length) this.seek(nearestFrame(time, frames));
  };
  async init() {
    if (this.initialising) return;
    this.initialising = true;
    const f = this.fence();
    const results = await Promise.allSettled([
      api<{ components: CatalogEntry[]; constraints?: NumericConstraints }>(
        "/api/catalog",
      ),
      api<{ presets: Project[] }>("/api/presets"),
    ]);
    if (results[0].status === "fulfilled")
      this.publish({
        catalog: results[0].value.components,
        constraints: results[0].value.constraints || null,
      });
    else
      this.notify(
        "Catalog could not load. Check the local server and reload.",
        true,
      );
    if (results[1].status === "fulfilled") {
      this.publish({ presets: results[1].value.presets });
      if (this.isCurrent(f) && results[1].value.presets.length) {
        this.replace({
          ...clone(results[1].value.presets[0]),
          id: uid("project"),
        });
        this.publish({ dirty: false });
      }
    } else
      this.notify(
        "Presets unavailable. AI/manual design remains available.",
        true,
      );
    this.publish({ ready: true });
  }
}
export const workspace = new Workspace();
export const useWorkspace = () =>
  useSyncExternalStore(workspace.subscribe, workspace.get, workspace.get);
