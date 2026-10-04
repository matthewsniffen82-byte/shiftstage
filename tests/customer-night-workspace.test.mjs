import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { customerDashboardDestination } from '../app/dashboard/customer-dashboard-view.ts';

// Focused component events and rendering. No browser, app server, or network.
function harness(name = 'CustomerPanel', props = {}, hash = '') {
  const slots = [], listeners = new Map(), frames = new Map(), writes = [];
  let cursor = 0, dirty = true, effects = [], tree, sequence = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(effect, deps) {
      const i = cursor++, prev = slots[i];
      if (!prev || deps.some((v, j) => !Object.is(v, prev.deps[j]))) effects.push(() => { prev?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    },
  };
  const window = { location: { hash }, history: { replaceState: (_, __, value) => { writes.push(value); window.location.hash = value; } },
    addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name),
    setInterval: () => 1, clearInterval() {}, cancelAnimationFrame: id => frames.delete(id), requestAnimationFrame: cb => { frames.set(++sequence, cb); return sequence; } };
  const exports = {};
  const source = fs.readFileSync('app/dashboard/CustomerDashboardPanels.tsx', 'utf8') + '\nexport { CustomerPassWallet, CustomerNightPanel, FollowedDancerGridCard };';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, window, Date, Intl, AbortController, HTMLDetailsElement: class {}, document: { getElementById: () => null },
    require: path => path === 'react' ? react : path === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : path === './customer-dashboard-view' ? { customerDashboardDestination }
      : path === 'next/link' ? { default: 'a' } : path.endsWith('/navigation') ? { homeDiscoveryHref: (view, city = 'Las Vegas') => `/?view=${view}&city=${city}` }
      : path === './DashboardShared' ? { customerDancerHref: d => `/dancers/${d.slug}`, customerVenueHref: v => `/venues/${v.slug}`, customerInitials: () => 'A' }
      : {},
  });
  function render() {
    for (let i = 0; dirty && i < 30; i++) { dirty = false; cursor = 0; effects = []; tree = exports[name](props); effects.forEach(cb => cb()); }
    assert.equal(dirty, false, 'effects settle');
    for (const cb of frames.values()) cb(); frames.clear();
    return tree;
  }
  function nodes(node = tree) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))] : []; }
  render();
  return { exports, nodes, writes, tree: () => tree, render: () => { dirty = true; return render(); },
    update(next) { props = { ...props, ...next }; dirty = true; render(); },
    hash(value) { window.location.hash = value; listeners.get('hashchange')?.(); dirty = true; render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const byId = (ui, id) => ui.nodes().find(n => n.props?.id === id);
const component = (ui, name) => ui.nodes().find(n => n.type?.name === name);
const shift = (changes = {}) => ({ id: 'shift', status: 'posted', startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(), checkedInAt: new Date().toISOString(), timezone: 'America/Los_Angeles', venue: { id: 'v', slug: 'echo', name: 'Echo House', city: 'Las Vegas' }, dancer: { id: 'a', slug: 'star', stageName: 'Star' }, ...changes });

test('legacy URLs select the correct destination and saved filter', () => {
  for (const [hash, view, filter] of [['#customer-followed-clubs','saved','clubs'],['#customer-saved-deals','saved','deals'],['#customer-followed-dancers','saved','dancers'],['#customer-support','account','dancers'],['#customer-notification-preferences','alerts','dancers'],['#customer-going','night','dancers'],['#customer-passes','night','dancers']]) {
    assert.deepEqual(customerDashboardDestination(hash), { view, filter });
  }
  assert.deepEqual(customerDashboardDestination('', 'offers'), { view:'saved', filter:'deals' });
  assert.equal(customerDashboardDestination('#customer-support', 'offers').view, 'account');
  assert.equal(customerDashboardDestination('#unknown').view, 'night');
});

test('navigation changes the visible destination while retaining account forms and saved filtering', () => {
  const account = { type: 'AccountEditor', props: { children: 'Unfinished email' } };
  const ui = harness('CustomerPanel', { saved: {}, accountContent: account, alertsContent: 'Alerts' });
  assert.equal(byId(ui, 'customer-view-night').props.hidden, false);
  component(ui,'CustomerDashboardNav').props.onNavigate('account'); ui.render();
  assert.equal(byId(ui,'customer-view-account').props.hidden,false);
  component(ui,'CustomerDashboardNav').props.onNavigate('saved'); ui.render();
  assert.equal(byId(ui,'customer-view-account').props.children,account);
  assert.equal(byId(ui,'customer-view-account').props.hidden,true);
  const clubs = ui.nodes().find(n => n.type === 'button' && n.props['aria-controls'] === 'customer-followed-clubs');
  clubs.props.onClick(); ui.render();
  assert.equal(byId(ui,'customer-followed-clubs').props.hidden,false);
  assert.equal(ui.writes.at(-1),'#customer-followed-clubs');
  ui.hash('#customer-support'); assert.equal(byId(ui,'customer-view-account').props.hidden,false);
  ui.hash('#customer-alerts'); assert.equal(byId(ui,'customer-view-alerts').props.hidden,false);
  ui.unmount();
});

test('passes appear before plans and unavailable saved activity never looks empty', () => {
  const ui = harness('CustomerPanel', { saved: {}, accountSavedUnavailable: false });
  assert.ok(ui.nodes().findIndex(n => n.type?.name === 'CustomerPassWallet') < ui.nodes().findIndex(n => n.props?.id === 'customer-going'));
  ui.update({ accountSavedUnavailable: true });
  assert.equal(component(ui,'CustomerPassWallet'),undefined);
  assert.equal(component(ui,'CustomerNightPanel'),undefined);
  assert.ok(component(ui,'CustomerDealPassPanel').props.accountSavedUnavailable);
});

test('Working Now requires a posted, current, checked-in shift, not just a scheduled shift', () => {
  const follows = [shift(), shift({checkedInAt:null}), shift({checkedOutAt:new Date().toISOString()}), shift({status:'cancelled'}), shift({endsAt:new Date(Date.now()-1000).toISOString()})]
    .map((nextShift, i) => ({ dancerId:String(i), dancer:{id:String(i),slug:`dancer-${i}`,stageName:`Dancer ${i}`,nextShift} }));
  const ui = harness('CustomerPanel', { saved:{follows} });
  assert.equal(byId(ui,'customer-working-now').props.count,1);
});

test('city filter applies to all saved types and falls back when the last item in that city is removed', () => {
  const saved = { follows:[{dancer:{id:'1',city:'Las Vegas'}},{dancer:{id:'2',city:'Miami'}}], venueFollows:[{venue:{id:'v',city:'Miami'}}], dealSaves:[{dealId:'d',venue:{city:'Miami'}}] };
  const ui = harness('CustomerPanel', { saved }, '#customer-followed-clubs');
  ui.nodes().find(n => n.type === 'select').props.onChange({target:{value:'Miami'}}); ui.render();
  assert.equal(component(ui,'CustomerFollowedDancersPanel').props.saved.follows.length,1);
  assert.equal(component(ui,'CustomerFollowedClubsPanel').props.saved.venueFollows.length,1);
  assert.equal(component(ui,'CustomerDealPassPanel').props.savedDeals.length,1);
  ui.update({saved:{ follows:[saved.follows[0]] }});
  assert.equal(component(ui,'CustomerFollowedDancersPanel').props.saved.follows[0].dancer.id,'1');
});

test('wallet promotes only unexpired generated passes; redeemed, voided and expired passes stay in history', () => {
  const future = new Date(Date.now()+3_600_000).toISOString(), past = new Date(Date.now()-1000).toISOString();
  const deals = ['generated','redeemed','voided','expired'].map((status,i) => ({id:String(i),status,expiresAt:future,generatedAt:past,redemptionToken:`token-${i}`,deal:{title:status}}));
  deals.push({...deals[0],id:'old',expiresAt:past,redemptionToken:'old-token'});
  const ui = harness('CustomerPassWallet',{deals,isLoading:false});
  const active = ui.nodes().filter(n => n.props?.className === 'customer-pass-card');
  assert.equal(active.length,1); assert.equal(active[0].props.href,'/deals/pass/token-0');
  assert.equal(ui.nodes().filter(n=>n.props?.className==='customer-past-pass').length,4);
});

test('plans group by venue-local date and club, excluding cancelled and expired shifts', () => {
  const ui = harness('CustomerNightPanel',{ signals:[shift(),shift({id:'second'}),shift({id:'cancelled',status:'cancelled'}),shift({id:'expired',endsAt:new Date(Date.now()-1000).toISOString()})].map(s=>({shiftId:s.id,shift:s})),isLoading:false,pendingAction:'' });
  assert.equal(ui.nodes().filter(n=>n.props?.className==='customer-plan-group').length,1);
  assert.equal(ui.nodes().filter(n=>n.props?.className==='customer-night-card').length,2);
});

test('unfollow stays outside the card link and both controls retain independent actions', () => {
  let removed=0;
  const ui=harness('FollowedDancerGridCard',{dancer:{id:'1',slug:'star',stageName:'Star',nextShift:shift()},onUnfollow:()=>removed++,pending:false,unfollowing:false});
  const link=ui.nodes().find(n=>n.props?.className==='customer-followed-dancer-tile');
  assert.equal(link.props.href,'/dancers/star');
  assert.ok(![link.props.children].flat(Infinity).some(n=>n?.type==='button'));
  ui.nodes().find(n=>n.type==='button').props.onClick(); assert.equal(removed,1);
});
