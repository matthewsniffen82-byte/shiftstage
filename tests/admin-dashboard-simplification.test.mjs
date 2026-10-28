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
  attention: { dancerProfiles: 0, photos: 0, videos: 0, socialLinks: 0, reports: 0, dmca: 0, support: 0, venues: 0, clubRequests: 0, dealRequests: 0, clubPageChanges: 0, overdue: 0 },
  warnings: [], live: { checkedInDancers: [], missedCheckIns: [] },
  analytics: { totalAccounts: 0, activeDancers: 0, newAccounts7d: 0, profileViews7d: 0, profileViews30d: 0, directionRequests7d: 0, newFollows7d: 0, publishedVideos30d: 0 },
  ...overrides,
});
const Overview = component('AdminAttentionInbox', {
  useState: () => [false, () => {}], adminAttentionItems, adminCountLabel,
  Panel: () => null, Metric: () => null, OperationsList: () => null, SystemHealthSummary: () => null,
  relativeTime: () => 'just now',
  RefreshButton: () => null,
});

test('home shows pending queues, hides empty queues, and keeps unavailable counts visible', () => {
  const render = data => renderToStaticMarkup(React.createElement(Overview, { operations: data, onOpenWorkspace() {} }));
  assert.match(render(operations()), /All queues are clear/);
  assert.doesNotMatch(render(operations()), />Photos<|>Videos<|>Copyright cases</);
  assert.doesNotMatch(render(operations()), /Messages &amp; support/);
  assert.doesNotMatch(render(operations()), /Club deal requests/);
  assert.doesNotMatch(render(operations()), /Club page changes/);
  const failed = operations({ warnings: [{ section: 'Video moderation', message: 'Unavailable' }] });
  assert.equal(adminAttentionItems(failed).find(item => item.key === 'videos').value, null);
  const html = render(failed);
  assert.match(html, />Videos</);
  assert.match(html, />Unavailable</);
  assert.doesNotMatch(html, /All queues are clear/);
  assert.ok(adminAttentionItems(null).every(item => item.value === null));
});

test('queue shortcuts open their matching review tool, including copyright cases in Tools', () => {
  const routes = { dmca: ['more', 'admin-dmca'], videos: ['approvals', 'admin-tv-review'], photos: ['approvals', 'admin-photo-review'], support: ['more', 'admin-support'], clubRequests: ['clubs', 'admin-club-requests'], dealRequests: ['clubs', 'admin-deal-requests'], clubPageChanges: ['clubs', 'admin-club-page-changes'] };
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
    assert.ok(source.includes(`id="${item.panel}"`) || (["dealRequests", "clubPageChanges"].includes(item.key) && source.includes(item.key === "dealRequests" ? "<AdminClubDealRequests" : "<AdminClubChangeRequests")) || (['admin-dancer-approvals', 'admin-photo-review', 'admin-tv-review'].includes(item.panel) && source.includes('"admin-media-workbench"')), 'destination exists or routes to the matching review queue');
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
  assert.equal(tree.props.open, undefined, 'dashboard tools start collapsed');
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

test('explicit record shortcuts reveal their collapsed dashboard directory', () => {
  let openDancer, revealPanel;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'openDancerManagement') openDancer = node;
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
      && node.arguments[0]?.getText(ast).includes('if (!requestedPanel || !workspaceReady')) revealPanel = node.arguments[0];
    ts.forEachChild(node, find);
  }
  find(ast);
  const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const selected = [], destinations = [];
  vm.runInNewContext(compile(openDancer.getText(ast) + '\nopenDancerManagement("dancer-one");'), {
    setRequestedDancerId: id => selected.push(id), openWorkspace: (...args) => destinations.push(args),
  });
  assert.deepEqual(selected, ['dancer-one']);
  assert.deepEqual(destinations, [['people', 'admin-dancer-management']]);
  class Element { focus() {} scrollIntoView() {} querySelector() { return null; } }
  class Details extends Element { open = false; }
  for (const requestedPanel of ['', 'admin-dancer-management', 'admin-club-unmounted-row']) {
    const dancerDirectory = new Details(), clubDirectory = new Details();
    const elements = { 'admin-dancer-management': dancerDirectory, 'admin-club-accounts': clubDirectory };
    vm.runInNewContext(compile(`(${revealPanel.getText(ast)})();`), {
      requestedPanel, workspace: requestedPanel.startsWith('admin-club-') ? 'clubs' : 'people',
      workspaceReady: true, isLoading: false, state: {}, HTMLElement: Element, HTMLDetailsElement: Details,
      document: { getElementById: id => elements[id] || null },
      window: { requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {} },
    });
    assert.equal(dancerDirectory.open, requestedPanel === 'admin-dancer-management');
    assert.equal(clubDirectory.open, requestedPanel === 'admin-club-unmounted-row');
  }
});
