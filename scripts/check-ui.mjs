import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
await mkdir("artifacts/ui-tests", { recursive: true });
const entries = ["frontend/src/features/utilities/review.test.mjs"];
for (const f of await readdir("frontend/tests").catch(() => []))
  if (f.endsWith(".test.ts")) entries.push("frontend/tests/" + f);
for (const [i, entry] of entries.entries()) {
  const output = `artifacts/ui-tests/check-${i}.mjs`;
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node20",
  });
  const result = spawnSync(process.execPath, ["--test", output], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const script of [
  "integrity.cjs",
  "rate-provenance.cjs",
  "price-display.cjs",
  "edit-history.cjs",
]) {
  const r = spawnSync(process.execPath, ["web/tests/" + script], {
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
