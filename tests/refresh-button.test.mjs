import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/components/RefreshButton.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, require: createRequire(import.meta.url) });
const RefreshButton = exports.default;

test('icon-only refresh keeps its accessible name, tooltip and action without submitting a form', () => {
  let clicks = 0;
  const element = RefreshButton({ label: 'Refresh dancers', onClick: () => clicks++, className: 'roster-control', 'data-scope': 'dancers' });
  assert.equal(element.props.type, 'button');
  assert.equal(element.props['aria-label'], 'Refresh dancers');
  assert.equal(element.props.title, 'Refresh dancers');
  assert.equal(element.props['data-scope'], 'dancers');
  assert.match(element.props.className, /roster-control/);
  element.props.onClick();
  assert.equal(clicks, 1);
  const html = renderToStaticMarkup(element);
  assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.doesNotMatch(html, />Refresh dancers</);
});

test('busy refresh is disabled and announced, and caller restrictions remain after loading', () => {
  for (const [busy, disabled, expected] of [[true, false, true], [false, true, true], [false, false, false]]) {
    const button = RefreshButton({ label: 'Refresh requests', busy, disabled });
    assert.equal(button.props.disabled, expected);
    assert.equal(button.props['aria-busy'], busy);
  }
});

test('actions that reload saved edits retain their explanatory text alongside the icon', () => {
  const html = renderToStaticMarkup(RefreshButton({ label: 'Reload saved profile', children: 'Reload saved' }));
  assert.match(html, /class="mydancr-refresh-button has-label"/);
  assert.match(html, /<\/svg>Reload saved<\/button>/);
});
