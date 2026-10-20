import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardHarness, guest, venues, state } from './helpers/vip-dashboard-fixture.mjs';
import { plannerHarness } from './helpers/vip-planner-fixture.mjs';
import { vipProfileSlug } from '../src/lib/dancr/vip-dashboard.ts';
import { VIP_DRAFT_PREFIX } from '../src/lib/dancr/vip-draft-storage.ts';

const dancers = [
  { id: '00000000-0000-4000-8000-000000000001', stage_name: 'Aria', profileHref: '/dancers/aria', canRequest: true, following: true },
  { id: '00000000-0000-4000-8000-000000000002', stage_name: 'Nova', profileHref: '/dancers/nova', canRequest: true },
];
const harness = () => dashboardHarness({ hash: '#vip-plan', initialVenueId: venues[0].id,
  request: async url => state(new URL(url, 'https://example.test').searchParams.get('venueId') || venues[0].id, { dancers }) });
const click = (overrides = {}) => ({ button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides });

test('normal VIP clicks open the shared viewer; modified clicks retain the homepage URL', () => {
  const opened = [];
  const ui = plannerHarness({ dancers, onOpenProfile: dancer => { opened.push(dancer.id); return true; } });
  const link = ui.nodes().find(node => node.type === 'a');
  assert.equal(link.props.href, '/?profile=aria');
  assert.equal(link.props.target, undefined);
  for (const override of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    link.props.onClick(click(override));
  }
  assert.deepEqual(opened, []);
  const event = click(); link.props.onClick(event);
  assert.equal(event.defaultPrevented, true); assert.deepEqual(opened, [dancers[0].id]);
  assert.equal(ui.props.draft.selected.length, 0, 'opening a profile does not select it');
  for (const profileHref of ['https://foreign.test/dancers/aria', '//foreign.test/dancers/aria', '/dancers/%zz', '/dancers/', '/vip']) {
    assert.equal(vipProfileSlug({ profileHref }), '');
  }
});

test('Request merges with Quick Add and stays open; Back returns to the mounted planner and queue', async () => {
  const ui = harness(); await ui.settle();
  assert.equal(ui.profileViewer().props.prewarm, true);
  const draft = { selected: [dancers[1].id], date: '2026-12-05', time: '21:30' };
  ui.planner().props.onChange(draft); ui.render();
  const planner = ui.planner();
  assert.equal(planner.props.onOpenProfile(dancers[0]), true); ui.render();
  assert.equal(ui.profileViewer().props.profile, null);
  assert.equal(ui.profileViewer().props.publicSlug, 'aria');
  assert.equal(ui.profileViewer().props.publicActions.following, true);
  const writes = ui.writes.length;
  ui.profileViewer().props.onVipRequest(); ui.render();
  assert.equal(ui.profileViewer().props.profileId, dancers[0].id);
  assert.equal(ui.profileViewer().props.vipRequest.added, true);
  assert.equal(ui.planner().type, planner.type); assert.equal(ui.planner().key, planner.key);
  assert.equal(ui.writes.length, writes, 'adding must not navigate');
  assert.deepEqual([...ui.planner().props.draft.selected], [dancers[1].id, dancers[0].id]);
  assert.equal(ui.planner().props.draft.time, draft.time);
  assert.equal(ui.calls.some(call => call.options.method), false, 'no separate API request is submitted');
  ui.profileViewer().props.onVipRequest(); ui.render();
  assert.equal(ui.planner().props.draft.selected.length, 2, 'repeat taps cannot duplicate the selection');
  const stored = JSON.parse(ui.storage.get(VIP_DRAFT_PREFIX + guest.id));
  assert.deepEqual(stored.drafts[venues[0].id].selected, [dancers[1].id, dancers[0].id]);
  ui.profileViewer().props.onClose(); ui.render();
  assert.equal(ui.profileViewer().props.profileId, '');
  await ui.settle();
  assert.deepEqual([...ui.planner().props.draft.selected], [dancers[1].id, dancers[0].id]);
  assert.equal(ui.planner().key, planner.key);
  ui.planner().props.onOpenProfile(dancers[0]); ui.render();
  assert.equal(ui.profileViewer().props.vipRequest.added, true, 'reopening already queued profiles shows Added');
  ui.unmount();
});

test('a full queue leaves the profile open with an error; session and venue changes cannot add to it', async () => {
  const ui = harness(); await ui.settle();
  ui.planner().props.onChange({ selected: Array.from({ length: 10 }, (_, i) => `existing-${i}`), date: '', time: '' }); ui.render();
  ui.planner().props.onOpenProfile(dancers[0]); ui.render();
  ui.profileViewer().props.onVipRequest(); ui.render();
  assert.match(ui.profileViewer().props.vipRequest.message, /10 dancers/);
  assert.equal(ui.profileViewer().props.vipRequest.added, false);
  assert.equal(ui.profileViewer().props.profileId, dancers[0].id);
  ui.planner().props.onChange({ selected: [], date: '', time: '' }); ui.render();
  ui.session({ id: 'someone-else', role: 'customer' });
  ui.profileViewer().props.onVipRequest(); ui.render();
  assert.equal(ui.planner().props.draft.selected.length, 0);
  ui.session(guest);
  ui.nodes().find(node => node.type === 'select').props.onChange({ target: { value: venues[1].id } }); await ui.settle();
  assert.equal(ui.profileViewer().props.profileId, '');
  ui.profileViewer().props.onVipRequest(); ui.render();
  assert.equal(ui.planner().props.draft.selected.length, 0);
  ui.unmount();
});

test('profile load failure leaves the dashboard usable with its queue intact', async () => {
  const ui = harness(); await ui.settle();
  ui.planner().props.onChange({ selected: [dancers[1].id], date: '', time: '' }); ui.render();
  ui.planner().props.onOpenProfile(dancers[0]); ui.render();
  ui.profileViewer().props.onError(); ui.render();
  assert.equal(ui.profileViewer().props.profileId, '');
  assert.deepEqual([...ui.planner().props.draft.selected], [dancers[1].id]);
  assert.ok(ui.nodes().some(node => typeof node.props?.children === 'string' && /profile is unavailable/.test(node.props.children)));
  ui.unmount();
});
