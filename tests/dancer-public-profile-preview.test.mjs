import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { isActiveNfcPresence } from '../src/lib/dancr/shift-presence.ts';

const require = createRequire(import.meta.url);
const jsx = (type, props) => ({ type, props });
function load(path, modules = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, AbortController, URLSearchParams, console,
    require: name => modules[name] || (name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'next/server' ? require(name) : {}), ...globals,
  });
  return exports;
}
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
const profile = { id: 'owner', slug: 'kay', stageName: 'Kay', city: 'Las Vegas', avatarPhotoUrl: '/face.jpg', primaryPhotoUrl: '/main.jpg', photos: [{ id: 'main', imageUrl: '/main.jpg', isPrimary: true, sortOrder: 0 }], upcomingShifts: [], followerCount: 23, goingCount: 4, profileViewsToday: 8 };
const publicModules = {
  '@/src/lib/dancr/shift-presence': { isActiveNfcPresence },
  '@/src/lib/dancr/image-focal-point': { imageFocalPointCss: (x, y) => `${x}% ${y}%` },
  './DancerProfileActions': Object.fromEntries(['DancerFollowStateProvider', 'DancerFollowerMetric', 'DancerGoingCount', 'DancerProfileActions', 'DancerReportControl', 'DancerWorkingAlertHint'].map(name => [name, name])),
  './DancerPhotoCarousel': { DancerPhotoCarousel: 'Gallery' },
  './ProfileNavigationActions': { ProfileCloseButton: 'Close', ProfileShareButton: 'Share' },
  './ProfileViewTracker': { ProfileViewTracker: 'Tracker' },
  '@/app/components/ClubDealCard': { ClubDealCard: 'Deal' },
};
const PublicProfile = load('app/dancers/[slug]/PublicDancerProfile.tsx', publicModules).default;

test('public page and preview render identical profile layout, media and activity counts', () => {
  const live = walk(PublicProfile({ profile, tvVideos: [] }));
  const preview = walk(PublicProfile({ profile, tvVideos: [], preview: true }));
  const layout = nodes => nodes.filter(n => n.props?.className).map(n => [n.type, n.props.className]);
  assert.deepEqual(layout(preview), layout(live));
  assert.equal(preview.find(n => n.type === 'DancerFollowStateProvider').props.initialFollowerCount, 23);
  assert.equal(preview.find(n => n.type === 'Gallery').props.featured, true);
  assert.deepEqual(preview.find(n => n.type === 'Gallery').props.photos, live.find(n => n.type === 'Gallery').props.photos);
  assert.equal(preview.find(n => n.type === 'Gallery').props.preview, true);
  assert.equal(live.filter(n => n.type === 'Tracker').length, 1);
  assert.equal(live.find(n => n.type === 'main').props['data-profile-layout'], 'portrait-details');
  assert.equal(preview.find(n => n.type === 'main').props['data-profile-layout'], undefined);
  assert.equal(preview.filter(n => n.type === 'Tracker').length, 0);
  assert.equal(preview.find(n => n.type === 'main').props['data-public-dancer-id'], undefined);
  assert.equal(preview.find(n => n.type === 'DancerProfileActions').props.preview, true);
});

test('public profile retains the daily view count, including zero and unavailable counts', () => {
  for (const [profileViewsToday, metricsUnavailable, expected] of [[1234, false, '1,234'], [0, false, '0'], [12, true, '—']]) {
    const nodes = walk(PublicProfile({ profile: { ...profile, profileViewsToday, metricsUnavailable }, tvVideos: [] }));
    const metrics = nodes.filter(node => node.props?.['data-profile-metric']);
    assert.deepEqual(metrics.map(node => node.props['data-profile-metric']), ['followers', 'going', 'views']);
    const views = walk(metrics.find(node => node.props['data-profile-metric'] === 'views'));
    assert.equal(views.find(node => node.type === 'dd').props.children, expected);
    assert.equal(views.find(node => node.type === 'dt').props.children, 'Views today');
  }
});

test('preview does not fill a missing avatar from another photo', () => {
  const nodes = walk(PublicProfile({ profile: { ...profile, avatarPhotoUrl: '' }, tvVideos: [], preview: true }));
  assert.equal(nodes.some(n => n.type === 'img'), false);
  assert.equal(nodes.find(n => n.type === 'Gallery').props.viewerAvatar.url, '');
});

test('public rendering keeps the server boundary and does not serialize the entire profile', () => {
  assert.doesNotMatch(readFileSync('app/dancers/[slug]/PublicDancerProfile.tsx', 'utf8'), /^['"]use client['"]/);
  const tree = PublicProfile({ profile: { ...profile, privateFutureField: 'must-stay-server-side', shiftEndsAt: 'private-exit-time' }, tvVideos: [] });
  assert.doesNotMatch(JSON.stringify(tree), /must-stay-server-side|private-exit-time/);
});

test('preview follow, going, report and share controls cannot load customer state or write engagement', () => {
  const effects = [], writes = [], setters = [];
  const context = { mediaFollowAction: { current: null }, setMediaFollowState() {}, setFollowedBy() {}, setFollowerCount() {}, setNotificationCount() {}, setGoingCount() {} };
  const hooks = {
    createContext: () => ({}), useContext: () => context,
    useRef: value => ({ current: value }), useState: value => [value, v => setters.push(v)],
    useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
  };
  const globals = { fetch: (...args) => { writes.push(args); throw Error('Preview cannot make engagement requests'); } };
  const actions = load('app/dancers/[slug]/DancerProfileActions.tsx', { react: hooks }, globals);
  const nodes = walk(actions.DancerProfileActions({ dancerId: 'owner', shifts: [{ id: 'shift', isActive: true }], preview: true }));
  effects.splice(0).forEach(fn => fn());
  nodes.find(n => n.props?.['data-follow-control'] === 'text').props.onClick();
  nodes.find(n => n.props?.className?.includes('profile-action-going')).props.onClick();
  context.mediaFollowAction.current();
  const report = walk(actions.DancerReportControl({ dancerId: 'owner', profileName: 'Kay', preview: true }));
  const before = setters.length;
  report.find(n => n.type === 'button').props.onClick();
  assert.equal(setters.length, before);
  const navigation = load('app/dancers/[slug]/ProfileNavigationActions.tsx', { react: hooks }, globals);
  const share = walk(navigation.ProfileShareButton({ dancerId: 'owner', stageName: 'Kay', preview: true }));
  share.find(n => n.type === 'button').props.onClick();
  assert.equal(setters.length, before); assert.equal(writes.length, 0);
});

function embeddedActionsFixture(preview, initiallyGoing = false) {
  const slots = [], effects = [], requests = [], counts = [];
  let cursor = 0;
  const context = { mediaFollowAction: { current: null }, setMediaFollowState() {}, setFollowedBy() {}, setFollowerCount() {}, setNotificationCount() {}, setGoingCount: count => counts.push(count) };
  const hooks = {
    createContext: () => ({}), useContext: () => context,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo: fn => fn(),
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (deps && previous && deps.every((value, index) => Object.is(value, previous.deps[index]))) return;
      effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    },
  };
  let respond = async (_url, init) => ({ ok: true, json: async () => ({ ok: true,
    going: init.method === 'POST' ? JSON.parse(init.body).going : initiallyGoing,
    goingCount: init.method === 'POST' ? (JSON.parse(init.body).going ? 5 : 4) : 4,
  }) });
  const actions = load('app/dancers/[slug]/DancerProfileActions.tsx', {
    react: hooks,
    '@/src/lib/dancr/browser-session': { readBrowserAccessToken: () => '' },
  }, { fetch: (url, init) => { requests.push({ url, ...init }); return respond(url, init); } });
  const tree = walk(PublicProfile({ profile: { ...profile, upcomingShifts: [{ id: 'posted-shift', startsAt: '2026-10-21T01:00:00Z', endsAt: '2026-10-22T10:00:00Z' }] }, tvVideos: [], preview, embedded: true }));
  const props = tree.find(node => node.type === 'DancerProfileActions').props;
  const render = () => { cursor = 0; const nodes = walk(actions.DancerProfileActions(props)); effects.splice(0).forEach(effect => effect()); return nodes; };
  const button = () => render().find(node => node.type === 'button' && node.props.className?.includes('profile-action-going'));
  return { requests, counts, props, tree, render, button,
    click: () => button().props.onClick(),
    respondWith(fn) { respond = fn; },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); render(); },
  };
}

for (const preview of [false, true]) test(`embedded Going loads, saves, updates its count and cancels (preview=${preview})`, async () => {
  const f = embeddedActionsFixture(preview);
  assert.equal(f.props.preview, false, 'embedded visit actions must load and save even in the Rhino showcase');
  assert.equal(f.props.showSocialActions, false);
  assert.equal(f.tree.find(node => node.type === 'Gallery').props.preview, preview, 'media previews retain their behavior');
  assert.equal(f.button().props.disabled, true, 'wait for the saved selection before allowing a toggle');
  await f.settle();
  assert.equal(f.requests[0].url, '/api/customer/going?shiftId=posted-shift');
  assert.equal(f.button().props.disabled, false);
  await f.click();
  assert.deepEqual(JSON.parse(f.requests[1].body), { shiftId: 'posted-shift', going: true });
  assert.equal(f.requests[1].credentials, 'same-origin');
  assert.equal(f.button().props['aria-pressed'], true);
  assert.equal(f.counts.at(-1), 5);
  await f.click();
  assert.deepEqual(JSON.parse(f.requests[2].body), { shiftId: 'posted-shift', going: false });
  assert.equal(f.button().props['aria-pressed'], false);
  assert.equal(f.counts.at(-1), 4);
  assert.equal(f.requests.length, 3);
});

test('embedded Going restores an existing selection and prevents duplicate taps while saving', async () => {
  const f = embeddedActionsFixture(true, true);
  f.render(); await f.settle();
  assert.equal(f.button().props['aria-pressed'], true);
  let resolve;
  f.respondWith(() => new Promise(done => { resolve = done; }));
  const pending = f.click();
  assert.equal(f.button().props.disabled, true);
  assert.equal(f.button().props['aria-busy'], true);
  await f.click();
  assert.equal(f.requests.length, 2);
  resolve({ ok: false, json: async () => ({ ok: false, error: 'Please try again.' }) });
  await pending;
  assert.equal(f.button().props['aria-pressed'], true, 'failed cancellation must restore the saved selection');
  assert.equal(f.button().props.disabled, false);
  assert.equal(f.render().find(node => node.props?.role === 'status').props.children, 'Please try again.');
  assert.equal(f.counts.at(-1), 4);
});
