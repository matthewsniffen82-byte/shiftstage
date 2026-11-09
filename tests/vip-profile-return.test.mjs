import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip, dancers, venues } from './helpers/vip-dashboard-fixture.mjs';
import * as dashboard from '../src/lib/dancr/vip-dashboard.ts';
import * as types from '../src/lib/dancr/vip-types.ts';
import * as returnPaths from '../src/lib/dancr/safe-return-path.ts';

// Component events and mocked page data only; no browser journeys or network.
const origin = 'https://mydancr.test';
const fallbackHref = '/?city=Las%20Vegas&view=dancers';
const profile = { id: 'dancer-1', slug: 'aria', stageName: 'Aria', city: 'Las Vegas', photos: [], upcomingShifts: [] };
const PublicProfile = compileVip('app/dancers/[slug]/PublicDancerProfile.tsx', {
  './ProfileNavigationActions': { ProfileCloseButton: 'profile-close-button' },
}).default;
const Page = compileVip('app/dancers/[slug]/page.tsx', {
  '@/src/lib/dancr/dancer-profile-media-scope': { dancerProfileMediaVenue: () => undefined },
  '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
  '@/src/lib/dancr/public': { getDancerProfile: async () => profile },
  '@/src/lib/dancr/public-dancer-content': { loadPublicDancerContent: async () => ({ tvVideos: [] }) },
  './PublicDancerProfile': { __esModule: true, default: PublicProfile },
  '@/src/lib/dancr/safe-return-path': returnPaths,
  './ProfileNavigationActions': { ProfileCloseButton: 'profile-close-button' },
  'next/navigation': { notFound() { throw Error('Not found'); }, permanentRedirect(href) { throw Object.assign(Error('Redirect'), { href }); } },
}).default;

function nodes(node) {
  return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : [];
}

async function closeProps(returnTo) {
  const tree = await Page({ params: Promise.resolve({ slug: 'aria' }), searchParams: Promise.resolve({ return_to: returnTo }) });
  return nodes(PublicProfile(tree.props)).find(node => node.type === 'profile-close-button').props;
}

function navigation(props, { referrer = '', historyLength = 1 } = {}) {
  const assigned = [], replaced = [], timers = new Map(), listeners = new Map();
  let backs = 0;
  const window = {
    location: { origin, href: `${origin}/dancers/aria`, assign: href => assigned.push(href), replace: href => replaced.push(href) },
    history: { length: historyLength, back: () => { backs++; } },
    setTimeout: callback => { timers.set(1, callback); return 1; }, clearTimeout: id => timers.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  const { ProfileCloseButton } = compileVip('app/dancers/[slug]/ProfileNavigationActions.tsx', {}, { window, document: { referrer }, URL });
  const button = ProfileCloseButton(props);
  button.props.onClick();
  return { assigned, replaced, timers, listeners, button, backs };
}

test('VIP cards use the homepage profile path and legacy full-page returns still reach the selected venue', async () => {
  const Planner = compileVip('app/vip/VipPlan.tsx', {
    react: { useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect() {} },
    '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-dashboard': dashboard,
  }).default;
  for (const venue of venues) {
    const tree = Planner({ venue, dancers: [{ ...dancers[0], profileHref: '/dancers/aria' }],
      draft: dashboard.emptyVipDraft(), onChange() {}, onSubmit() {}, onFollow() {}, followPending: [], busy: false });
    const link = nodes(tree).find(node => node.type === 'a');
    assert.equal(link.props.target, undefined);
    assert.equal(link.props.href, '/?profile=aria');
    const requestedReturn = `/vip?venueId=${venue.id}#vip-plan`;
    const result = navigation(await closeProps(requestedReturn));
    assert.deepEqual(result.assigned, [`${origin}/vip?venueId=${venue.id}#vip-plan`]);
    assert.equal(result.backs, 0);
    assert.equal(result.timers.size, 0);
    assert.equal(result.button.props['aria-label'], 'Back to VIP dashboard');
  }
});

test('explicit VIP return wins over unrelated same-site history', async () => {
  const result = navigation(await closeProps('/vip?venueId=venue-2#vip-plan'), { referrer: `${origin}/`, historyLength: 4 });
  assert.deepEqual(result.assigned, [`${origin}/vip?venueId=venue-2#vip-plan`]);
  assert.equal(result.backs, 0);
});

test('venue request profiles use the canonical full page and return directly to table requests', async () => {
  const props = await closeProps('/dashboard/venue#table-requests');
  assert.equal(props.vipReturnHref, '');
  assert.equal(props.venueReturnHref, '/dashboard/venue#table-requests');
  const result = navigation(props, { referrer: `${origin}/`, historyLength: 4 });
  assert.deepEqual(result.assigned, [`${origin}/dashboard/venue#table-requests`]);
  assert.equal(result.backs, 0);
  assert.equal(result.button.props['aria-label'], 'Back to club dashboard');
});

test('My dancers profile returns reopen the same venue collection', async () => {
  const result = navigation(await closeProps('/vip?venueId=venue-2#vip-dancers'));
  assert.deepEqual(result.assigned, [`${origin}/vip?venueId=venue-2#vip-dancers`]);
  assert.equal(result.backs, 0);
  assert.equal(result.button.props['aria-label'], 'Back to VIP dashboard');
});

test('ordinary profiles retain browser back and the discovery fallback', async () => {
  const props = await closeProps(undefined);
  assert.equal(props.vipReturnHref, '');
  assert.equal(props.fallbackHref, fallbackHref);
  const direct = navigation(props);
  assert.deepEqual(direct.assigned, [`${origin}${fallbackHref}`]);
  const previous = navigation(props, { referrer: `${origin}/?city=Miami`, historyLength: 2 });
  assert.equal(previous.backs, 1);
  assert.equal(previous.assigned.length, 0);
  previous.listeners.get('pagehide')();
  assert.equal(previous.timers.size, 0);
  const stalled = navigation(props, { referrer: `${origin}/?city=Miami`, historyLength: 2 });
  stalled.timers.get(1)();
  assert.deepEqual(stalled.assigned, [`${origin}${fallbackHref}`]);
});

test('dancer dashboard profile links return to their launch section with or without history', async () => {
  for (const [from, expected] of Object.entries(returnPaths.dancerProfileReturnPaths)) {
    const link = new URL(returnPaths.dancerDashboardProfileHref('aria', from), origin);
    const props = await closeProps(link.searchParams.get('return_to'));
    for (const history of [{}, { referrer: origin + '/', historyLength: 4 }]) {
      const result = navigation(props, history);
      assert.deepEqual(result.replaced, [expected]);
      assert.equal(result.backs, 0);
      assert.equal(result.button.props['aria-label'], 'Back to dancer dashboard');
    }
    const previous = navigation(props, { referrer: new URL(expected, origin).href.split('#')[0], historyLength: 2 });
    assert.equal(previous.backs, 1, 'use the original dashboard entry and its scroll position');
    previous.timers.get(1)();
    assert.deepEqual(previous.replaced, [expected], 'a stalled history return uses the same section');
  }
});

test('profile return destinations reject external, malformed and non-dashboard routes', async () => {
  for (const value of ['https://example.com/vip', '//example.com/vip', '/\\example.com/vip', '/%2fexample.com/vip',
    '/vip/../../auth/callback', '/vip/invite/private-token', '/account', '/dashboard/venue/../../account', '/dashboard/venue/settings', '/dashboard/dancer/other', '/dashboard/dancer?nfc=complete', '/v\nip', ['/vip', 'https://example.com']]) {
    const props = await closeProps(value);
    assert.equal(props.vipReturnHref, '', String(value));
    assert.equal(props.venueReturnHref, '', String(value));
    assert.deepEqual(navigation(props).assigned, [`${origin}${fallbackHref}`]);
  }
});

test('renamed profiles preserve the VIP return alongside shared-media parameters', async () => {
  for (const requestedReturn of ['/vip?venueId=venue-2#vip-plan', '/dashboard/venue#table-requests', returnPaths.dancerProfileReturnPaths.profile, 'https://example.com/vip']) {
    await assert.rejects(Page({ params: Promise.resolve({ slug: 'old-aria' }), searchParams: Promise.resolve({
      return_to: requestedReturn, media: 'photo', mediaIndex: '2', unrelated: 'discard',
    }) }), error => {
      const url = new URL(error.href, origin);
      assert.equal(url.pathname, '/dancers/aria');
      assert.equal(url.searchParams.get('return_to'), requestedReturn.startsWith('/') ? requestedReturn : null);
      assert.equal(url.searchParams.get('media'), 'photo');
      assert.equal(url.searchParams.get('mediaIndex'), '2');
      assert.equal(url.searchParams.has('unrelated'), false);
      return true;
    });
  }
});
