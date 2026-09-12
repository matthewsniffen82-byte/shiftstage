import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../..");

// Execute the actual route, transforms and generated version modules. Only the
// process environment and file reader are wrapped to exercise artifact lifetime.
export function liveShellRoute({ production = true, failures = 0 } = {}) {
  const reads = [], modules = new Map();
  const read = async (...args) => {
    reads.push(path.relative(root, args[0]).replaceAll("\\", "/"));
    if (failures > 0) { failures--; throw new Error("Synthetic artifact read failure"); }
    return readFile(...args);
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    if (!/\.tsx?$/.test(file)) return nativeRequire(file);
    const exports = {}; modules.set(file, exports);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports, Response, URL, Buffer,
      process: { cwd: () => root, env: { NODE_ENV: production ? "production" : "development" } },
      require(name) {
        if (name === "node:fs/promises") return { readFile: read };
        if (!name.startsWith(".")) return nativeRequire(name);
        const base = path.resolve(path.dirname(file), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`].find(existsSync);
        if (!resolved) throw new Error(`Unresolved route dependency ${name}`);
        return load(resolved);
      },
    }, { filename: file });
    return exports;
  }
  return { route: load(path.join(root, "app/route.ts")), reads };
}
