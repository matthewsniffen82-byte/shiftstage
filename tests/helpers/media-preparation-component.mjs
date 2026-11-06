import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as progress from '../../app/dashboard/media-preparation-progress.ts';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('app/dashboard/DancerMediaPreparationProgress.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

export function loadMediaPreparationComponent({ hooks, window, Date: clock = Date } = {}) {
  const exports = {};
  vm.runInNewContext(code, { exports, window, Date: clock, require: name =>
    name === './media-preparation-progress' ? progress : name === 'react' && hooks ? hooks : require(name) });
  return exports;
}
