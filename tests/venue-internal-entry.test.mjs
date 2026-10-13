import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function compile(source, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return require(name);
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}

test('the venue dashboard exposes a direct Internal link outside the demo switch', () => {
  const source = ts.createSourceFile('DashboardClient.tsx', read('app/dashboard/DashboardClient.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let entry;
  function find(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className'
      && attribute.initializer?.text === 'venue-internal-entry')) entry = node;
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(entry, 'Internal entry must be visible in the dashboard');
  const ancestors = [];
  for (let parent = entry.parent; parent; parent = parent.parent) ancestors.push(parent);
  assert.ok(ancestors.some(node => ts.isConditionalExpression(node) && node.condition.getText(source) === 'role === "venue"'));
  assert.ok(!ancestors.some(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'VenueDashboardDemoSwitch'));
  assert.ok(ts.isBinaryExpression(entry.parent));
  const { Entry } = compile(`export function Entry(venueAccountPaused: boolean) { return (${entry.parent.getText(source)}); }`);
  const html = renderToStaticMarkup(Entry(false));
  assert.match(html, /href="\/internal"/);
  assert.match(html, /View Internal/);
  assert.match(html, /Live club roster/);
  assert.doesNotMatch(html, /disabled|target="_blank"/);
  assert.equal(renderToStaticMarkup(Entry(true)), '', 'Paused accounts keep their existing recovery flow');
});

test('Internal opens the existing authenticated full roster instead of redirecting to dashboard management', () => {
  const InternalRoster = () => null;
  const Page = compile(read('app/internal/page.tsx'), { './InternalRoster': { InternalRoster } }).default;
  const page = Page();
  assert.equal(page.type, InternalRoster);
  assert.equal(page.props.operationsOnly, undefined);
  assert.equal(page.props.token, undefined, 'The page must use venue authentication, not a table capability');
});
