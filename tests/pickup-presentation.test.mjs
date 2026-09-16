import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as domain from '../src/lib/dancr/pickup-domain.ts';

const require = createRequire(import.meta.url), exports = {};
const compiled = ts.transpileModule(readFileSync(new URL('../app/pickups/PickupProgress.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(compiled, { exports, require: name => name.endsWith('/pickup-domain') ? domain : require(name), Date });
const render = (status, extra = {}) => renderToStaticMarkup(createElement(exports.default, { request: {
  status, expires_at: '2099-01-01T00:00:00Z', vehicle_dispatched_at: null, ...extra,
} }));

test('pickup progress announces the real stage and never promises a confirmed ride while requested', () => {
  assert.match(render('requested'), /Waiting for the venue to confirm pickup/);
  for (const [status, step] of [['requested','Requested'],['accepted','Accepted'],['vehicle_dispatched','On the way'],['arriving','On the way'],['arrived','Arrived'],['completed','Completed']]) {
    const html = render(status, { vehicle_dispatched_at: '2026-09-15T00:00:00Z' });
    assert.match(html, new RegExp(`aria-current="step"[^>]*>.*?<span>${step}</span>`));
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  }
});

test('closed and timed-out pickups do not imply that a vehicle is still on its way', () => {
  for (const status of ['cancelled', 'no_show', 'expired']) {
    const html = render(status);
    assert.match(html, /data-tone="closed"/);
    assert.ok(!html.includes('<ol>'));
    assert.ok(!html.includes('aria-current'));
  }
  const elapsed = { expires_at: '2000-01-01T00:00:00Z' };
  assert.match(render('vehicle_dispatched', elapsed), /Expired/);
  assert.ok(!render('vehicle_dispatched', elapsed).includes('<ol>'));
  assert.match(render('completed', elapsed), /Pickup completed/);
  assert.match(render('cancelled', elapsed), /This pickup was cancelled/);
});

test('direct arrival preserves a missing dispatch update rather than inventing a vehicle journey', () => {
  for (const status of ['arrived', 'completed']) {
    assert.match(render(status), /data-state="skipped"/);
    assert.match(render(status), /no dispatch update recorded/);
    assert.ok(!render(status, { vehicle_dispatched_at: '2026-09-15T00:00:00Z' }).includes('data-state="skipped"'));
  }
});
