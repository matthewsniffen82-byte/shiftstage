import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

export const refreshButtonModule = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../app/components/RefreshButton.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: refreshButtonModule, require: createRequire(import.meta.url) });
