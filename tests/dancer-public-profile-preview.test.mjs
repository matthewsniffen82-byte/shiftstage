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
