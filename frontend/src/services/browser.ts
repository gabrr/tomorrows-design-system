/** Same workspace commands; private IndexedDB storage and the real Python engine. */
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("tomorrows-design-system", 1);
    request.onupgradeneeded = () => {
      for (const name of ["projects", "runs"]) request.result.createObjectStore(name, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(Error("Browser storage is unavailable. Export your design as JSON.")); };
    request.onblocked = () => reject(Error("Close older app tabs and retry browser storage."));
  });
}
async function storage(store: string, operation: "get" | "getAll" | "put" | "delete", value?: any): Promise<any> {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(store, operation === "put" || operation === "delete" ? "readwrite" : "readonly");
    const target = transaction.objectStore(store);
    const request = operation === "getAll" ? target.getAll() : target[operation](value);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(Error("Could not save browser data. Export JSON before closing this tab."));
    transaction.onabort = () => reject(Error("Browser storage transaction was interrupted. Retry or export JSON."));
  });
}
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; cleanup: () => void }>();
function stopEngine(error: Error) {
  worker?.terminate(); worker = undefined;
  for (const item of pending.values()) { item.cleanup(); item.reject(error); }
  pending.clear();
}
function engine(path: string, body: any, signal?: AbortSignal | null): Promise<any> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  if (!worker) {
    worker = new Worker("/browser/engine-worker.js");
    worker.onmessage = ({ data }) => {
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id); item.cleanup();
      if (data.error) item.reject(Error(data.error)); else item.resolve(data.value);
    };
    worker.onerror = () => stopEngine(Error("The simulation engine could not load. Check your connection and retry."));
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const cancel = () => stopEngine(new DOMException("Cancelled", "AbortError"));
    const timer = window.setTimeout(() => stopEngine(Error("The browser simulation timed out. Reduce traffic or duration and retry.")), 120_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    pending.set(id, { resolve, reject, cleanup });
    signal?.addEventListener("abort", cancel, { once: true });
    worker!.postMessage({ id, path, body });
  });
}
function identifier(path: string) {
  const id = decodeURIComponent(path.split("/").at(-1)!);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw Error("Invalid project or run identifier.");
  return id;
}
async function asset(name: string) {
  const response = await fetch(`/browser/${name}.json`);
  if (!response.ok) throw Error("Application data could not load. Reload and try again.");
  return response.json();
}
const prices = {
  records: [], snapshots: [], providers: [], sources: {},
  warnings: ["This browser edition uses your explicitly configured rates. Live provider catalog refresh is available in the local edition."],
};
export async function browserRequest(path: string, options: RequestInit = {}): Promise<any> {
  const method = options.method || "GET";
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  if (typeof options.body === "string" && new TextEncoder().encode(options.body).length > 2 * 1024 * 1024)
    throw Error("Requests are limited to 2 MiB. Reduce the architecture or imported evidence.");
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  if (method === "GET") {
    if (path === "/api/catalog") return asset("catalog");
    if (path === "/api/presets") return asset("presets");
    if (path === "/api/health") return { status: "ok", runtime: "browser" };
    if (path === "/api/pricing") return prices;
    if (path === "/api/ai") return { providers: [], default: null, proposal_only: true };
    if (path === "/api/factory") return { initialized: false, tasks: [], message: "The code factory is available only in the local edition." };
    if (path === "/api/projects") return { projects: (await storage("projects", "getAll")).map((p: any) => ({ id: p.id, name: p.project.name, nodes: p.project.nodes.length, updated_at: p.updated_at })) };
    if (path.startsWith("/api/projects/")) {
      const item = await storage("projects", "get", identifier(path));
      if (!item) throw Error("Saved project not found in this browser.");
      return item.project;
    }
    if (path === "/api/runs") return { runs: (await storage("runs", "getAll")).map((r: any) => r.result).sort((a: any, b: any) => b.created_at - a.created_at) };
    if (path.startsWith("/api/runs/")) {
      const item = await storage("runs", "get", identifier(path));
      if (!item) throw Error("Run not found in this browser.");
      return item.result;
    }
  }
  if (method === "DELETE" && path.startsWith("/api/projects/")) {
    await storage("projects", "delete", identifier(path)); return { deleted: true };
  }
  if (method === "PUT" && path.startsWith("/api/projects/")) {
    if (body.id !== identifier(path)) throw Error("Project identifier must match its URL.");
    const check = await engine("/api/validate", body, options.signal);
    if (!check.valid) throw Error(check.errors.join("; "));
    await storage("projects", "put", { id: body.id, project: body, updated_at: Date.now() / 1000 });
    return body;
  }
  if (method === "POST") {
    if (path === "/api/ai/generate") throw Error("AI design requires the local edition with your signed-in Codex CLI. Manual design and experiments work here without AI.");
    if (path === "/api/pricing/refresh" || path === "/api/pricing/apply") throw Error("Use manual component rates in this browser edition, or run locally for live pricing catalogs.");
    if (["/api/validate", "/api/calibration", "/api/observations/compare", "/api/simulate"].includes(path)) {
      const result = await engine(path, body, options.signal);
      if (path === "/api/simulate") {
        result.project_snapshot = structuredClone(body);
        result.run_id = crypto.randomUUID().replaceAll("-", "");
        result.created_at = Date.now() / 1000;
        result.pricing_snapshots = [];
        result.referenced_pricing_snapshot_ids = [...new Set(body.nodes.flatMap((n: any) => typeof n.config?.pricing_provenance?.snapshot_id === "string" ? [n.config.pricing_provenance.snapshot_id] : []))];
        // Simulation outcomes remain usable even if this browser has exhausted its storage.
        try {
          await storage("runs", "put", { id: result.run_id, result });
          const runs = await storage("runs", "getAll");
          for (const old of runs.sort((a: any, b: any) => b.result.created_at - a.result.created_at).slice(100)) await storage("runs", "delete", old.id);
        } catch {
          result.assumptions.push("This run could not be retained in browser storage. Export JSON to preserve it.");
        }
      }
      return result;
    }
  }
  throw Error("This action is unavailable in the browser edition.");
}
