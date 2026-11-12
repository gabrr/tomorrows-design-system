/* In-memory, bounded project history. Run evidence is deliberately not rewound. */
export function createEditHistory({
  maxEntries = 50,
  maxBytes = 8_000_000,
  clock = () => Date.now(),
} = {}) {
  if (
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    !Number.isFinite(maxBytes) ||
    maxBytes < 1
  )
    throw new Error("Invalid history bounds");
  let entries = [],
    cursor = -1,
    projectId = null,
    bytes = 0;
  const size = (json) => json.length * 2; // Conservative UTF-16 storage estimate.
  function reset(project) {
    const json = JSON.stringify(project);
    entries = [{ json, label: "Starting design", group: null, at: clock() }];
    cursor = 0;
    projectId = project.id;
    bytes = size(json);
  }
  function status() {
    return {
      canUndo: cursor > 0,
      canRedo: cursor >= 0 && cursor < entries.length - 1,
      undoLabel: cursor > 0 ? entries[cursor].label : "",
      redoLabel: entries[cursor + 1]?.label || "",
      steps: Math.max(0, entries.length - 1),
      bytes,
      limited: bytes > maxBytes,
    };
  }
  /** @param {any} project @param {{label?:string,group?:string|null}} options */
  function record(project, { label = "Edit design", group = null } = {}) {
    if (!entries.length || project.id !== projectId) {
      reset(project);
      return false;
    }
    const json = JSON.stringify(project);
    if (json === entries[cursor].json) return false;
    const tip = cursor === entries.length - 1,
      now = clock();
    entries = entries.slice(0, cursor + 1);
    if (
      group &&
      tip &&
      cursor > 0 &&
      entries[cursor].group === group &&
      now - entries[cursor].at < 800
    ) {
      entries[cursor] = { json, label, group, at: now };
    } else {
      entries.push({ json, label, group, at: now });
      cursor++;
    }
    bytes = entries.reduce((sum, e) => sum + size(e.json), 0);
    while (
      entries.length > 1 &&
      (entries.length > maxEntries + 1 || bytes > maxBytes)
    ) {
      bytes -= size(entries.shift().json);
      cursor--;
    }
    return true;
  }
  function move(delta) {
    const target = cursor + delta;
    if (target < 0 || target >= entries.length) return null;
    const label = delta < 0 ? entries[cursor].label : entries[target].label;
    cursor = target;
    return { project: JSON.parse(entries[cursor].json), label };
  }
  return { reset, record, status, undo: () => move(-1), redo: () => move(1) };
}
