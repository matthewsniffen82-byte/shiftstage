import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';
import ts from 'typescript';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/live-shell/app/26-sync-discovery-city-scope.js');
const ast = ts.createSourceFile('startup.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const openShared = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'openSharedProfileFromUrl').getText(ast);
const startup = ast.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === 'internalProfileFrameId').getText(ast);
const sharedAst = ts.createSourceFile('shared.tsx', read('app/dashboard/DashboardShared.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const linkHelper = sharedAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'customerDancerHref').getText(sharedAst);
const exports = {};
vm.runInNewContext(ts.transpileModule(linkHelper, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, encodeURIComponent });
const guestProfileHref = exports.customerDancerHref({ city: 'Las Vegas', slug: 'luna' });

function fixture({ search = new URL(guestProfileHref, 'https://example.test').search,
  profiles = [{ id: 'dancer-1', slug: 'luna', name: 'Luna', approved: true }], cityExists = true,
  auth = false, embedded = false, openFails = false, redirectFails = false } = {}) {
  const classes = new Set(), calls = [];
  const covered = () => classes.has('dancer-profile-bootstrap');
  const document = {
    documentElement: { classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
    }, style: { setProperty() {} } },
    readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [],
    createElement: () => ({}), head: { append() {} },
  };
  let release, reject;
  const discovery = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  const window = {
    location: { search, origin: 'https://example.test', replace(href) {
      if (redirectFails) throw new Error('Navigation unavailable');
      calls.push({ type: 'redirect', href, covered: covered() });
    } }, addEventListener() {},
  };
  window.parent = embedded ? {} : window;
  const context = vm.createContext({
    URLSearchParams, URL, document, window, navigator: { userAgent: 'Android Mobile' },
    discoveryMarket: () => cityExists ? { dancers: profiles } : null,
    citySelect: {}, activeTab: 'dancers',
    isApprovedPublicProfile: profile => profile.approved,
    slugify: name => name.toLowerCase().replaceAll(' ', '-'),
    profileReferenceValue: profile => profile.id,
    openProfileModal(id) {
      if (openFails) throw new Error('Profile unavailable');
      calls.push({ type: 'profile', id, covered: covered() });
    },
    openSharedProfileMedia(params) { calls.push({ type: 'media', mode: params.get('media'), covered: covered() }); },
    render() { calls.push({ type: 'directory', covered: covered() }); },
    showToast(message) { calls.push({ type: 'toast', message }); },
    setTimeout() { throw new Error('Profile entry must not wait for a timer'); },
    initialDiscoveryRequest: discovery, initialVenuePreviewRequest: null, restoredAuthResume: auth, internalProfileFrameId: '',
    handleVenueDancerVerificationDeepLink: () => false, handleAdminDashboardDeepLink: () => false,
    handleVenueDashboardDeepLink: () => false, handleDancerDashboardDeepLink: () => false,
    handleVenueAccessDeepLink: () => false, handleAccountAccessDeepLink: () => false,
  });
  vm.runInContext(read('src/live-shell/device-bootstrap.js'), context);
  return { classes, calls, covered, start() { vm.runInContext(`${openShared}\n${startup}`, context); },
    async finish(failed = false) { if (failed) reject(new Error('Discovery unavailable')); else release(); await new Promise(resolve => setImmediate(resolve)); } };
}

test('guest dashboard profile links cover the homepage before discovery finishes', async () => {
  assert.equal(guestProfileHref, '/?city=Las%20Vegas&profile=luna');
  const f = fixture();
  assert.equal(f.covered(), true);
  f.start();
  assert.deepEqual(f.calls, []);
  assert.equal(f.covered(), true);
  await f.finish();
  assert.deepEqual(f.calls, [
    { type: 'directory', covered: true },
    { type: 'profile', id: 'dancer-1', covered: true },
    { type: 'media', mode: null, covered: true },
  ]);
  assert.equal(f.covered(), false);
});

test('shared photos open before uncovering and legacy stage-name links still resolve', async () => {
  const f = fixture({ search: '?city=Las+Vegas&profile=luna&media=photo&mediaIndex=2', profiles: [{ id: 'dancer-1', name: 'Luna', approved: true }] });
  f.start(); await f.finish();
  assert.deepEqual(f.calls.at(-1), { type: 'media', mode: 'photo', covered: true });
  assert.equal(f.covered(), false);
});

test('missing or unapproved dancers keep the cover during the approval-checked public-route handoff', async () => {
  for (const profiles of [[], [{ id: 'private', slug: 'luna', approved: false }]]) {
    const f = fixture({ profiles, search: '?city=Las+Vegas&profile=luna&media=photo&mediaIndex=2' });
    f.start(); await f.finish();
    assert.deepEqual(f.calls.at(-1), { type: 'redirect', href: 'https://example.test/dancers/luna?media=photo&mediaIndex=2', covered: true });
    assert.equal(f.covered(), true);
    assert.equal(f.calls.some(call => call.type === 'profile'), false);
  }
});

test('discovery rejection still resolves the profile and rendering or navigation errors release the cover', async () => {
  const cached = fixture(); cached.start(); await cached.finish(true);
  assert.ok(cached.calls.some(call => call.type === 'profile'));
  assert.equal(cached.covered(), false);
  for (const options of [{ openFails: true }, { profiles: [], redirectFails: true }]) {
    const f = fixture(options); f.start(); await f.finish();
    assert.equal(f.covered(), false);
    assert.equal(f.calls.at(-1).type, 'toast');
  }
});

test('normal entry, private embeds, invalid links and auth overrides never leave a profile cover stuck', async () => {
  for (const search of ['', '?city=Las+Vegas&view=dancers', '?city=Las+Vegas&profile=']) {
    assert.equal(fixture({ search }).covered(), false);
  }
  const embedded = fixture({ embedded: true, search: '?city=Las+Vegas&profile=luna&internal_profile=dancer-1' });
  assert.ok(embedded.classes.has('internal-profile-embed'));
  assert.equal(embedded.covered(), false);
  for (const options of [{ cityExists: false }, { search: '?profile=luna' }, { search: '?city=Las+Vegas&profile=../bad' }, { auth: true }]) {
    const f = fixture(options); f.start(); await f.finish();
    assert.equal(f.covered(), false);
    assert.equal(f.calls.some(call => call.type === 'profile' || call.type === 'redirect'), false);
  }
});

test('the initial profile cover hides homepage content and respects reduced motion', () => {
  const css = postcss.parse(read('src/live-shell/styles/base-styles-01-root.css'));
  const rules = [];
  css.walkRules(rule => rules.push(rule));
  const content = rules.find(rule => rule.selectors.includes('html.dancer-profile-bootstrap body > *'));
  assert.ok(content.nodes.some(node => node.prop === 'visibility' && node.value === 'hidden' && node.important));
  const label = rules.find(rule => rule.selector === 'html.dancer-profile-bootstrap body::before');
  assert.ok(label.nodes.some(node => node.prop === 'content' && node.value === '"Loading dancer profile"'));
  const reduced = rules.find(rule => rule.parent.params === '(prefers-reduced-motion: reduce)' && rule.selectors.includes('html.dancer-profile-bootstrap body::after'));
  assert.ok(reduced.nodes.some(node => node.prop === 'animation' && node.value === 'none'));
});
