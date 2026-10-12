import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const requireTest = createRequire(import.meta.url);
export function loadMediaRetryComponent({ hooks, api = {}, announce = () => {} } = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../app/dashboard/DancerMediaRetryButton.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, AbortController, Error, require: name => {
    if (name === 'react' && hooks) return hooks;
    if (name === './dashboard-session') return api;
    if (name === './dancer-profile-media-sync') return { announceDancerProfileVideosChanged: announce };
    return requireTest(name);
  } });
  return exports;
}
