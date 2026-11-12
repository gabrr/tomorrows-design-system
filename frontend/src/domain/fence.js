export const captureFence = (state) => ({
  identity: state.identity,
  revision: state.revision,
});
export const sameFence = (state, fence, exact = true) =>
  fence.identity === state.identity &&
  (!exact || fence.revision === state.revision);
export function requireFence(state, fence) {
  if (!sameFence(state, fence))
    throw new Error(
      "Workspace changed. Request a new review for the current design.",
    );
}
