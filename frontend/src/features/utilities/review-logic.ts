import type { Fence, Project } from "../../domain/types";
import { checkProject } from "../../domain/evidence.js";
import { write } from "../../services/api";
import { workspace } from "../../workspace/store";
export function guard(fence: Fence, current: () => boolean) {
  workspace.requireCurrent(fence);
  if (!current())
    throw new Error("This review was superseded. Request a new proposal.");
}
export async function validateProposal(
  proposal: Project,
  fence: Fence,
  current: () => boolean,
) {
  guard(fence, current);
  checkProject(proposal);
  if (proposal.id !== workspace.get().project.id)
    throw new Error("Proposal must preserve project identity.");
  const result = await write("/api/validate", proposal);
  guard(fence, current);
  if (result.valid !== true)
    throw new Error(
      (result.errors || ["Proposal validation failed."]).join("\n"),
    );
}

/** Workspace.save reports failures through its notice; surface them inside the modal too. */
export async function saveCurrent() {
  const fence = workspace.fence();
  await workspace.save();
  workspace.requireCurrent(fence);
  if (workspace.get().notice?.error)
    throw new Error(workspace.get().notice!.text);
  if (workspace.get().dirty)
    throw new Error(
      workspace.get().notice?.error
        ? workspace.get().notice!.text
        : "The current design has not been saved yet. Retry before replacing it.",
    );
}
