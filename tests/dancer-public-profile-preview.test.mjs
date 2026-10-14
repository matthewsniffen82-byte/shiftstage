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
  assert.equal(preview.filter(n => n.type === 'Tracker').length, 0);
  assert.equal(preview.find(n => n.type === 'main').props['data-public-dancer-id'], undefined);
  assert.equal(preview.find(n => n.type === 'DancerProfileActions').props.preview, true);
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

function previewFixture({ response = { content: null }, reject = false, props = {} } = {}) {
  let cursor = 0, dirty = true, effects = [], tree;
  const slots = [], requests = [], calls = [];
  const hooks = {
    useState(initial) { const i = cursor++; const slot = slots[i] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, v => { const next = typeof v === 'function' ? v(slot.value) : v; if (!Object.is(slot.value, next)) { slot.value = next; dirty = true; } }]; },
    useRef() { return slots[cursor++] ||= { current: { showModal: () => calls.push('modal') } }; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const component = load('app/dashboard/DancerPublicProfilePreview.tsx', {
    react: hooks, 'react-dom': { createPortal: node => node },
    '@/app/dancers/[slug]/PublicDancerProfile': { default: 'PublicProfile' },
    './dashboard-session': { requestDashboardJson: async (path, options) => { requests.push({ path, options }); if (reject) throw Error('offline'); return response; } },
  }, { document: { activeElement: null, body: { style: { overflow: '' } } }, HTMLElement: class {} }).default;
  const input = { name: 'New name', city: 'Reno', avatarUrl: '/new-avatar.jpg', slug: 'kay', profile: { id: 'owner' }, photos: [{ id: 'new-main', imageUrl: '/new-main.jpg', status: 'approved', isPrimary: true }, { id: 'pending', imageUrl: '/pending.jpg', status: 'pending' }], videos: [{ id: 'ok', status: 'approved', videoUrl: '/ok.mp4' }, { id: 'pending-video', status: 'submitted', videoUrl: '/pending.mp4' }], onClose: () => calls.push('close'), ...props };
  function draw() { dirty = true; for (let i = 0; dirty && i < 20; i++) { dirty = false; cursor = 0; effects = []; tree = component(input); effects.forEach(fn => fn()); } assert.equal(dirty, false); return walk(tree); }
  draw();
  return { requests, calls, draw, async ready() { await new Promise(resolve => setImmediate(resolve)); return draw(); }, close() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('draft identity, explicit photo choices, approved media and crops override saved public data', async () => {
  const f = previewFixture({ response: { content: { profile, tvVideos: [], activeDeals: [] } }, props: { profile: { id: 'owner', avatarPhotoSrcSet: '/avatar-2x.jpg 2x', avatarPhotoFocalX: 32, dancer_photos: [{ id: 'new-main', imageSrcSet: '/main-2x.jpg 2x', focalX: 21, focalY: 44 }] } } });
  const nodes = await f.ready(), view = nodes.find(n => n.type === 'PublicProfile');
  assert.equal(view.props.profile.stageName, 'New name'); assert.equal(view.props.profile.city, 'Reno');
  assert.equal(view.props.profile.followerCount, 23);
  assert.equal(view.props.profile.primaryPhotoUrl, '/new-main.jpg');
  assert.equal(view.props.profile.avatarPhotoUrl, '/new-avatar.jpg');
  assert.equal(view.props.profile.avatarPhotoFocalX, 32);
  assert.equal(view.props.profile.photos[0].focalX, 21);
  assert.equal(view.props.profile.photos[0].imageSrcSet, '/main-2x.jpg 2x');
  assert.deepEqual(Array.from(view.props.profile.photos, p => p.id), ['new-main']);
  assert.deepEqual(Array.from(view.props.tvVideos, p => p.id), ['ok']);
  assert.equal(f.requests[0].options.expectedRole, 'dancer');
  assert.equal(f.requests[0].options.cache, 'no-store');
  assert.equal(f.calls.filter(c => c === 'modal').length, 1);
  nodes.find(n => n.type === 'dialog').props.onCancel({ preventDefault() {} });
  assert.ok(f.calls.includes('close')); f.close();
  assert.equal(f.requests[0].options.signal.aborted, true);
});

test('unpublished drafts preview without publishing and removed slots remain empty', async () => {
  const f = previewFixture({ props: { avatarUrl: '', photos: [{ id: 'gallery', status: 'approved', imageUrl: '/extra.jpg' }] } });
  const view = (await f.ready()).find(n => n.type === 'PublicProfile');
  assert.equal(view.props.profile.avatarPhotoUrl, ''); assert.equal(view.props.profile.primaryPhotoUrl, null);
  assert.equal(view.props.profile.photos.length, 1); assert.equal(view.props.preview, true);
  assert.deepEqual(f.requests.map(r => r.options.method || 'GET'), ['GET']); f.close();
});

test('preview loading errors show a retry without substituting invented public counts', async () => {
  const f = previewFixture({ reject: true }); const nodes = await f.ready();
  assert.ok(nodes.some(n => n.props?.role === 'alert'));
  assert.equal(nodes.some(n => n.type === 'PublicProfile'), false);
  assert.ok(nodes.some(n => n.type === 'button' && n.props.children === 'Retry')); f.close();
});

function apiFixture({ authenticated = true, publicProfile = profile } = {}) {
  const calls = [];
  const query = { select: fields => { calls.push(['select', fields]); return query; }, eq: (key, value) => { calls.push([key, value]); return query; }, maybeSingle: async () => ({ data: { id: 'owner', slug: 'kay' }, error: null }) };
  const api = load('app/api/dancer/profile/preview/route.ts', {
    '@/src/lib/supabase/request': { createRequestSupabaseContext: async (_request, options) => { calls.push(['auth', options]); if (!authenticated) throw Error('unauthorized'); return { user: { id: 'account' }, session: null }; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({ from: table => { calls.push(['table', table]); return query; } }) },
    '@/src/lib/dancr/public': { getDancerProfile: async (_client, slug) => { calls.push(['public', slug]); return publicProfile; } },
    '@/src/lib/dancr/public-dancer-content': { loadPublicDancerContent: async () => { calls.push(['content']); return { activeDeals: [], tvVideos: [] }; } },
    '@/src/lib/api': { apiError: () => Response.json({ ok: false }, { status: 401 }) },
  });
  return { calls, get: () => api.GET(new Request('https://example.test/api/dancer/profile/preview?slug=other')) };
}

test('preview context is authenticated, owner-scoped, read-only and never publicly cached', async () => {
  const f = apiFixture(), response = await f.get();
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.ok(f.calls.some(c => c[0] === 'user_id' && c[1] === 'account'));
  assert.ok(f.calls.some(c => c[0] === 'public' && c[1] === 'kay'));
  assert.equal((await response.json()).content.profile.id, 'owner');
  const unauthorized = apiFixture({ authenticated: false }); assert.equal((await unauthorized.get()).status, 401);
  assert.equal(unauthorized.calls.some(c => c[0] === 'table'), false);
  for (const publicProfile of [null, { ...profile, id: 'someone-else' }]) {
    const hidden = apiFixture({ publicProfile }); assert.equal((await (await hidden.get()).json()).content, null);
    assert.equal(hidden.calls.some(c => c[0] === 'content'), false);
  }
});
