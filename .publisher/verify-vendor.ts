// Checks that the vendored publisher in .publisher/ is exactly what the Living Orthodox lodb kit
// exported: every file listed in VENDOR.json with its SHA-256, and nothing else. Uses only Node.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const vendor = JSON.parse(await readFile(join(directory, "VENDOR.json"), "utf8")) as { files: Record<string, string> };

async function walk(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(child)));
    else result.push(relative(directory, child).split("\\").join("/"));
  }
  return result;
}

const problems: string[] = [];
const present = new Set((await walk(directory)).filter((path) => path !== "VENDOR.json"));
for (const [path, expected] of Object.entries(vendor.files)) {
  if (!present.delete(path)) {
    problems.push(`missing ${path}`);
    continue;
  }
  const actual = createHash("sha256").update(await readFile(join(directory, path))).digest("hex");
  if (actual !== expected) problems.push(`modified ${path}`);
}
for (const path of present) problems.push(`unexpected ${path}`);

if (problems.length > 0) {
  console.error(`The vendored publisher differs from its export; re-export it from the app repository:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Vendored publisher verified (${Object.keys(vendor.files).length} files).`);
