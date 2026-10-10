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
    input: type => nodes().findLast(node => node.type === 'input' && node.props.type === type),
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

test('pending requests reset request pagination and remain selected while searching VIP members', async () => {
  const ui = panelHarness(); await ui.settle();
  ui.button('Older requests').props.onClick(); await ui.settle();
  ui.button('Pending requests').props.onClick(); await ui.settle();
  let params = new URL(ui.calls.at(-1).url, 'https://example.test').searchParams;
  assert.equal(params.get('status'), 'pending'); assert.equal(params.get('page'), '0');
  ui.input('search').props.onChange({ target: { value: 'Jordan' } }); ui.render();
  ui.form('vip-member-search').props.onSubmit({ preventDefault() {} }); await ui.settle();
  params = new URL(ui.calls.at(-1).url, 'https://example.test').searchParams;
  assert.equal(params.get('status'), 'pending'); assert.equal(params.get('memberSearch'), 'Jordan');
  ui.button('All statuses').props.onClick(); await ui.settle();
  assert.equal(new URL(ui.calls.at(-1).url, 'https://example.test').searchParams.get('status'), 'all'); ui.unmount();
});

test('pending invitation actions expose the replacement link and preserve the new invitation identity', async () => {
  let invitation = { id: 'old-invitation', email: 'guest@example.test', expires_at: '2027-01-01' };
  const ui = panelHarness(async (_url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); assert.equal(body.id, invitation.id);
      invitation = { ...invitation, id: 'new-invitation' };
      return { invitationId: invitation.id, invitationUrl: 'https://example.test/vip/invite/new-link', emailDelivered: true };
    }
    return { ...initial, invitations: [invitation] };
  });
  await ui.settle(); ui.button('New share link').props.onClick(); await ui.settle();
  assert.equal(JSON.parse(ui.calls.find(c => c.options.method === 'POST').options.body).action, 'share_invitation');
  assert.match(ui.html(), /New private link ready to share/); assert.match(ui.html(), /vip\/invite\/new-link/);
  assert.equal(ui.nodes().filter(n => n.type === 'button' && n.props.children === 'Share invitation').length, 2);
  ui.button('Resend email').props.onClick(); await ui.settle();
  const body = JSON.parse(ui.calls.filter(c => c.options.method === 'POST').at(-1).options.body);
  assert.equal(body.id, 'new-invitation'); assert.equal(body.action, 'resend_invitation'); assert.match(ui.html(), /Invitation emailed/);
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

test('venue invitations save a nickname and keep the draft when sending fails', async () => {
  let fail=true,invitation;
  const ui=panelHarness(async (_url,options)=>{
    if(options.method==='POST'){
      if(fail){fail=false;throw new Error('Invitation unavailable');}
      const body=JSON.parse(options.body);assert.equal(body.nickname,'Friday regular');
      invitation={id:'invite-1',email:body.email,nickname:body.nickname,expires_at:'2027-01-01'};
      return {invitationId:invitation.id,invitationUrl:'https://example.test/invite',emailDelivered:true};
    }
    return {...initial,invitations:invitation?[invitation]:[]};
  });
  await ui.settle();ui.input('email').props.onChange({target:{value:'guest@example.test'}});
  ui.input('text').props.onChange({target:{value:'Friday regular'}});ui.render();
  ui.form('vip-invite-form').props.onSubmit({preventDefault(){}});await ui.settle();
  assert.equal(ui.input('text').props.value,'Friday regular');assert.match(ui.html(),/Invitation unavailable/);
  ui.form('vip-invite-form').props.onSubmit({preventDefault(){}});await ui.settle();
  assert.equal(ui.input('text').props.value,'');assert.match(ui.html(),/Friday regular/);ui.unmount();
});

test('venue requests resolve current nicknames outside the member search page without exposing user IDs', async () => {
  const service=compileVip('src/lib/dancr/vip.ts',{'./venue-access':{requireVenueAccess:async()=>({venueId:'managed-venue'})}});
  const calls=[];let labelFailure=null;
  const client={
    from(table){const call={table,steps:[]};calls.push(call);
      const chain={select:()=>chain,eq:(key,value)=>{call.steps.push([key,value]);return chain;},in:(key,value)=>{call.steps.push([key,value]);return chain;},is:()=>chain,gt:()=>chain,order:()=>chain,range:()=>chain,
        then:(resolve,reject)=>Promise.resolve({data:table==='venue_vip_requests'?[{id:'request-1',user_id:'request-guest',guest_name:'Jordan'}]:table==='venue_vip_members'?[{user_id:'request-guest',nickname:'Latest nickname'}]:[],error:table==='venue_vip_members'?labelFailure:null}).then(resolve,reject)};return chain;},
    rpc:async name=>({data:name==='vip_manager_access'?true:{members:[],memberCount:0}}),
  };
  const result=await service.getVenueVipState(client,'owner',new URLSearchParams({memberSearch:'unrelated',memberPage:'2'}));
  assert.equal(result.requests[0].nickname,'Latest nickname');assert.equal(result.requests[0].user_id,undefined);
  const lookup=calls.find(c=>c.table==='venue_vip_members');assert.ok(lookup.steps.some(([key,value])=>key==='venue_id'&&value==='managed-venue'));
  assert.deepEqual(Array.from(lookup.steps.find(([key])=>key==='user_id')[1]),['request-guest']);
  labelFailure=new Error('Nickname lookup unavailable');await assert.rejects(service.getVenueVipState(client,'owner',new URLSearchParams()),/Nickname lookup unavailable/);
});
