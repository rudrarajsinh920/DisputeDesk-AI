// Test-only module hooks: compile .tsx with Vite's bundled Oxc transformer and load bare JSON imports,
// so `node --test` can render real components without extra dependencies.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transformWithOxc } from "vite";

// The "@/" alias from tsconfig.json and vite.config.ts (used by the shadcn components), mapped to src/.
const SRC = new URL("../src/", import.meta.url);
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    for (const ext of [".tsx", ".ts"]) {
      const url = new URL(specifier.slice(2) + ext, SRC);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".tsx")) {
    const file = fileURLToPath(url);
    const { code } = await transformWithOxc(await readFile(file, "utf8"), file, { lang: "tsx", jsx: { runtime: "automatic" } });
    return { format: "module", source: code, shortCircuit: true };
  }
  if (url.endsWith(".json") && !context.importAttributes?.type) {
    return { format: "module", source: `export default ${await readFile(fileURLToPath(url), "utf8")};`, shortCircuit: true };
  }
  if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
  return nextLoad(url, context);
}
