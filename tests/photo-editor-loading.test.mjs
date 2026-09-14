import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function fixture() {
  const scripts = [], timers = [];
  const source = readFileSync('app/dashboard/profile-photo-crop.ts', 'utf8').replace(/^import .*$/gm, '').replace('export async function', 'async function');
  const context = vm.createContext({ window: {}, DOMException,
    versionedStaticAssetUrl: () => '/profile-photo-crop.js?v=fixture',
    requestDashboardJson() { throw new Error('test must not upload'); },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    document: { createElement: () => ({ remove() { this.removed = true; } }), head: { appendChild: script => scripts.push(script) } },
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, scripts, timers };
}

test('photo editor loads on first use, shares concurrent loads, and retries failed downloads', async () => {
  const f = fixture(); assert.equal(f.scripts.length, 0);
  const first = f.context.loadPhotoEditor();
  assert.equal(f.context.loadPhotoEditor(), first); assert.equal(f.scripts.length, 1);
  const rejected = assert.rejects(first, /Unable to load/); f.scripts[0].onerror(); await rejected;
  assert.equal(f.scripts[0].removed, true);
  const retry = f.context.loadPhotoEditor();
  f.context.window.DancrPhotoCrop = { crop: async () => 'cropped' };
  f.scripts[1].onload(); await retry;
  await f.context.loadPhotoEditor(); assert.equal(f.scripts.length, 2);
});

test('selection cancelled while the editor downloads cannot open a crop dialog or upload', async () => {
  const f = fixture(), controller = new AbortController();
  let opened = false;
  const pending = f.context.cropProfilePhoto({}, controller.signal);
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  controller.abort();
  f.context.window.DancrPhotoCrop = { crop: async () => { opened = true; } };
  f.scripts[0].onload(); await rejected;
  assert.equal(opened, false);
});
