import assert from 'node:assert/strict';
import test from 'node:test';
import { compileVip, dashboardHarness, guest, venues, state } from './helpers/vip-dashboard-fixture.mjs';
import * as returnPaths from '../src/lib/dancr/safe-return-path.ts';
import * as draftStorage from '../src/lib/dancr/vip-draft-storage.ts';

// Isolated component events and mocked reads; no browser journeys.
function nodes(node) {
  return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : [];
}
function storageAdapter(values) {
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function harness({ request, account = guest, returnHref = '/vip?venueId=venue-2#vip-plan', values = new Map(), localStorage = storageAdapter(values) } = {}) {
  const slots = [], calls = [], navigations = [], listeners = new Map();
  let cursor = 0, dirty = true, effects = [], tree, currentAccount = account;
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
    '@/src/lib/dancr/vip-draft-storage': draftStorage,
    '@/app/dashboard/dashboard-session': {
      DASHBOARD_SESSION_KEY: 'auth',
      readSession: () => currentAccount ? { accessToken: 'token', account: currentAccount } : null,
      requestDashboardJson: async (url, options) => {
        calls.push({ url, options });
        return request ? request(url, options) : state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: true }] });
      },
    },
  }, { URL, window: {
    localStorage, location: { assign: href => navigations.push(href) },
    addEventListener: (name, cb) => listeners.set(name, cb),
    removeEventListener: name => listeners.delete(name),
  } }).default;
  const props = { dancerId: 'dancer-1', stageName: 'Aria', returnHref, children: 'Free Entry fallback' };
  function render() {
    dirty = true;
    for (let i = 0; dirty && i < 20; i++) {
      dirty = false; cursor = 0; effects = []; tree = Component(props);
      effects.forEach(cb => cb());
    }
    assert.equal(dirty, false);
  }
  async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } }
  render();
  return { calls, navigations, values, settle, render, tree: () => tree, nodes: () => nodes(tree),
    trigger: () => nodes(tree).find(item => item.props?.['aria-label'] === 'Request Aria'),
    session(next, notify = true) { currentAccount = next; if (notify) listeners.get('storage')?.({ key: 'auth' }); render(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test('profile Request adds to the existing Quick Add queue and preserves visit details and other clubs', async () => {
  const values = new Map(), storage = storageAdapter(values);
  const otherClub = { selected: ['dancer-3'], date: '2026-12-06', time: '22:00' };
  draftStorage.saveVipWorkspace(storage, guest.id, { drafts: {
    'venue-1': otherClub, 'venue-2': { selected: ['dancer-2'], date: '2026-12-05', time: '21:30' },
  }, retries: {} });
  const h = harness({ values });
  assert.equal(h.trigger().props.disabled, true);
  await h.settle();
  assert.equal(h.trigger().props.disabled, false);
  h.trigger().props.onClick(); h.render();
  const workspace = draftStorage.readVipWorkspace(storage, guest.id);
  assert.deepEqual(workspace.drafts['venue-2'], { selected: ['dancer-2', 'dancer-1'], date: '2026-12-05', time: '21:30' });
  assert.deepEqual(workspace.drafts['venue-1'], otherClub);
  assert.deepEqual(h.navigations, [], 'stay on the profile until the guest uses Back');
  assert.equal(h.nodes().some(node => node.props?.children === 'Added to request queue'), true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, undefined, 'the profile never submits a separate request');
  assert.equal(h.nodes().some(node => ['dialog', 'form', 'input'].includes(node.type)), false);
  assert.equal(h.trigger().props.disabled, true);
});

test('adding from multiple profiles reads the latest queue and never duplicates a dancer', async () => {
  const values = new Map(), storage = storageAdapter(values);
  const first = harness({ values }), second = harness({ values });
  await first.settle(); await second.settle();
  draftStorage.queueVipProfileDancer(storage, guest.id, 'venue-2', 'dancer-2');
  first.trigger().props.onClick();
  second.trigger().props.onClick();
  first.trigger().props.onClick();
  assert.deepEqual(draftStorage.readVipWorkspace(storage, guest.id).drafts['venue-2'].selected, ['dancer-2', 'dancer-1']);
  assert.equal(first.navigations.length, 0);
  assert.equal(second.navigations.length, 0);
});

test('a full queue is preserved, with a link back to change it', async () => {
  const values = new Map(), storage = storageAdapter(values);
  const selected = Array.from({ length: 10 }, (_, i) => `other-${i}`);
  draftStorage.saveVipWorkspace(storage, guest.id, { drafts: { 'venue-2': { selected, date: '', time: '' } }, retries: {} });
  const h = harness({ values }); await h.settle();
  h.trigger().props.onClick(); h.render();
  assert.deepEqual(draftStorage.readVipWorkspace(storage, guest.id).drafts['venue-2'].selected, selected);
  assert.match(h.nodes().find(node => node.props?.role === 'alert').props.children, /already has 10 dancers/);
  assert.equal(h.nodes().find(node => node.type === 'a').props.href, '/vip?venueId=venue-2#vip-plan');
  assert.deepEqual(h.navigations, []);
  assert.equal(draftStorage.addVipDraftDancer({ selected, date: '', time: '' }, 'other-0').selected.length, 10);
});

test('failed browser storage does not claim that the dancer was queued', async () => {
  for (const operation of ['getItem', 'setItem']) {
    const values = new Map(), localStorage = storageAdapter(values);
    localStorage[operation] = () => { throw Error('Storage blocked'); };
    const h = harness({ values, localStorage }); await h.settle();
    h.trigger().props.onClick(); h.render();
    assert.equal(h.navigations.length, 0);
    assert.ok(h.nodes().find(node => node.props?.role === 'alert'));
    assert.equal(h.trigger().props.disabled, false);
  }
});

test('queue updates invalidate only the changed club retry and are scoped to the signed-in account', () => {
  const values = new Map(), storage = storageAdapter(values);
  const draft = { selected: ['dancer-2'], date: '2026-12-05', time: '21:00' };
  const retry = venueId => ({ id: '97000000-0000-4000-8000-000000000001', fingerprint: draftStorage.vipDraftFingerprint(venueId, draft) });
  draftStorage.saveVipWorkspace(storage, guest.id, { drafts: { 'venue-1': draft, 'venue-2': draft },
    retries: { 'venue-1': retry('venue-1'), 'venue-2': retry('venue-2') } });
  draftStorage.saveVipWorkspace(storage, 'another-guest', { drafts: { 'venue-2': draft }, retries: {} });
  const otherAccount = values.get(draftStorage.VIP_DRAFT_PREFIX + 'another-guest');
  draftStorage.queueVipProfileDancer(storage, guest.id, 'venue-2', 'dancer-1');
  const result = draftStorage.readVipWorkspace(storage, guest.id);
  assert.equal(result.retries['venue-2'], undefined);
  assert.deepEqual(result.retries['venue-1'], retry('venue-1'));
  assert.equal(values.get(draftStorage.VIP_DRAFT_PREFIX + 'another-guest'), otherAccount);
});

test('open dashboards pick up profile additions, keep Quick Add dancers and submit them together', async () => {
  const values = new Map(), storage = storageAdapter(values);
  const dashboard = dashboardHarness({ initialVenueId: 'venue-2', storage: values });
  await dashboard.settle(); dashboard.navigate('plan'); await dashboard.settle();
  dashboard.planner().props.onChange({ selected: ['dancer-2'], date: '2026-12-05', time: '21:30' });
  dashboard.render();
  const profile = harness({ values }); await profile.settle(); profile.trigger().props.onClick();
  dashboard.event('storage', { key: draftStorage.VIP_DRAFT_PREFIX + guest.id }); await dashboard.settle();
  assert.deepEqual([...dashboard.planner().props.draft.selected], ['dancer-2', 'dancer-1']);
  assert.equal(dashboard.planner().props.draft.time, '21:30');
  dashboard.event('storage', { key: draftStorage.VIP_DRAFT_PREFIX + 'another-guest' });
  assert.deepEqual([...dashboard.planner().props.draft.selected], ['dancer-2', 'dancer-1']);
  const before = values.get(draftStorage.VIP_DRAFT_PREFIX + guest.id);
  dashboard.event('storage', { key: draftStorage.VIP_DRAFT_PREFIX + guest.id });
  assert.equal(values.get(draftStorage.VIP_DRAFT_PREFIX + guest.id), before, 'identical storage events do not trigger a write loop');
  await dashboard.planner().props.onSubmit(); await dashboard.settle();
  const post = dashboard.calls.find(call => call.options.method === 'POST');
  assert.deepEqual(JSON.parse(post.options.body).dancerIds, ['dancer-1', 'dancer-2']);
  assert.equal(JSON.parse(post.options.body).localStart, '2026-12-05T21:30');
  assert.deepEqual(draftStorage.readVipWorkspace(storage, guest.id).drafts, {});
});

test('dancers added while a group request is being sent remain queued for the next visit', async () => {
  let resolve;
  const values = new Map(), storage = storageAdapter(values);
  const dashboard = dashboardHarness({ initialVenueId: 'venue-2', hash: '#vip-plan', storage: values,
    request: async (_url, options) => options.method === 'POST' ? new Promise(done => { resolve = done; }) : state('venue-2') });
  await dashboard.settle();
  dashboard.planner().props.onChange({ selected: ['dancer-2'], date: '2026-12-05', time: '21:30' }); dashboard.render();
  const pending = dashboard.planner().props.onSubmit();
  draftStorage.queueVipProfileDancer(storage, guest.id, 'venue-2', 'dancer-1');
  dashboard.event('storage', { key: draftStorage.VIP_DRAFT_PREFIX + guest.id });
  resolve({ ok: true }); await pending; await dashboard.settle();
  assert.deepEqual(draftStorage.readVipWorkspace(storage, guest.id).drafts['venue-2'], {
    selected: ['dancer-1'], date: '2026-12-05', time: '21:30',
  });
});

test('unavailable dancers cannot be added to the selected club queue', async () => {
  const h = harness({ request: async () => state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: false }] }) });
  await h.settle(); h.trigger().props.onClick();
  assert.equal(h.trigger().props.disabled, true);
  assert.equal(h.values.size, 0);
  assert.deepEqual(h.navigations, []);
});

test('logged-out, non-customer and non-member profiles retain admission', async () => {
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
    assert.equal(h.values.size, 0);
  }
});

test('external return paths and account changes cannot modify a VIP queue', async () => {
  for (const returnHref of ['', '/vip#vip-plan', '//attacker.test/vip?venueId=venue-2',
    'https://attacker.test/vip?venueId=venue-2', '/dashboard/venue?venueId=venue-2']) {
    const h = harness({ returnHref }); await h.settle();
    assert.equal(h.tree(), 'Free Entry fallback');
    assert.equal(h.calls.length, 0);
  }
  const h = harness(); await h.settle();
  h.session({ ...guest, id: 'other-guest' }, false);
  h.trigger().props.onClick();
  assert.equal(h.values.size, 0);
  assert.deepEqual(h.navigations, []);
});

test('membership reads can retry, and unmount cancels a pending read', async () => {
  let reads = 0;
  const h = harness({ request: async () => {
    if (++reads === 1) throw Error('Offline');
    return state('venue-2', { dancers: [{ id: 'dancer-1', canRequest: true }] });
  } });
  await h.settle();
  assert.equal(h.trigger().props.disabled, true);
  h.nodes().find(node => node.type === 'button' && node.props.children === 'Retry').props.onClick();
  await h.settle(); assert.equal(h.trigger().props.disabled, false);
  let resolve;
  const pending = harness({ request: async () => new Promise(done => { resolve = done; }) });
  pending.unmount(); resolve(state('venue-2')); await Promise.resolve();
  assert.equal(pending.calls[0].options.signal.aborted, true);
  assert.deepEqual(pending.navigations, []);
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
});
