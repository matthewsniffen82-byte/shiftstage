import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { adminAttentionItems } from '../app/admin/admin-attention.ts';
import { adminCountLabel } from '../app/admin/admin-workspace-counts.ts';

const require = createRequire(import.meta.url);
const source = readFileSync('app/admin/AdminClient.tsx', 'utf8');
const ast = ts.createSourceFile('AdminClient.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function component(name, globals) {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(node.getText(ast) + `\nexport {${name}};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require, ...globals });
  return exports[name];
}
const operations = (overrides = {}) => ({
  attention: { dancerProfiles: 0, photos: 0, videos: 0, socialLinks: 0, reports: 0, dmca: 0, support: 0, venues: 0, clubRequests: 0, overdue: 0 },
  warnings: [], live: { checkedInDancers: [], missedCheckIns: [] },
  analytics: { totalAccounts: 0, activeDancers: 0, newAccounts7d: 0, profileViews7d: 0, profileViews30d: 0, directionRequests7d: 0, newFollows7d: 0, publishedVideos30d: 0 },
  ...overrides,
});
const Overview = component('OperationsOverview', {
  useState: () => [false, () => {}], adminAttentionItems, adminCountLabel,
  Panel: () => null, Metric: () => null, OperationsList: () => null, SystemHealthSummary: () => null,
  relativeTime: () => 'just now',
});

test('home hides empty queues but keeps failed counts visible and never calls them clear', () => {
  const render = data => renderToStaticMarkup(React.createElement(Overview, { operations: data, onOpenWorkspace() {} }));
  assert.match(render(operations()), /All queues are clear/);
  assert.doesNotMatch(render(operations()), />Photos<|>Videos<|>Copyright cases</);
  const failed = operations({ warnings: [{ section: 'Video moderation', message: 'Unavailable' }] });
  assert.equal(adminAttentionItems(failed).find(item => item.key === 'videos').value, null);
  const html = render(failed);
  assert.match(html, />Videos</);
  assert.match(html, />Unavailable</);
  assert.doesNotMatch(html, /All queues are clear/);
  assert.ok(adminAttentionItems(null).every(item => item.value === null));
});

test('queue shortcuts open their matching review tool, including copyright cases in Tools', () => {
  const routes = { dmca: ['more', 'admin-dmca'], videos: ['approvals', 'admin-tv-review'], photos: ['approvals', 'admin-photo-review'], support: ['more', 'admin-support'], clubRequests: ['approvals', 'admin-club-requests'] };
  const data = operations();
  for (const key of Object.keys(routes)) data.attention[key] = 2;
  const opened = [];
  const tree = Overview({ operations: data, onOpenWorkspace: (...args) => opened.push(args) });
  function nodes(element) {
    if (Array.isArray(element)) return element.flatMap(nodes);
    if (!React.isValidElement(element)) return [];
    return [element, ...nodes(element.props.children)];
  }
  const allNodes = nodes(tree);
  for (const item of adminAttentionItems(data).filter(item => routes[item.key])) {
    const button = allNodes.find(node => node.type === 'button' && node.key === item.key);
    assert.ok(button, item.label);
    button.props.onClick();
    assert.deepEqual(opened.at(-1), routes[item.key]);
    assert.ok(source.includes(`id="${item.panel}"`) || (['admin-dancer-approvals', 'admin-photo-review', 'admin-tv-review'].includes(item.panel) && source.includes('panel = "admin-review-queue"')), 'destination exists or routes to the unified queue');
  }
});

test('closed tools defer child mounting and retain their contents after being opened', () => {
  let opened;
  const Panel = component('Panel', {
    useState: initial => { opened ??= initial; return [opened, value => { opened = value; }]; },
    AdminDashboardIcon: () => null,
  });
  let renders = 0;
  const Child = () => { renders += 1; return React.createElement('input', { defaultValue: 'Unsaved draft' }); };
  const props = { title: 'Deferred tool', children: React.createElement(Child) };
  let tree = Panel(props);
  renderToStaticMarkup(tree);
  assert.equal(renders, 0);
  const nested = { open: true };
  tree.props.onToggle({ target: {}, currentTarget: nested });
  assert.equal(opened, false, 'nested disclosures do not mount the parent tool');
  tree.props.onToggle({ target: nested, currentTarget: nested });
  tree = Panel(props);
  assert.match(renderToStaticMarkup(tree), /Unsaved draft/);
  nested.open = false;
  tree.props.onToggle({ target: nested, currentTarget: nested });
  assert.match(renderToStaticMarkup(Panel(props)), /Unsaved draft/);
  assert.equal(opened, true, 'closing does not discard edits or remount the tool');
});
