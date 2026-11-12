import { build } from "esbuild";
import { mkdir, rm, copyFile, writeFile, readFile } from "node:fs/promises";
import { writeRuntimeNotices } from "./license-notices.mjs";
await mkdir("artifacts", { recursive: true });
await rm("web/assets", { recursive: true, force: true });
await mkdir("web/assets", { recursive: true });
await build({
  entryPoints: ["frontend/src/main.tsx"],
  bundle: true,
  outfile: "web/assets/app.js",
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "external",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "file", ".woff": "file" },
  metafile: true,
}).then(async (result) => {
  await writeFile(
    "artifacts/astryx-build-meta.json",
    JSON.stringify(result.metafile, null, 2),
  );
  await writeRuntimeNotices(result.metafile);
});
await writeFile(
  "web/index.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tomorrow’s · Architecture workspace</title><link rel="stylesheet" href="/assets/app.css"><link rel="icon" href="/icons/graph.svg" type="image/svg+xml"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>\n',
);
await copyFile("licenses/ASTRYX-LICENSE.txt", "web/assets/ASTRYX-LICENSE.txt");
console.log("Built local Astryx/React assets for Python runtime.");
