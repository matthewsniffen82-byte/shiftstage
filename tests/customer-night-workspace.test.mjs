import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { customerDashboardDestination } from '../app/dashboard/customer-dashboard-view.ts';
import * as customerNight from '../src/lib/dancr/customer-night.ts';
import { venueOperatingStatus } from '../src/lib/dancr/venue-operating-status.ts';

// Focused component events and rendering. No browser, app server, or network.
function harness(name = 'CustomerPanel', props = {}, hash = '') {
  const slots = [], listeners = new Map(), frames = new Map(), writes = [], navigations = [];
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
  const window = { location: { hash, assign: value => navigations.push(value) }, history: { replaceState: (_, __, value) => { writes.push(value); window.location.hash = value; } },
    addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name),
    setInterval: () => 1, clearInterval() {}, cancelAnimationFrame: id => frames.delete(id), requestAnimationFrame: cb => { frames.set(++sequence, cb); return sequence; } };
  const exports = {};
  const source = fs.readFileSync('app/dashboard/CustomerDashboardPanels.tsx', 'utf8') + '\nexport { CustomerPassWallet, CustomerNightPanel, FollowedDancerGridCard, CustomerFollowedClubsPanel, SavedVenueCard, CustomerDealPassPanel, CustomerDirectionsButton };';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, window, Date, Intl, AbortController, HTMLDetailsElement: class {}, document: { getElementById: () => null },
    require: path => path === 'react' ? react : path === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : path === './customer-dashboard-view' ? { customerDashboardDestination }
      : path === 'next/link' ? { default: 'a' } : path.endsWith('/navigation') ? { homeDiscoveryHref: (view, city = 'Las Vegas') => `/?view=${view}&city=${city}` }
      : path === './DashboardShared' ? { customerDancerHref: d => `/dancers/${d.slug}`, customerVenueHref: v => `/venues/${v.slug}`, customerInitials: () => 'A' }
      : path === '@/src/lib/dancr/customer-night' ? customerNight : path.endsWith('/venue-operating-status') ? { venueOperatingStatus } : {},
  });
  function render() {
    for (let i = 0; dirty && i < 30; i++) { dirty = false; cursor = 0; effects = []; tree = exports[name](props); effects.forEach(cb => cb()); }
    assert.equal(dirty, false, 'effects settle');
    for (const cb of frames.values()) cb(); frames.clear();
    return tree;
  }
  function nodes(node = tree) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))] : []; }
  render();
  return { exports, nodes, writes, navigations, tree: () => tree, render: () => { dirty = true; return render(); },
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

test('new customers see one discovery section without a stack of empty cards', () => {
  const ui = harness('CustomerPanel', { saved: {}, accountSavedUnavailable: false });
  assert.equal(component(ui,'CustomerPassWallet'),undefined);
  assert.equal(component(ui,'CustomerNightPanel'),undefined);
  assert.equal(byId(ui,'customer-working-now'),undefined);
  assert.equal(ui.nodes().filter(n=>n.type?.name==='CustomerExplore').length,1);
  ui.update({ accountSavedUnavailable: true });
  assert.equal(component(ui,'CustomerPassWallet'),undefined);
  assert.equal(component(ui,'CustomerNightPanel'),undefined);
  assert.ok(component(ui,'CustomerDealPassPanel').props.accountSavedUnavailable);
});

test('plans start collapsed, preserve the chosen state during refresh and keep passes separate', () => {
  const nextShift=shift();
  const ui=harness('CustomerPanel',{saved:{goingSignals:[{shiftId:nextShift.id,shift:nextShift}],follows:[{dancer:{id:'a',slug:'star',nextShift}}],dealRedemptions:[{id:'pass',status:'generated',generatedAt:new Date(Date.now()-120000).toISOString(),expiresAt:nextShift.endsAt,venue:nextShift.venue}]}});
  const index=match=>ui.nodes().findIndex(match);
  assert.ok(index(n=>n.props?.id==='customer-plans-list') < index(n=>n.type?.name==='CustomerExplore'));
  assert.ok(index(n=>n.type?.name==='CustomerExplore') < index(n=>n.props?.id==='customer-working-now'));
  assert.equal(byId(ui,'customer-pass-wallet').type,'div','QR passes are visible without expanding a disclosure');
  assert.ok(index(n=>n.props?.id==='customer-pass-wallet') < index(n=>n.props?.id==='customer-plans-list'));
  assert.equal(byId(ui,'customer-plans-list').type,'details');
  assert.equal(byId(ui,'customer-plans-list').props.open,false);
  assert.equal(ui.nodes().filter(n=>n.type?.name==='CustomerNightPanel').length,1);
  assert.equal(component(ui,'CustomerNextOuting'),undefined);
  assert.equal(component(ui,'CustomerNightPanel').props.signals.length,1);
  const header=byId(ui,'customer-plans-list').props.children[0];
  assert.equal(header.props.children[0],'Your plans ');
  assert.equal(header.props.children[1].props.children,1);
  byId(ui,'customer-plans-list').props.onToggle({currentTarget:{open:true}}); ui.render();
  assert.equal(byId(ui,'customer-plans-list').props.open,true);
  ui.update({isLoading:true});
  assert.equal(byId(ui,'customer-plans-list').props.open,true,'refreshing preserves expanded plans');
  byId(ui,'customer-plans-list').props.onToggle({currentTarget:{open:false}}); ui.render();
  assert.equal(byId(ui,'customer-plans-list').props.open,false);
  ui.update({isLoading:false});
  assert.equal(byId(ui,'customer-plans-list').props.open,false,'refreshing does not reopen collapsed plans');
  byId(ui,'customer-plans-list').props.onToggle({currentTarget:{open:true}}); ui.render();
  assert.equal(byId(ui,'customer-plans-list').props.open,true);
});

test('passes remain available without creating an empty or duplicate plans section', () => {
  const nextShift=shift();
  const ui=harness('CustomerPanel',{saved:{dealRedemptions:[{id:'pass',status:'generated',generatedAt:new Date(Date.now()-120000).toISOString(),expiresAt:nextShift.endsAt,venue:nextShift.venue}]}});
  assert.equal(byId(ui,'customer-plans-list'),undefined);
  assert.equal(component(ui,'CustomerNextOuting'),undefined);
  assert.equal(component(ui,'CustomerPassWallet').props.deals.length,1);
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
  assert.equal(component(ui,'CustomerSurface').props.title,'My QR passes');
  const active = ui.nodes().filter(n => n.props?.className === 'customer-pass-card');
  assert.equal(active.length,1); assert.equal(active[0].props.href,'/deals/pass/token-0');
  assert.equal(ui.nodes().find(n=>n.props?.className==='customer-pass-cta').props.children[0],'Show QR ');
  assert.equal(ui.nodes().find(n=>n.props?.className==='past-deal-history').props.open,undefined,'past passes start collapsed');
  assert.equal(ui.nodes().filter(n=>n.props?.className==='customer-past-pass').length,4);
});

test('plans group by venue-local date and club, excluding cancelled and expired shifts', () => {
  const ui = harness('CustomerNightPanel',{ signals:[shift(),shift({id:'second'}),shift({id:'cancelled',status:'cancelled'}),shift({id:'expired',endsAt:new Date(Date.now()-1000).toISOString()})].map(s=>({shiftId:s.id,shift:s})),isLoading:false,pendingAction:'' });
  assert.equal(ui.nodes().filter(n=>n.props?.className==='customer-plan-group').length,1);
  assert.equal(ui.nodes().filter(n=>n.props?.className==='customer-night-card').length,2);
  assert.equal(ui.nodes().find(n=>n.props?.['aria-controls']==='customer-plan-groups'),undefined,'one outing needs no Show all control');
});

test('plans show one Free Entry action per outing only for clubs with a verified offer', () => {
  const otherClub = { id:'other', slug:'other-club', name:'Other Club' };
  const signals = [shift(), shift({id:'same-outing'}), shift({id:'other-outing',venue:otherClub})].map(s=>({shiftId:s.id,shift:s}));
  const entryDeals = { v:'free-deal' };
  const panel = harness('CustomerPanel',{saved:{goingSignals:signals,planEntryDeals:entryDeals}});
  assert.equal(component(panel,'CustomerNightPanel').props.entryDeals,entryDeals);
  const ui = harness('CustomerNightPanel',{signals,entryDeals,isLoading:false,pendingAction:''});
  ui.nodes().find(n=>n.props?.['aria-controls']==='customer-plan-groups').props.onClick(); ui.render();
  const entryLinks = () => ui.nodes().filter(n=>n.type==='a' && n.props['aria-label']?.startsWith('Free Entry'));
  assert.equal(entryLinks().length,1,'the same club action is not repeated for each dancer');
  assert.equal(entryLinks()[0].props.href,'/deals/transportation/free-deal?sourceType=club_page');
  assert.equal(entryLinks()[0].props['aria-label'],'Free Entry at Echo House');
  assert.equal(ui.nodes().filter(n=>n.props?.className==='customer-night-card').length,3);
  ui.update({entryDeals:{}});
  assert.equal(entryLinks().length,0,'removed offers lose their action on refresh');
});

test('saved club entry buttons open that club’s current offer while keeping club and directions actions', () => {
  const venue = {id:'club',slug:'echo',name:'Echo House',city:'Las Vegas',activity:{workingNowCount:96}};
  const other = {id:'other',slug:'other',name:'Other Club',city:'Las Vegas'};
  const saved = {venueFollows:[{venueId:'club',venue},{venueId:'other',venue:other}],clubEntryDeals:{club:'free/entry'},dealSaves:[]};
  const directions = [], unfollows = [];
  const clubs = harness('CustomerFollowedClubsPanel',{saved,pendingAction:'',onDirections: v => directions.push(v),onVenueFollowChange:(...args)=>unfollows.push(args)});
  const cards = clubs.nodes().filter(n=>n.type?.name==='SavedVenueCard');
  assert.equal(cards[0].props.entryDealId,'free/entry');
  assert.equal(cards[1].props.entryDealId,undefined,'another club cannot inherit the first club’s offer');
  const ui = harness('SavedVenueCard',cards[0].props);
  const entry = () => ui.nodes().find(n=>n.type==='button' && n.props.className?.includes('free-entry-cta') && n.props.className.includes('is-available'));
  entry().props.onClick();
  assert.equal(ui.navigations.at(-1),'/deals/transportation/free%2Fentry?sourceType=club_page');
  assert.equal(entry().props['aria-label'],'Free Entry at Echo House');
  ui.nodes().find(n=>n.type==='button' && n.props.className?.includes('venue-card-page-action')).props.onClick();
  assert.equal(ui.navigations.at(-1),'/venues/echo');
  const directionButton = () => ui.nodes().find(n=>n.type==='button' && n.props['aria-label']==='Directions to Echo House');
  directionButton().props.onClick();
  assert.equal(directions[0],venue);
  const unfollow = () => ui.nodes().find(n=>n.type==='button' && n.props['aria-label']==='Unfollow Echo House');
  unfollow().props.onClick();
  assert.deepEqual(unfollows,[['club',false]]);
  ui.update({pending:true,removing:true});
  assert.equal(unfollow().props.disabled,true);
  assert.equal(unfollow().props['aria-busy'],true);
  ui.update({entryDealId:undefined});
  assert.equal(entry(),undefined,'an unavailable offer disappears on refresh');
  assert.ok(directionButton());
  assert.ok(ui.nodes().find(n=>n.type==='button' && n.props.className?.includes('is-unavailable')).props.disabled);
});

test('saved venue scroll cards show five linked live dancers, total count, and honest empty states', () => {
  const dancers=Array.from({length:8},(_,i)=>({id:String(i),slug:`dancer-${i}`,stageName:`Dancer ${i}`,imageUrl:`/image-${i}.webp`}));
  const venue={slug:'echo',name:'Echo House',hoursLabel:'8:00p - 4:00a',activity:{workingNowCount:96,workingDancers:dancers}};
  const ui=harness('SavedVenueCard',{venue});
  const avatars=()=>ui.nodes().filter(n=>n.props?.className?.includes('venue-lineup-profile'));
  assert.equal(avatars().length,5);
  assert.equal(avatars()[0].props.href,'/dancers/dancer-0');
  assert.ok(ui.nodes().some(n=>n.props?.['aria-label']==='96 dancers working now'));
  const badge=ui.nodes().find(n=>n.props?.className==='home-venue-discovery-lineup-label');
  assert.equal(badge.type,'span','the NOW badge uses the discovery card’s non-link element');
  for (const className of ['home-venue-discovery-hours','home-venue-discovery-location']) {
    const info=ui.nodes().find(n=>n.props?.className===className);
    assert.equal(info.props.children[0].props.className,'venue-dot','metadata icons retain the discovery sizing wrapper');
  }
  assert.equal(ui.nodes().find(n=>n.props?.className==='home-venue-discovery-hours').props.children[1].props.children,venue.hoursLabel);
  ui.update({venue:{...venue,activity:{workingNowCount:0}}});
  assert.equal(avatars().length,0);
  assert.ok(ui.nodes().some(n=>n.props?.children==='No dancers listed now'));
  ui.update({venue:{...venue,activity:null}});
  assert.ok(ui.nodes().some(n=>n.props?.children==='Dancer counts unavailable'));
});

test('plans preview the next outing, expand without duplicates and retain cancellation and directions', () => {
  const upcoming = shift({id:'later',startsAt:new Date(Date.now()+86_400_000).toISOString(),endsAt:new Date(Date.now()+90_000_000).toISOString()});
  const next = shift({id:'next'}), sameOuting = shift({id:'same-outing'});
  const signals = [upcoming,next,sameOuting].map(shift=>({shiftId:shift.id,shift}));
  const cancelled=[];
  const ui=harness('CustomerNightPanel',{signals,isLoading:false,pendingAction:'',onCancelGoing:id=>cancelled.push(id)});
  const cards=()=>ui.nodes().filter(n=>n.props?.className==='customer-night-card');
  const toggle=()=>ui.nodes().find(n=>n.props?.['aria-controls']==='customer-plan-groups');
  assert.equal(cards().length,2,'the earliest outing includes all dancers at that club on that date');
  assert.equal(toggle().props.children,'Show all plans'); assert.equal(toggle().props['aria-expanded'],false);
  toggle().props.onClick(); ui.render();
  assert.equal(cards().length,3); assert.equal(ui.nodes().filter(n=>n.props?.className==='customer-plan-group').length,2);
  assert.equal(toggle().props.children,'Show fewer plans'); assert.equal(toggle().props['aria-expanded'],true);
  assert.equal(ui.nodes().filter(n=>n.type?.name==='CustomerDirectionsButton').length,3);
  ui.nodes().find(n=>n.type==='button'&&n.props.children==='Cancel Going').props.onClick();
  assert.deepEqual(cancelled,['next']);
  toggle().props.onClick(); ui.render(); assert.equal(cards().length,2);
  ui.update({signals:[signals[0]],pendingAction:'going-later'});
  assert.equal(cards().length,1,'the remaining outing takes the first spot after earlier plans are removed');
  assert.equal(toggle(),undefined);
  assert.equal(ui.nodes().find(n=>n.type==='button'&&n.props.children==='Cancelling…').props.disabled,true);
  assert.deepEqual(signals.map(item=>item.shiftId),['later','next','same-outing'],'rendering does not reorder saved data');
});

test('unfollow stays outside the card link and both controls retain independent actions', () => {
  let removed=0;
  const ui=harness('FollowedDancerGridCard',{dancer:{id:'1',slug:'star',stageName:'Star',nextShift:shift()},onUnfollow:()=>removed++,pending:false,unfollowing:false});
  const link=ui.nodes().find(n=>n.props?.className==='customer-followed-dancer-tile');
  assert.equal(link.props.href,'/dancers/star');
  assert.ok(![link.props.children].flat(Infinity).some(n=>n?.type==='button'));
  ui.nodes().find(n=>n.type==='button').props.onClick(); assert.equal(removed,1);
});

test('saved deal cards separate offer identity, menu and primary actions without redeeming', () => {
  const removed = [], directions = [];
  const venue = { id:'club', name:'Echo House' };
  const saved = { dealId:'entry/one', venue, deal:{ title:'Free admission', isActive:true } };
  const ui = harness('CustomerDealPassPanel', { savedDeals:[saved], pendingAction:'', onDirections:v=>directions.push(v), onRemoveSavedDeal:id=>removed.push(id) });
  const card = ui.nodes().find(n=>n.props?.className==='saved-deal-item saved-deal-bookmark');
  assert.deepEqual(Array.from(card.props.children, n=>n.props.className), ['saved-deal-heading','customer-card-menu','customer-card-actions saved-deal-actions']);
  assert.equal(ui.nodes().find(n=>n.props?.className==='saved-deal-venue').props.children, 'Echo House');
  assert.equal(ui.nodes().find(n=>n.props?.className==='saved-deal-availability').props.children, 'Active Club Deal');
  const link = ui.nodes().find(n=>n.props?.className==='saved-deal-view');
  assert.equal(link.props.href, '/deals/transportation/entry%2Fone');
  assert.equal(link.props.onClick, undefined);
  assert.equal(ui.nodes().find(n=>n.type==='summary').props['aria-label'], 'Manage saved deal Free admission');
  const directionProps = component(ui, 'CustomerDirectionsButton').props;
  assert.equal(directionProps.iconOnly, true);
  harness('CustomerDirectionsButton', directionProps).tree().props.onClick();
  assert.deepEqual(directions, [venue]);
  ui.nodes().find(n=>n.type==='button').props.onClick();
  assert.deepEqual(removed, ['entry/one']);
  ui.update({pendingAction:'deal-entry/one'});
  assert.equal(ui.nodes().find(n=>n.type==='button').props.disabled, true);
  assert.equal(component(ui, 'CustomerDirectionsButton').props.pending, true);
});

test('saved deal cards preserve scheduled, unavailable and device-only availability', () => {
  const base = { dealId:'deal', venue:{}, deal:{ title:'', isActive:true, validDays:['Friday'], validStartTime:'20:00', validEndTime:'23:30' } };
  const ui = harness('CustomerDealPassPanel', {savedDeals:[base],pendingAction:''});
  const availability = () => ui.nodes().find(n=>n.props?.className==='saved-deal-availability').props.children;
  assert.equal(availability(), 'Fri · 8 PM–11:30 PM');
  assert.equal(ui.nodes().find(n=>n.props?.className==='saved-deal-venue').props.children, 'Club');
  assert.ok(ui.nodes().some(n=>n.type==='strong'&&n.props.children==='Club Deal'));
  ui.update({savedDeals:[{...base,deal:{...base.deal,isActive:false}}]});
  assert.equal(availability(), 'No longer available');
  assert.ok(ui.nodes().some(n=>n.props?.className?.endsWith(' unavailable')));
  ui.update({savedDeals:[{...base,deviceOnly:true,deal:{...base.deal,isActive:false}}]});
  assert.equal(availability(), 'Saved on this device');
  assert.ok(!ui.nodes().some(n=>n.props?.className?.endsWith(' unavailable')));
});

test('compact directions keep an accessible label and tooltip without changing plan buttons', () => {
  const venue = {name:'Echo House'}, ui = harness('CustomerDirectionsButton', {venue,iconOnly:true,pending:true});
  assert.equal(ui.tree().props['aria-label'], 'Directions to Echo House');
  assert.equal(ui.tree().props.title, 'Directions to Echo House');
  assert.equal(ui.tree().props.disabled, true);
  assert.equal(ui.tree().props.children.props.icon, 'pin');
  ui.update({iconOnly:false,pending:false});
  assert.equal(ui.tree().props.children, 'Directions');
  assert.equal(ui.tree().props.title, undefined);
  assert.equal(ui.tree().props.disabled, false);
});
