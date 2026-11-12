import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// Follow the actual emitted module graph, not every development dependency.
export async function writeRuntimeNotices(meta) {
  const packages = new Map();
  for (const output of Object.values(meta.outputs)) {
    for (const [file, input] of Object.entries(output.inputs || {})) {
      if (!file.startsWith("node_modules/") || !input.bytesInOutput) continue;
      let directory = path.dirname(file);
      let pkg;
      while (directory !== ".") {
        try {
          pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          directory = path.dirname(directory);
        }
      }
      if (!pkg?.name) throw Error(`Cannot identify bundled dependency: ${file}`);
      packages.set(pkg.name, { pkg, directory });
    }
  }
  const fallbacks = {
    "@astryxdesign/core": "licenses/ASTRYX-LICENSE.txt",
    "@stylexjs/stylex": "licenses/STYLEX-LICENSE.txt",
  };
  const sections = [], inventory = [];
  for (const [name, { pkg, directory }] of [...packages].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const files = (await readdir(directory)).filter(file => /^licen[sc]e(?:\.|$)|^copying(?:\.|$)/i.test(file)).sort();
    const sources = files.length ? files.map(file => path.join(directory, file)) : [fallbacks[name]].filter(Boolean);
    if (!sources.length) throw Error(`Missing full license text for bundled dependency ${name}`);
    const texts = await Promise.all(sources.map(file => readFile(file, "utf8")));
    const text = texts.map(s => s.trim()).join("\n\n");
    sections.push(`${name}@${pkg.version}\nDeclared license: ${pkg.license}\n\n${text}`);
    inventory.push({ name, version: pkg.version, declared_license: pkg.license, sources, license_sha256: createHash("sha256").update(text).digest("hex") });
  }
  await writeFile("web/assets/THIRD-PARTY-NOTICES.txt", "Bundled runtime dependency notices\n\n" + sections.join("\n\n----------------------------------------\n\n") + "\n");
  await writeFile("licenses/runtime-packages.json", JSON.stringify(inventory, null, 2) + "\n");
  return inventory;
}
