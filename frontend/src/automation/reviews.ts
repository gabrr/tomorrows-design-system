import { Workspace, workspace } from "../workspace/store";
import type { Fence, Project } from "../domain/types";
import { checkProject, clone, uid } from "../domain/evidence.js";
import { api } from "../services/api";
export type Review = {
  id: string;
  fence: Fence;
  before: Project;
  proposal: Project;
};
// UI and WebMCP share the same preparation, validation, apply and cancellation.
export class ArchitectureReviews {
  private pending: Review | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private store: Workspace) {}
  get = () => this.pending;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(next: Review | null) {
    this.pending = next;
    this.listeners.forEach((fn) => fn());
  }
  cancel = () => {
    this.generation++;
    this.publish(null);
  };
  async prepare(project: Project, fence: Fence, signal?: AbortSignal) {
    this.store.requireCurrent(fence);
    if (this.store.get().gestureActive)
      throw Error("Finish the canvas gesture before preparing changes.");
    const proposal = clone(project) as Project;
    checkProject(proposal);
    if (proposal.id !== this.store.get().project.id)
      throw Error(
        "Keep the current project ID. Use the import UI to replace a workspace.",
      );
    if (JSON.stringify(proposal).length > 1_000_000)
      throw Error("Architecture proposals are limited to 1 MB.");
    const request = ++this.generation,
      before = clone(this.store.get().project) as Project;
    const response = await api<{ valid: boolean; errors?: string[] }>(
      "/api/validate",
      { method: "POST", body: JSON.stringify(proposal), signal },
    );
    signal?.throwIfAborted();
    this.store.requireCurrent(fence);
    if (request !== this.generation)
      throw Error("This review was cancelled or superseded.");
    if (response.valid !== true)
      throw Error(
        response.errors?.join(" · ") || "Architecture validation failed.",
      );
    const review: Review = { id: uid("review"), fence, before, proposal };
    this.publish(review);
    this.store.set({ modal: "architecture-review" });
    return review;
  }
  apply = (id: string, fence: Fence) => {
    const review = this.pending;
    if (!review || review.id !== id)
      throw Error("This review no longer exists. Prepare a fresh review.");
    this.store.requireCurrent(fence);
    if (
      fence.identity !== review.fence.identity ||
      fence.revision !== review.fence.revision
    )
      throw Error("The review belongs to another revision.");
    this.store.apply(
      review.proposal,
      review.fence,
      "Apply reviewed architecture changes",
    );
    this.cancel();
    this.store.set({ modal: null });
    this.store.notify(
      "Reviewed architecture changes applied. Undo restores the previous design.",
    );
  };
}
export const architectureReviews = new ArchitectureReviews(workspace);
