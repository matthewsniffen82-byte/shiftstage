import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('app/components/StableVideo.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

export function loadStableVideo(hooks = require('react')) {
  const exports = {};
  vm.runInNewContext(code, { exports, URL, require: name => name === 'react' ? { ...require('react'), ...hooks } : require(name) });
  return exports;
}

export const stableVideo = loadStableVideo();
