import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';

const member = { id: 'member-1', display_name: 'Jordan Guest', nickname: 'Friday regular' };
const initial = { invitations: [], members: [member], memberCount: 51, membersHasMore: true, requests: [], hasMore: true };

// Focused component events with in-memory data only; no browser or network.
function panelHarness(request = async () => initial) {
  const slots = [], calls = []; let cursor = 0, dirty = true, effects = [], tree, accountId = 'owner-1';
  const react = {
    useState(initial) { const i = cursor++; slots[i] ||= { value: initial }; return [slots[i].value, next => {
      const value = typeof next === 'function' ? next(slots[i].value) : next;
      if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
    }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) slots[i] = { value: callback, deps };
      return slots[i].value;
    },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    },
  };
  const Component = compileVip('app/dashboard/VenueVipPanel.tsx', {
    react,
    './dashboard-session': { readSession: () => ({ account: { id: accountId } }), requestDashboardJson: (url, options) => { calls.push({ url, options }); return request(url, options); } },
    '../vip/VipRequests': { __esModule: true, default: () => null },
  }).default;
  function render() {
    dirty = true;
    for (let i = 0; dirty && i < 30; i++) { dirty = false; cursor = 0; effects = []; tree = Component({}); effects.forEach(effect => effect()); }
    assert.equal(dirty, false); return tree;
  }
  function nodes(node = tree) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))] : []; }
  async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } }
  render();
  return { calls, render, nodes, settle, html: () => renderToStaticMarkup(tree), session: id => { accountId = id; },
    button: text => nodes().find(node => node.type === 'button' && node.props.children === text),
    input: type => nodes().find(node => node.type === 'input' && node.props.type === type),
    form: name => nodes().find(node => node.type === 'form' && node.props.className === name),
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

test('venue nickname editing retains failed drafts, saves changes and allows clearing without changing the guest name', async () => {
  let nickname = member.nickname, fail = true;
  const ui = panelHarness(async (_url, options) => {
    if (options.method === 'POST') {
      if (fail) { fail = false; throw new Error('Save failed. Try again.'); }
      const body = JSON.parse(options.body); assert.equal(body.action, 'set_nickname'); assert.equal(body.id, member.id); nickname = body.nickname.trim(); return { ok: true };
    }
    return { ...initial, members: [{ ...member, nickname }] };
  });
  await ui.settle(); assert.match(ui.html(), /Friday regular/); assert.match(ui.html(), /Jordan Guest/);
  ui.button('Edit nickname').props.onClick(); ui.render();
  ui.input('text').props.onChange({ target: { value: '  Weekend VIP  ' } }); ui.render();
  await ui.form('vip-nickname-form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.match(ui.html(), /Save failed/); assert.equal(ui.input('text').props.value, '  Weekend VIP  ');
  await ui.form('vip-nickname-form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.equal(ui.form('vip-nickname-form'), undefined); assert.match(ui.html(), /Weekend VIP/); assert.match(ui.html(), /Jordan Guest/);
  ui.button('Edit nickname').props.onClick(); ui.render(); ui.input('text').props.onChange({ target: { value: '' } }); ui.render();
  await ui.form('vip-nickname-form').props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.ok(ui.button('Add nickname')); assert.match(ui.html(), /Nickname removed/); assert.doesNotMatch(ui.html(), /Weekend VIP/);
  ui.unmount();
});

test('VIP nickname search resets member pagination and survives independent visit-request paging', async () => {
  const ui = panelHarness(); await ui.settle();
  ui.button('More VIPs').props.onClick(); await ui.settle();
  assert.equal(new URL(ui.calls.at(-1).url, 'https://example.test').searchParams.get('memberPage'), '1');
  ui.input('search').props.onChange({ target: { value: '  Friday & Friends  ' } }); ui.render();
  ui.form('vip-member-search').props.onSubmit({ preventDefault() {} }); await ui.settle();
  let params = new URL(ui.calls.at(-1).url, 'https://example.test').searchParams;
  assert.equal(params.get('memberSearch'), 'Friday & Friends'); assert.equal(params.get('memberPage'), '0');
  ui.button('More VIPs').props.onClick(); await ui.settle(); ui.button('Older requests').props.onClick(); await ui.settle();
  params = new URL(ui.calls.at(-1).url, 'https://example.test').searchParams;
  assert.equal(params.get('memberSearch'), 'Friday & Friends'); assert.equal(params.get('memberPage'), '1'); assert.equal(params.get('page'), '1');
  ui.button('Clear search').props.onClick(); await ui.settle();
  params = new URL(ui.calls.at(-1).url, 'https://example.test').searchParams;
  assert.equal(params.get('memberSearch'), ''); assert.equal(params.get('memberPage'), '0'); assert.equal(ui.input('search').props.value, '');
  ui.unmount();
});

test('nickname saves do not update a different signed-in account after a delayed response', async () => {
  let resolve; const ui = panelHarness(async (_url, options) => options.method === 'POST' ? new Promise(done => { resolve = done; }) : initial);
  await ui.settle(); ui.button('Edit nickname').props.onClick(); ui.render();
  ui.input('text').props.onChange({ target: { value: 'New nickname' } }); ui.render();
  const saving = ui.form('vip-nickname-form').props.onSubmit({ preventDefault() {} });
  ui.session('another-owner'); resolve({ ok: true }); await saving; await ui.settle();
  assert.doesNotMatch(ui.html(), /Nickname saved/); assert.equal(ui.calls.filter(call => call.options.method !== 'POST').length, 1);
  ui.unmount();
});

test('venue VIP reads forward bounded search to the authorized venue and propagate database failures', async () => {
  class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
  const service = compileVip('src/lib/dancr/vip.ts', {
    '../api-error-policy': { PublicApiError }, './venue-access': { requireVenueAccess: async () => ({ venueId: 'managed-venue' }) },
  });
  const calls = []; let failure = null;
  const client = {
    from() { const chain = { select: () => chain, eq: () => chain, is: () => chain, gt: () => chain, order: () => chain, range: () => chain,
      then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject) }; return chain; },
    async rpc(name, args) { calls.push({ name, args }); return name === 'vip_manager_access' ? { data: true } : { data: initial, error: failure }; },
  };
  const result = await service.getVenueVipState(client, 'owner', new URLSearchParams({ memberSearch: ' Friday ', memberPage: '2', venueId: 'untrusted-venue' }));
  const search = calls.find(call => call.name === 'vip_search_members');
  assert.equal(search.args.p_actor, 'owner'); assert.equal(search.args.p_venue, 'managed-venue'); assert.equal(search.args.p_search, 'Friday'); assert.equal(search.args.p_offset, 100);
  assert.equal(result.memberCount, 51); assert.equal(result.members[0].nickname, member.nickname);
  for (const params of [{ memberPage: '-1' }, { memberPage: '1001' }, { memberSearch: 'x'.repeat(81) }]) {
    await assert.rejects(service.getVenueVipState(client, 'owner', new URLSearchParams(params)), error => error.status === 400);
  }
  failure = new Error('database unavailable');
  await assert.rejects(service.getVenueVipState(client, 'owner', new URLSearchParams()), /database unavailable/);
});
