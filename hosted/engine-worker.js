/* Runs the shipped Python model off the UI thread. No network APIs or AI calls. */
importScripts("/browser/python/pyodide.js");
let runtime;
async function initialize() {
  const python = await loadPyodide({ indexURL: "/browser/python/" });
  const response = await fetch("/browser/model.zip");
  if (!response.ok) throw Error("The simulation model could not load.");
  python.unpackArchive(await response.arrayBuffer(), "zip");
  python.runPython("from tds.hosted import dispatch_json");
  return python;
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const python = await (runtime ??= initialize().catch(error => { runtime = undefined; throw error; }));
      python.globals.set("request_path", data.path);
      python.globals.set("request_body", JSON.stringify(data.body));
      const value = python.runPython("dispatch_json(request_path, request_body)");
      self.postMessage({ id: data.id, value: JSON.parse(value) });
    } catch (error) {
      self.postMessage({ id: data.id, error: error.message || String(error) });
    }
  });
};
