import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/lib/dancr/media-visual-provider.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require(name) {
  if (name === 'server-only') return {};
  throw new Error('Unexpected provider dependency: ' + name);
} });
export const { createMediaVisualResponse, MEDIA_VISUAL_MODEL, MEDIA_VISUAL_SERVICE_TIER } = exports;
