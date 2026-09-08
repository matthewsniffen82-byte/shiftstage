import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../../src/lib/dancr/media-review-label.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: compiled.exports });
export const mediaReview = compiled.exports;
