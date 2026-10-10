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
const Page = compileVip('app/dancers/[slug]/page.tsx', {
  '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
  '@/src/lib/dancr/public': { getDancerProfile: async () => profile },
  '@/src/lib/dancr/tv': { getPublicMyDancrTvFeed: async () => [] },
  '@/src/lib/dancr/safe-return-path': returnPaths,
  './ProfileNavigationActions': { ProfileCloseButton: 'profile-close-button' },
  'next/navigation': { notFound() { throw Error('Not found'); }, permanentRedirect(href) { throw Object.assign(Error('Redirect'), { href }); } },
}).default;

function nodes(node) {
  return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : [];
}

async function closeProps(returnTo) {
  const tree = await Page({ params: Promise.resolve({ slug: 'aria' }), searchParams: Promise.resolve({ return_to: returnTo }) });
  return nodes(tree).find(node => node.type === 'profile-close-button').props;
}

function navigation(props, { referrer = '', historyLength = 1 } = {}) {
  const assigned = [], timers = new Map(), listeners = new Map();
  let backs = 0;
  const window = {
    location: { origin, href: `${origin}/dancers/aria`, assign: href => assigned.push(href) },
    history: { length: historyLength, back: () => { backs++; } },
    setTimeout: callback => { timers.set(1, callback); return 1; }, clearTimeout: id => timers.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  const { ProfileCloseButton } = compileVip('app/dancers/[slug]/ProfileNavigationActions.tsx', {}, { window, document: { referrer }, URL });
  const button = ProfileCloseButton(props);
  button.props.onClick();
  return { assigned, timers, listeners, button, backs };
}

test('profiles opened from each VIP venue return to that venue planner without referrer or history', async () => {
  const Planner = compileVip('app/vip/VipPlan.tsx', {
    react: { useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }) },
    '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-dashboard': dashboard,
  }).default;
  for (const venue of venues) {
    const tree = Planner({ venue, dancers: [{ ...dancers[0], profileHref: '/dancers/aria' }],
      draft: dashboard.emptyVipDraft(), onChange() {}, onSubmit() {}, onFavorite() {}, favoritePending: [], busy: false });
    const link = nodes(tree).find(node => node.type === 'a');
    assert.equal(link.props.target, '_blank');
    assert.match(link.props.rel, /noreferrer/);
    const requestedReturn = new URL(link.props.href, origin).searchParams.get('return_to');
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

test('profile return destinations reject external, malformed and non-dashboard routes', async () => {
  for (const value of ['https://example.com/vip', '//example.com/vip', '/\\example.com/vip', '/%2fexample.com/vip',
    '/vip/../../auth/callback', '/vip/invite/private-token', '/account', '/v\nip', ['/vip', 'https://example.com']]) {
    const props = await closeProps(value);
    assert.equal(props.vipReturnHref, '', String(value));
    assert.deepEqual(navigation(props).assigned, [`${origin}${fallbackHref}`]);
  }
});

test('renamed profiles preserve the VIP return alongside shared-media parameters', async () => {
  for (const requestedReturn of ['/vip?venueId=venue-2#vip-plan', 'https://example.com/vip']) {
    await assert.rejects(Page({ params: Promise.resolve({ slug: 'old-aria' }), searchParams: Promise.resolve({
      return_to: requestedReturn, media: 'photo', mediaIndex: '2', unrelated: 'discard',
    }) }), error => {
      const url = new URL(error.href, origin);
      assert.equal(url.pathname, '/dancers/aria');
      assert.equal(url.searchParams.get('return_to'), requestedReturn.startsWith('/vip') ? requestedReturn : null);
      assert.equal(url.searchParams.get('media'), 'photo');
      assert.equal(url.searchParams.get('mediaIndex'), '2');
      assert.equal(url.searchParams.has('unrelated'), false);
      return true;
    });
  }
});
