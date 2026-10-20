import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip, guest, venues, state } from './helpers/vip-dashboard-fixture.mjs';
import * as returnPaths from '../src/lib/dancr/safe-return-path.ts';
import * as vipTypes from '../src/lib/dancr/vip-types.ts';

// Isolated component events and mocked API responses; no browser journeys.
function nodes(node) {
  return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : [];
}
function harness({ request, account = guest, returnHref = '/vip?venueId=venue-2#vip-plan' } = {}) {
  const slots = [], calls = [], navigations = [], listeners = new Map();
  let cursor = 0, dirty = true, effects = [], tree, currentAccount = account;
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ||= { value: initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const Component = compileVip('app/dancers/[slug]/VipProfileRequest.tsx', {
    react,
    '@/src/lib/dancr/safe-return-path': returnPaths,
    '@/src/lib/dancr/vip-types': vipTypes,
    '@/app/dashboard/dashboard-session': {
      DASHBOARD_SESSION_KEY: 'auth',
      readSession: () => currentAccount ? { accessToken: 'token', account: currentAccount } : null,
      requestDashboardJson: async (url, options) => {
        calls.push({ url, options });
        if (request) return request(url, options);
        if (options.method === 'POST') {
          const body = JSON.parse(options.body);
          return { ok: true, request: { id: body.requestId, venue_id: body.venueId } };
        }
        return state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: true }] });
      },
    },
  }, { URL, window: {
    location: { assign: href => navigations.push(href) },
    addEventListener: (name, cb) => listeners.set(name, cb),
    removeEventListener: name => listeners.delete(name),
  } }).default;
  const props = { dancerId: 'dancer-1', stageName: 'Aria', returnHref, children: 'Free Entry fallback' };
  function render() {
    dirty = true;
    for (let i = 0; dirty && i < 20; i++) {
      dirty = false; cursor = 0; effects = []; tree = Component(props);
      const node = nodes(tree).find(item => item.type === 'dialog');
      if (node) node.props.ref.current = dialog;
      effects.forEach(cb => cb());
    }
    assert.equal(dirty, false);
  }
  async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } }
  function input(type, value) { nodes(tree).find(item => item.type === 'input' && item.props.type === type).props.onChange({ target: { value } }); render(); }
  const submit = () => nodes(tree).find(item => item.type === 'form').props.onSubmit({ preventDefault() {} });
  render();
  return { calls, navigations, dialog, settle, render, input, submit, tree: () => tree, nodes: () => nodes(tree),
    trigger: () => nodes(tree).find(item => item.props?.['aria-label'] === 'Request Aria'),
    session(next, notify = true) { currentAccount = next; if (notify) listeners.get('storage')?.({ key: 'auth' }); render(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test('VIP profile requests the displayed dancer at the dashboard club and opens Requests after a saved response', async () => {
  const h = harness();
  assert.equal(h.trigger().props.disabled, true);
  await h.settle();
  assert.equal(h.trigger().props.disabled, false);
  assert.equal(h.calls[0].url, '/api/vip?view=dancers&venueId=venue-2');
  h.trigger().props.onClick();
  assert.equal(h.dialog.open, true);
  h.input('date', '2026-12-05'); h.input('time', '21:30');
  await h.submit(); await h.settle();
  const post = h.calls.find(call => call.options.method === 'POST');
  const payload = JSON.parse(post.options.body);
  assert.deepEqual({ ...payload, requestId: undefined }, {
    venueId: 'venue-2', dancerIds: ['dancer-1'], localStart: '2026-12-05T21:30', requestId: undefined,
  });
  assert.match(payload.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(post.options.expectedRole, 'customer');
  assert.deepEqual(h.navigations, ['/vip?venueId=venue-2#vip-requests']);
  await h.submit();
  assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1);
});

test('a missing time stays in the form without submitting or navigating', async () => {
  const h = harness(); await h.settle();
  await h.submit(); h.render();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.navigations, []);
  assert.equal(h.nodes().find(node => node.props?.role === 'alert').props.children, 'Choose a visit date and time.');
});

test('double taps submit once, and an uncertain retry keeps the same request ID', async () => {
  let rejectFirst, posts = 0;
  const h = harness({ request: async (_url, options) => {
    if (options.method !== 'POST') return state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: true }] });
    if (++posts === 1) return new Promise((_, reject) => { rejectFirst = reject; });
    const body = JSON.parse(options.body);
    return { request: { id: body.requestId, venue_id: body.venueId } };
  } });
  await h.settle(); h.input('time', '21:30');
  const pending = h.submit();
  await h.submit();
  assert.equal(posts, 1);
  rejectFirst(new Error('Connection lost'));
  await pending; await h.settle();
  assert.deepEqual(h.navigations, []);
  assert.equal(h.nodes().find(node => node.props?.role === 'alert').props.children, 'Connection lost');
  await h.submit();
  const attempts = h.calls.filter(call => call.options.method === 'POST');
  assert.equal(JSON.parse(attempts[0].options.body).requestId, JSON.parse(attempts[1].options.body).requestId);
  assert.equal(h.navigations.length, 1);
});

test('failure or an unrelated success response never claims a saved request', async () => {
  const h = harness({ request: async (_url, options) => options.method === 'POST'
    ? { request: { id: 'another-request', venue_id: 'venue-1' } }
    : state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: true }] }) });
  await h.settle(); h.input('time', '22:00');
  await h.submit(); await h.settle();
  assert.deepEqual(h.navigations, []);
  assert.match(h.nodes().find(node => node.props?.role === 'alert').props.children, /Unable to confirm/);
});

test('unavailable or historical-only dancers cannot be requested at the selected club', async () => {
  for (const dancers of [[], [{ id: 'dancer-1', canRequest: false, previouslyRequested: true }]]) {
    const h = harness({ request: async () => state('venue-2', { dancers }) });
    await h.settle();
    assert.equal(h.trigger().props.disabled, true);
    await h.submit();
    assert.equal(h.calls.length, 1);
  }
});

test('logged-out, non-customer and non-member profiles retain admission without a VIP mutation', async () => {
  for (const account of [null, { ...guest, role: 'venue' }]) {
    const h = harness({ account }); await h.settle();
    assert.equal(h.tree(), 'Free Entry fallback');
    assert.equal(h.calls.length, 0);
  }
  for (const request of [
    async () => state('venue-1', { venues: [venues[0]] }),
    async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); },
  ]) {
    const h = harness({ request }); await h.settle();
    assert.equal(h.tree(), 'Free Entry fallback');
    assert.equal(h.calls.length, 1);
  }
});

test('malformed and external dashboard contexts cannot select a request club', async () => {
  for (const returnHref of ['', '/vip#vip-plan', '//attacker.test/vip?venueId=venue-2',
    'https://attacker.test/vip?venueId=venue-2', '/dashboard/venue?venueId=venue-2']) {
    const h = harness({ returnHref }); await h.settle();
    assert.equal(h.tree(), 'Free Entry fallback');
    assert.equal(h.calls.length, 0);
  }
});

test('membership read can retry after transient failure', async () => {
  let reads = 0;
  const h = harness({ request: async () => {
    if (++reads === 1) throw Error('Offline');
    return state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: true }] });
  } });
  await h.settle();
  assert.equal(h.trigger().props.disabled, true);
  h.nodes().find(node => node.type === 'button' && node.props.children === 'Retry').props.onClick();
  await h.settle();
  assert.equal(h.trigger().props.disabled, false);
});

test('account changes block old profile submission and discard late results', async () => {
  const h = harness(); await h.settle(); h.input('time', '22:00');
  h.session({ ...guest, id: 'other-guest' }, false);
  await h.submit(); await h.settle();
  assert.equal(h.calls.some(call => call.options.method === 'POST'), false);

  let resolve;
  const pending = harness({ request: async (_url, options) => options.method !== 'POST'
    ? state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: true }] })
    : new Promise(done => { resolve = () => { const body = JSON.parse(options.body); done({ request: { id: body.requestId, venue_id: body.venueId } }); }; }) });
  await pending.settle(); pending.input('time', '22:00');
  const submission = pending.submit();
  pending.session(null); resolve(); await submission; await pending.settle();
  assert.equal(pending.tree(), 'Free Entry fallback');
  assert.equal(pending.calls.at(-1).options.signal.aborted, true);
  assert.deepEqual(pending.navigations, []);
});

test('unmount cancels requests and does not navigate on a late response', async () => {
  let resolve;
  const h = harness({ request: async () => new Promise(done => { resolve = done; }) });
  h.unmount();
  resolve(state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: true }] }));
  await Promise.resolve();
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.deepEqual(h.navigations, []);
});

test('only dashboard VIP profiles replace their primary admission action', () => {
  const Profile = compileVip('app/dancers/[slug]/PublicDancerProfile.tsx', {
    './VipProfileRequest': { __esModule: true, default: 'vip-profile-request' },
    '@/app/components/ClubDealCard': { ClubDealCard: 'club-deal' },
    '@/src/lib/dancr/shift-presence': { isActiveNfcPresence: () => true },
  }).default;
  const props = { profile: { id: 'dancer-1', stageName: 'Aria', city: 'Las Vegas', photos: [],
    upcomingShifts: [{ id: 'shift-1', venueId: 'venue-1', venueSlug: 'club-1', venueName: 'First club', startsAt: '2026-12-05T20:00:00Z' }] },
    tvVideos: [], activeDeals: [{ id: 'deal-1' }] };
  for (const context of [{}, { embedded: true, vipReturnHref: '/vip?venueId=venue-2#vip-plan' },
    { preview: true, vipReturnHref: '/vip?venueId=venue-2#vip-plan' }]) {
    const tree = nodes(Profile({ ...props, ...context }));
    assert.equal(tree.some(node => node.type === 'vip-profile-request'), false);
    assert.equal(tree.find(node => node.type === 'club-deal').props.ctaLabel, 'Free Entry');
  }
  const action = nodes(Profile({ ...props, vipReturnHref: '/vip?venueId=venue-2#vip-plan' }))
    .find(node => node.type === 'vip-profile-request');
  assert.equal(action.props.dancerId, 'dancer-1');
  assert.equal(action.props.returnHref, '/vip?venueId=venue-2#vip-plan');
  assert.equal(nodes(action.props.children).find(node => node.type === 'club-deal').props.ctaLabel, 'Free Entry');
});
