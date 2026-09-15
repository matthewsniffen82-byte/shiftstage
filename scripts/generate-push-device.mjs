import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

// Keep the discovery shell's device enrollment identical to the dashboard's.
const source = await readFile(new URL("../src/lib/dancr/customer-push.ts", import.meta.url), "utf8");
const output = "// Generated from src/lib/dancr/customer-push.ts. Do not edit.\n" + ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const target = new URL("../public/mydancr-push-device.js", import.meta.url);
if (await readFile(target, "utf8").catch(() => "") !== output) await writeFile(target, output);
