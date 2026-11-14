/** Build a self-contained static app, excluding all personal projects and evidence. */
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
execFileSync(process.execPath, ["scripts/build-ui.mjs"], { stdio: "inherit" });
await rm("dist", { recursive: true, force: true });
await mkdir("dist/browser/python", { recursive: true });
await cp("web/assets", "dist/assets", { recursive: true });
await cp("web/icons", "dist/icons", { recursive: true });
for (const name of ["pyodide.js", "pyodide.asm.mjs", "pyodide.asm.wasm", "pyodide-lock.json", "python_stdlib.zip"])
  await cp(`node_modules/pyodide/${name}`, `dist/browser/python/${name}`);
await cp("hosted/engine-worker.js", "dist/browser/engine-worker.js");
let html = await readFile("web/index.html", "utf8");
html = html.replace("<head>", '<head><meta name="tds-runtime" content="browser"><meta name="description" content="Build system architectures, simulate failures, explore traffic and compare costs. Free and open source. Runs in your browser.">');
await writeFile("dist/index.html", html);
await writeFile("dist/_headers", `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
/browser/python/*
  Cache-Control: public, max-age=86400
`);
execFileSync("python3", ["-c", `
import json, zipfile
from pathlib import Path
from tds.catalog import catalog, presets
from tds.simulation import validation_constraints
Path('dist/browser/catalog.json').write_text(json.dumps(dict(catalog(), constraints=validation_constraints())))
Path('dist/browser/presets.json').write_text(json.dumps({'presets': presets()}))
with zipfile.ZipFile('dist/browser/model.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for name in ('__init__', 'catalog', 'simulation', 'calibration', 'hosted'):
        archive.write(f'tds/{name}.py')
`], { stdio: "inherit" });
// Include the pinned runtime license alongside the distributed WebAssembly.
const lock = JSON.parse(await readFile("node_modules/pyodide/pyodide-lock.json", "utf8"));
await writeFile("dist/browser/python/NOTICE.txt", `Pyodide ${lock.info?.version || "314.0.8"}\nhttps://github.com/pyodide/pyodide\nMozilla Public License 2.0\nPython standard library: Python Software Foundation License\n`);
await cp("LICENSE", "dist/LICENSE");
for (const name of ["PYODIDE-LICENSE.txt", "PYTHON-LICENSE.txt"]) await cp(`licenses/${name}`, `dist/browser/python/${name}`);
await build({ entryPoints: ["frontend/src/services/browser.ts"], outfile: "artifacts/browser-test.mjs", bundle: true, platform: "browser", format: "esm" });
console.log("Built static browser edition in dist/. No local projects, credentials or worker factory included.");
