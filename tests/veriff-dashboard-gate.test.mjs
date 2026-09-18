import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { veriffHostedUrl } from '../src/lib/dancr/veriff-url.ts';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../app/dashboard/DancerAgeVerificationGate.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(verification) {
  const exports = {}; let state = 0;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react') return { ...React, useState: initial => [state++ === 0 ? verification : initial, () => {}], useEffect() {}, useCallback: fn => fn };
    if (name === './dashboard-session') return { requestDashboardJson() { throw new Error('No network while rendering'); } };
    if (name === '@/src/lib/dancr/veriff-url') return { veriffHostedUrl };
    throw new Error(name);
  } });
  return renderToStaticMarkup(exports.default({ children: React.createElement('div', null, 'PRIVATE_DANCER_TOOLS') }));
}
test('loading, failed, pending, and unconfigured required checks do not render dancer tools', () => {
  for (const verification of [null, ...['not_started', 'pending', 'in_review', 'declined'].map(status => ({ required: true, configured: true, status })), { required: true, configured: false, status: 'not_started' }]) {
    const html = render(verification); assert.ok(!html.includes('PRIVATE_DANCER_TOOLS')); assert.ok(html.includes('Verify your age'));
  }
});
test('verified adults and the explicitly inactive rollout retain access', () => {
  for (const verification of [{ required: true, configured: true, status: 'verified' }, { required: false, configured: false, status: 'not_started' }]) assert.ok(render(verification).includes('PRIVATE_DANCER_TOOLS'));
});
test('verification starts only after acknowledgement and in-review sessions do not offer another paid attempt', () => {
  const html = render({ required: true, configured: true, status: 'not_started' });
  assert.match(html, /type="checkbox"/); assert.match(html, /class="button primary" disabled=""/);
  assert.match(html, /Veriff checks your ID and selfie/); assert.ok(!html.includes('Didit'));
  const review = render({ required: true, configured: true, status: 'in_review' });
  assert.ok(!review.includes('button primary')); assert.ok(review.includes('Check verification status'));
});
