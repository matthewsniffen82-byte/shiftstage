import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as roster from '../src/lib/dancr/venue-roster.ts';

const jsx = (type, props) => ({ type, props });
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] : [];
const copy = tree => Array.isArray(tree) ? tree.map(copy).join(' ') : tree && typeof tree === 'object' ? copy(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const source = name => readFileSync(`app/dashboard/${name}.tsx`, 'utf8');

// Invoke component events and effects against synthetic data. No browser or network.
function fixture(name, props, { hash = '', fail = '' } = {}) {
  let tree, cursor = 0, effects = [], dirty = false, timer = 0;
  const slots = [], listeners = new Map(), frames = new Map(), elements = new Map(), calls = [], focused = [];
  const react = {
    useState(initial) {
      const i = cursor++; slots[i] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v,j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((v,j) => !Object.is(v, prior.deps[j]))) effects.push(() => { prior?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const window = {
    location: { hash, pathname: '/dashboard/venue', search: '' },
    history: { replaceState(_state,_title,url) { window.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } },
    addEventListener(type,fn) { listeners.set(type,fn); }, removeEventListener(type) { listeners.delete(type); },
    dispatchEvent(event) { listeners.get(event.type)?.(); },
    requestAnimationFrame(fn) { frames.set(++timer,fn); return timer; }, cancelAnimationFrame(id) { frames.delete(id); },
    setInterval() { return ++timer; }, clearInterval() {}, setTimeout(fn) { frames.set(++timer,fn); },
    matchMedia: () => ({ matches: true }),
  };
  class Details { open = false; }
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById(id) {
    const node = nodes(tree).find(n => n.props?.id === id); if (!node) return null;
    if (!elements.has(id)) elements.set(id, Object.assign(node.type === 'details' ? new Details() : {}, {
      scrollIntoView() {}, focus: () => focused.push(id), querySelector: () => null, parentElement: null,
    }));
    return elements.get(id);
  } };
  const request = async kind => { calls.push(kind); if (fail === kind) throw new Error(`${kind} unavailable`); return kind === 'tags' ? { tags: [] } : { affiliations: [] }; };
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/dynamic': { default: loader => loader.toString().match(/\.\/(\w+)/)[1] }, 'next/link': { default: 'a' },
    './useVenueOperations': { useVenueOperations: () => ({ operations: { tablePending: 2 }, error: '' }) },
    './useVenueApprovalCompletion': { useVenueApprovalCompletion() {} },
    '@/src/lib/dancr/venue-dashboard-demo': { isVenueDashboardDemo: () => false },
    '@/src/lib/dancr/venue-roster': roster,
    './DashboardShared': { formatVenueReviewHours: () => '24 hours', DashboardSection: 'DashboardSection', SupportInboxPanel: 'SupportInboxPanel', NotificationPanel: 'NotificationPanel' },
    '../internal/InternalRoster': { InternalRoster: 'InternalRoster', VenueProfileProvider: 'VenueProfileProvider' },
    './dashboard-session': { readDashboardAccessToken: () => 'synthetic', requestVenueNfcTagsJson: () => request('tags'), requestVenueDancerVerificationsJson: () => request('roster') },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, window, document, HTMLDetailsElement: Details, HashChangeEvent: class { constructor(type) { this.type = type; } }, AbortController, Date, Error,
    require: id => imports[id] || new Proxy({}, { get: (_target,key) => key === '__esModule' ? false : String(key) }),
  });
  function render(next = {}) {
    props = { ...props, ...next }; dirty = true;
    for (let i = 0; dirty && i < 20; i++) { dirty = false; cursor = 0; effects = []; tree = (exports.VenuePanel || exports.default)(props); effects.forEach(fn => fn()); }
    assert.equal(dirty,false,'effects must settle');
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());
  }
  render();
  return {
    render, calls, focused, all: () => nodes(tree), text: () => copy(tree),
    find: id => nodes(tree).find(n => n.props?.id === id), byType: type => nodes(tree).find(n => n.type === type),
    element: id => document.getElementById(id),
    click(id) { nodes(tree).find(n => n.props?.id === id).props.onClick(); render(); },
    hash(value) { window.location.hash = value; listeners.get('hashchange')?.(); render(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const club = { account: { id: 'owner' }, profile: { id: 'club', name: 'Test Club', isActive: true, slug: 'test-club' },
  venueDeals: [{ isActive: true }], dealRequests: [], initialAffiliations: [], workingNow: [], supportThreads: [], refreshedAt: '2026-10-26',
  analyticsPeriod: 'tonight', venueAccess: { role: 'owner', permissions: ['view_roster','view_nfc','manage_roster','view_team'] } };

test('roster sections show one pane, load tables on demand, and preserve the opened table component', () => {
  const ui = fixture('VenueDashboardPanels',club,{ hash: '#venue-dancer-roster' });
  assert.equal(ui.find('venue-dancer-roster').props.hidden,false);
  assert.equal(ui.byType('VenueNfcTagPanel').props.view,'roster');
  assert.equal(ui.byType('InternalRoster'),undefined);
  ui.click('venue-roster-tables-tab');
  assert.equal(ui.find('venue-table-panel').props.hidden,false);
  assert.equal(ui.find('venue-dancer-roster').props.hidden,true);
  assert.equal(ui.byType('InternalRoster').props.operationsOnly,true);
  ui.click('venue-roster-new-dancers-tab');
  assert.equal(ui.find('venue-approval-panel').props.hidden,false);
  assert.equal(ui.byType('VenueApprovalsPanel').props.active,true);
  assert.equal(ui.byType('VenueApprovalsPanel').props.selectedTab,'dancers');
  ui.click('venue-roster-media-updates-tab');
  assert.equal(ui.byType('VenueApprovalsPanel').props.selectedTab,'media');
  assert.equal(ui.find('venue-approval-panel').props['aria-labelledby'],'venue-roster-media-updates-tab');
  assert.equal(ui.find('venue-table-panel').props.hidden,true);
  assert.ok(ui.byType('InternalRoster'),'keeps drafts mounted');
  ui.click('venue-workspace-tonight-tab');
  assert.equal(ui.byType('VenueApprovalsPanel').props.active,false);
  ui.close();
});

test('request and approval deep links select the corresponding roster section', () => {
  const ui = fixture('VenueDashboardPanels',club,{ hash: '#table-requests' });
  assert.equal(ui.find('venue-table-panel').props.hidden,false);
  ui.hash('#venue-media-reviews');
  assert.equal(ui.find('venue-approval-panel').props.hidden,false);
  assert.equal(ui.byType('VenueApprovalsPanel').props.selectedTab,'media');
  ui.hash('#venue-dancer-approvals');
  assert.equal(ui.byType('VenueApprovalsPanel').props.selectedTab,'dancers');
  ui.hash('#venue-approvals');
  assert.equal(ui.find('venue-roster-new-dancers-tab').props['aria-selected'],true);
  ui.hash('#venue-working-now');
  assert.equal(ui.find('venue-dancer-roster').props.hidden,false);
  assert.equal(ui.byType('VenueNfcTagPanel').props.workingOnly,true);
  ui.hash('#venue-dancer-roster');
  assert.equal(ui.byType('VenueNfcTagPanel').props.workingOnly,false);
  ui.close();
});

test('keyboard navigation follows allowed tabs; staff cannot expose approvals through a link', () => {
  const ui = fixture('VenueDashboardPanels',{ ...club, venueAccess: { role: 'staff', permissions: ['view_roster'] } },{ hash: '#venue-media-reviews' });
  assert.equal(ui.find('venue-roster-new-dancers-tab'),undefined);
  assert.equal(ui.find('venue-roster-media-updates-tab'),undefined);
  assert.equal(ui.byType('VenueApprovalsPanel'),undefined);
  assert.equal(ui.find('venue-dancer-roster').props.hidden,false);
  ui.find('venue-roster-dancers-tab').props.onKeyDown({ key: 'End', preventDefault() {} }); ui.render();
  assert.equal(ui.find('venue-table-panel').props.hidden,false);
  assert.equal(ui.focused.at(-1),'venue-roster-tables-tab');
  ui.find('venue-roster-tables-tab').props.onKeyDown({ key: 'Home', preventDefault() {} }); ui.render();
  assert.equal(ui.find('venue-dancer-roster').props.hidden,false);
  assert.equal(ui.focused.at(-1),'venue-roster-dancers-tab');
  ui.close();
});

test('separate approval buttons show independent pending counts and reset for a different club account',()=>{
  const ui=fixture('VenueDashboardPanels',club,{hash:'#venue-dancer-roster'});
  const badge=id=>nodes(ui.find(`venue-roster-${id}-tab`)).find(n=>n.props?.className==='venue-tab-count');
  assert.equal(badge('new-dancers').props.children,0);assert.equal(badge('media-updates').props.children,0);
  ui.byType('VenueApprovalsPanel').props.onCountsChange({dancers:2,media:5});ui.render();
  assert.equal(badge('new-dancers').props.children,2);assert.equal(badge('media-updates').props.children,5);
  assert.equal(badge('new-dancers').props['aria-label'],'2 pending dancers');
  assert.equal(badge('media-updates').props['aria-label'],'5 pending uploads');
  ui.click('venue-roster-media-updates-tab');
  ui.byType('VenueApprovalsPanel').props.onTabChange('dancers');ui.render();
  assert.equal(ui.find('venue-roster-new-dancers-tab').props['aria-selected'],true);
  ui.find('venue-roster-new-dancers-tab').props.onKeyDown({key:'ArrowRight',preventDefault(){}});ui.render();
  assert.equal(ui.byType('VenueApprovalsPanel').props.selectedTab,'media');
  assert.equal(ui.focused.at(-1),'venue-roster-media-updates-tab');
  ui.render({account:{id:'another-owner'},profile:{...club.profile,id:'another-club'}});
  assert.equal(badge('new-dancers').props.children,0);assert.equal(badge('media-updates').props.children,0);
  ui.close();
});

test('Tools & help loads only when opened and support deep links reveal it in Club', () => {
  const ui = fixture('VenueDashboardPanels',club,{ hash: '#venue-publication' });
  assert.equal(ui.byType('VenueNfcTagPanel'),undefined);
  assert.equal(ui.byType('SupportInboxPanel'),undefined);
  ui.hash('#venue-support');
  assert.equal(ui.find('venue-workspace-venue').props.hidden,false);
  assert.equal(ui.element('venue-tools').open,true);
  assert.equal(ui.byType('VenueNfcTagPanel').props.view,'tools');
  assert.ok(ui.byType('SupportInboxPanel'));
  ui.click('venue-workspace-tonight-tab');
  assert.ok(ui.byType('SupportInboxPanel'),'support draft stays mounted');
  ui.close();
});

test('a newly requested page review stays visible across tabs and opens the approval section', () => {
  const ui = fixture('VenueDashboardPanels', { ...club, venueAccess: { role: 'owner', permissions: ['manage_profile'] } });
  assert.equal(ui.find('venue-review-notice'), undefined);
  const profile = { ...club.profile, isActive: false, pageReviewStatus: 'venue_review' };
  ui.render({ profile, refreshedAt: '2026-10-27' });
  assert.equal(ui.find('venue-workspace-tonight').props.hidden, false, 'incoming review must not interrupt the current tab');
  assert.match(copy(ui.find('venue-review-notice')), /Your club page is ready to review/);
  ui.click('venue-workspace-roster-tab');
  assert.ok(ui.find('venue-review-notice'));
  const link = nodes(ui.find('venue-review-notice')).find(n => n.type === 'a');
  assert.equal(link.props.href, '#venue-publication');
  let prevented = false;
  link.props.onClick({ preventDefault() { prevented = true; } }); ui.render();
  assert.equal(prevented, true);
  assert.equal(ui.find('venue-workspace-venue').props.hidden, false);
  assert.ok(ui.focused.includes('venue-publication'));
  const inbox = ui.byType('NotificationPanel');
  assert.equal(inbox.props.refreshKey, '2026-10-27:0');
  ui.click('venue-workspace-tonight-tab');
  inbox.props.onVenueReview({ preventDefault() {} }); ui.render();
  assert.equal(ui.find('venue-workspace-venue').props.hidden, false);
  ui.render({ profile: { ...profile, pageReviewStatus: 'changes_requested' } });
  assert.equal(ui.find('venue-review-notice'), undefined);
  ui.render({ profile: { ...club.profile, pageReviewStatus: 'published' } });
  assert.equal(ui.find('venue-review-notice'), undefined);
  ui.close();
});

test('review email deep links reveal approval on load; staff do not see a review action banner', () => {
  const props = { ...club, profile: { ...club.profile, isActive: false, pageReviewStatus: 'venue_review' } };
  const ui = fixture('VenueDashboardPanels', props, { hash: '#venue-publication' });
  assert.equal(ui.find('venue-workspace-venue').props.hidden, false);
  assert.ok(ui.focused.includes('venue-publication'));
  ui.close();
  const staff = fixture('VenueDashboardPanels', { ...props, venueAccess: { role: 'staff', permissions: ['view_roster'] } });
  assert.equal(staff.find('venue-review-notice'), undefined);
  staff.close();
});

for (const view of ['roster','tools','all']) test(`${view} view loads only its relevant data and controls`, async () => {
  const ui = fixture('VenueNfcTagPanel',{ view, timeZone: 'America/Los_Angeles', workingOnly: false, onWorkingOnlyChange() {} });
  await ui.settle();
  assert.deepEqual(ui.calls, view === 'all' ? ['tags','roster'] : view === 'tools' ? ['tags'] : ['roster']);
  assert.equal(Boolean(ui.byType('InternalRoster')),view === 'all');
  assert.equal(ui.all().some(n => n.props?.className === 'venue-roster-stickers'),view !== 'roster');
  assert.equal(ui.all().some(n => n.props?.className === 'venue-nfc-roster'),view === 'roster');
  ui.close();
});

test('moved check-in tools retain actionable loading errors', async () => {
  const ui = fixture('VenueNfcTagPanel',{ view: 'tools', timeZone: 'America/Los_Angeles', workingOnly: false },{ fail: 'tags' });
  await ui.settle(); assert.match(ui.text(),/tags unavailable/); ui.close();
});

test('Tonight shows only pending actions, keeps working-now navigation, and omits manager-only queues for staff', () => {
  const ui = fixture('VenueTonightOverview',{ operations: { tablePending: 0, guestExpected: 0, vipPending: 0, ridesOpen: 0, admitted: 2 }, working: 0, manager: true, published: true });
  assert.doesNotMatch(ui.text(),/Needs attention/);
  assert.equal(ui.all().find(n => n.props?.href === '#venue-working-now').props.className,undefined);
  ui.render({ operations: { tablePending: 3, guestExpected: 2, vipPending: 1, ridesOpen: 4 }, working: 5 });
  assert.match(ui.text(),/3\s+table requests/); assert.match(ui.text(),/2\s+awaiting admission/);
  assert.equal(ui.all().find(n => n.props?.href === '#venue-working-now').props.className,'is-live');
  ui.render({ manager: false }); assert.doesNotMatch(ui.text(),/vip requests|ride requests/); ui.close();
});
