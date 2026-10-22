import { refreshButtonModule } from './helpers/refresh-button.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { RIDE_STATUSES } from "../src/lib/dancr/venue-operations.ts";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
class DashboardDataRequestError extends Error { constructor(message,status) { super(message); this.status=status; } }
// Component events and mocked responses only; no browser, server, or network.
function fixture(component, props, request = async () => ({}), hash = "") {
  const slots = [], calls = [], listeners = new Map(), intervals = new Map(), frames = new Map(), focused = [];
  let cursor = 0, effects = [], dirty = false, tree, timer = 0;
  const react = {
    useState(initial) {
      const i = cursor++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, next => {
        const value = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useCallback(callback, deps) {
      const i = cursor++, prior = slots[i];
      if (!prior || deps.some((value, j) => !Object.is(value, prior.deps[j]))) slots[i] = { value: callback, deps };
      return slots[i].value;
    },
    useEffect(effect, deps) {
      const i = cursor++, prior = slots[i];
      if (!prior || deps.some((value, j) => !Object.is(value, prior.deps[j]))) effects.push(() => {
        prior?.cleanup?.(); slots[i] = { deps, cleanup: effect() };
      });
    },
  };
  const window = {
    location: { hash }, history: { replaceState: (_state, _title, value) => { window.location.hash = value; } },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    setInterval: fn => { intervals.set(++timer, fn); return timer; }, clearInterval: id => intervals.delete(id),
    requestAnimationFrame: fn => { frames.set(++timer, fn); return timer; }, cancelAnimationFrame: id => frames.delete(id),
  };
  const document = {
    visibilityState: "visible",
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    getElementById: id => {
      const node = nodes().find(item => item.props?.id === id);
      return node ? { hidden: node.props.hidden, focus: () => focused.push(id), scrollIntoView() {} } : null;
    },
  };
  const send = (url, options) => { calls.push({ url, options }); return request(url, options); };
  const imports = {
    "../components/RefreshButton": refreshButtonModule,
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "next/dynamic": { default: loader => loader.toString().match(/\.\/(\w+)/)[1] },
    "next/link": { default: "a" }, "./venue-guests.css": {}, "./venue-customers.css": {}, "./venue-guest-list.css": {},
    "@/src/lib/dancr/venue-operations": { RIDE_STATUSES, notifyVenueOperationsChanged() {} },
    "./VenueDashboardIdentity": { VenueDashboardIcon: () => null },
    "./dashboard-session": { requestDashboardJson: send, DashboardDataRequestError }, "../pickups/pickup-session": { requestPickupJson: send },
    "@/src/lib/dancr/club-deal-transportation": { clubArrivalLabel: () => "Driving" },
  };
  const exports = {};
  const isHook = component === "useVenueOperations";
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../app/dashboard/${component}.${isHook ? "ts" : "tsx"}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, window, document, AbortController, URLSearchParams, Error, require: name => {
    assert.ok(name in imports, name); return imports[name];
  } });
  function nodes(node = tree) { if (node?.type === refreshButtonModule.default) return nodes(node.type(node.props)); return node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)] : []; }
  function render(next = {}) {
    props = { ...props, ...next }; dirty = true;
    for (let i = 0; dirty && i < 20; i++) { dirty = false; cursor = 0; effects = []; tree = isHook ? exports.useVenueOperations(props.venueId, props.refreshKey) : exports.default(props); effects.forEach(run => run()); }
    assert.equal(dirty, false); return tree;
  }
  function flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(run => run()); }
  async function settle() { await new Promise(resolve => setImmediate(resolve)); render(); flushFrames(); }
  render(); flushFrames();
  return { render, nodes, settle, calls, focused, intervals, window, value: () => tree, html: () => renderToStaticMarkup(tree),
    button: label => nodes().find(node => node.type === "button" && (node.props['aria-label'] === label || [node.props.children].flat().some(child => child === label || child?.props?.children === label))),
    pane: id => nodes().find(node => node.props?.role === "tabpanel" && node.props.id === id),
    hash(value) { window.location.hash = value; listeners.get("hashchange")?.(); render(); flushFrames(); },
    tick() { [...intervals.values()].forEach(run => run()); },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const guestProps = { venueId: "venue-a", role: "owner", active: true, timezone: "America/Los_Angeles" };

for (const config of [
  { component: "VenueCustomersPanel", pageSize: 50, offset: "offset", more: "Load more contacts", result: (entries, hasMore) => ({ entries, hasMore }),
    row: id => ({ id, name: `Contact ${id}`, joined_at: "2026-10-21T20:00:00Z", is_guest: true }) },
  { component: "PickupDashboardPanel", pageSize: 30, offset: "phoneOffset", more: "Load older requests", result: (phoneRequests, hasMorePhoneRequests) => ({ phoneRequests, hasMorePhoneRequests }),
    row: id => ({ id, venue_id: "venue-a", name: `Ride ${id}`, phone: "+17025550123", requested_at: "2026-10-21T20:00:00Z" }) },
]) {
  test(`${config.component}: refresh keeps all loaded pages visible until the complete replacement is ready`, async () => {
    const rows = Array.from({ length: config.pageSize + 3 }, (_, i) => config.row(String(i)));
    let mode = "initial", finish;
    const ui = fixture(config.component, { ...guestProps, refreshKey: "initial" }, async url => {
      const offset = Number(new URL(url, "https://example.test").searchParams.get(config.offset));
      if (mode === "revoked") throw new DashboardDataRequestError("Access removed", 403);
      if (mode === "empty") return config.result([], false);
      const next = rows.slice(offset, offset + config.pageSize).map(row => mode === "initial" ? row : { ...row, name: `${row.name} updated` });
      if (offset && mode === "slow") return new Promise(resolve => { finish = () => resolve(config.result(next, false)); });
      if (offset && mode === "offline") throw new Error("Connection interrupted");
      return config.result(next, offset === 0);
    });
    const cards = () => ui.nodes().filter(node => node.type === "article");
    await ui.settle(); ui.button(config.more).props.onClick(); await ui.settle();
    assert.equal(cards().length, rows.length);
    const keys = cards().map(card => card.key);
    mode = "slow"; ui.render({ refreshKey: "timer-1" });
    assert.equal(cards().length, rows.length); assert.doesNotMatch(ui.html(), /Loading ride requests/);
    await ui.settle();
    assert.equal(typeof finish, "function"); assert.deepEqual(cards().map(card => card.key), keys);
    assert.doesNotMatch(ui.html(), /updated/);
    finish(); await ui.settle();
    assert.deepEqual(cards().map(card => card.key), keys); assert.match(ui.html(), /updated/);

    mode = "offline"; ui.render({ refreshKey: "timer-2" }); await ui.settle();
    assert.equal(cards().length, rows.length); assert.match(ui.html(), /Connection interrupted/);
    mode = "empty"; ui.render({ refreshKey: "timer-3" }); await ui.settle();
    assert.equal(cards().length, 0);
    mode = "initial"; ui.render({ refreshKey: "timer-4" }); await ui.settle();
    assert.equal(cards().length, config.pageSize);
    mode = "revoked"; ui.render({ refreshKey: "timer-5" }); await ui.settle();
    assert.equal(cards().length, 0); assert.match(ui.html(), /Access removed/);
    ui.close();
  });
}

test("ride polling retains cards while waiting, but changing the venue removes the previous venue's cards", async () => {
  let finish;
  const ui = fixture("PickupDashboardPanel", guestProps, async () => new Promise(resolve => { finish = resolve; }));
  finish({ phoneRequests: [{ id: "ride", venue_id: "venue-a", name: "Current guest", requested_at: "2026-10-21" }], hasMorePhoneRequests: false });
  await ui.settle(); ui.tick(); ui.render();
  assert.match(ui.html(), /Current guest/); assert.doesNotMatch(ui.html(), /Loading ride requests/);
  const late = finish;
  ui.render({ venueId: "venue-b" }); assert.doesNotMatch(ui.html(), /Current guest/);
  late({ phoneRequests: [{ id: "late", venue_id: "venue-a", name: "Old venue guest" }], hasMorePhoneRequests: false });
  await ui.settle(); assert.doesNotMatch(ui.html(), /Old venue guest/); ui.close();
});

test("contacts clear only when their source changes, ignoring a late response from the previous source", async () => {
  let finish;
  const ui = fixture("VenueCustomersPanel", { ...guestProps, refreshKey: "first" }, () => new Promise(resolve => { finish = resolve; }));
  finish({ entries: [{ id: "contact", name: "Current contact", joined_at: "2026-10-21" }], hasMore: false });
  await ui.settle(); ui.render({ refreshKey: "second" });
  assert.match(ui.html(), /Current contact/);
  const late = finish;
  ui.button("Shared followers").props.onClick(); ui.render();
  assert.doesNotMatch(ui.html(), /Current contact/);
  late({ entries: [{ id: "late", name: "Wrong source", joined_at: "2026-10-21" }], hasMore: false });
  await ui.settle(); assert.doesNotMatch(ui.html(), /Wrong source/); ui.close();
});

test("live operation counts survive refresh and temporary failures, then update or clear on confirmed access loss", async () => {
  let response = { operations: { tablePending: 4, ridesOpen: 3 } }, finish;
  const ui = fixture("useVenueOperations", guestProps, async () => {
    if (response instanceof Error) throw response;
    if (response === null) return new Promise(resolve => { finish = resolve; });
    return response;
  });
  await ui.settle(); assert.equal(ui.value().operations.tablePending, 4);
  response = null; ui.render({ refreshKey: "new" });
  assert.equal(ui.value().operations.tablePending, 4);
  finish({ operations: { tablePending: 2, ridesOpen: 0 } }); await ui.settle();
  assert.equal(ui.value().operations.tablePending, 2); assert.equal(ui.value().operations.ridesOpen, 0);
  response = new Error("Offline"); ui.tick(); await ui.settle();
  assert.equal(ui.value().operations.tablePending, 2); assert.match(ui.value().error, /could not update/);
  response = { operations: { tablePending: 0 } }; ui.tick(); await ui.settle();
  assert.equal(ui.value().operations.tablePending, 0); assert.equal(ui.value().error, "");
  response = new DashboardDataRequestError("Access removed", 403); ui.tick(); await ui.settle();
  assert.equal(ui.value().operations, null); ui.close();
});

test("live operation counts never carry across venues or accept stale responses", async () => {
  let finish;
  const ui = fixture("useVenueOperations", guestProps, () => new Promise(resolve => { finish = resolve; }));
  finish({ operations: { tablePending: 7 } }); await ui.settle();
  ui.tick(); const late = finish;
  ui.render({ venueId: "venue-b" }); assert.equal(ui.value().operations, null);
  late({ operations: { tablePending: 99 } }); await ui.settle(); assert.equal(ui.value().operations, null);
  finish({ operations: { tablePending: 1 } }); await ui.settle(); assert.equal(ui.value().operations.tablePending, 1);
  ui.render({ venueId: undefined }); assert.equal(ui.value().operations, null); ui.close();
});

test("Contacts shows the shared total before opening and updates its badge including zero", () => {
  const ui = fixture("VenueGuestsPanel", { ...guestProps, operations: { contactsShared: 127 } });
  const badge = () => ui.nodes(ui.button("Contacts")).find(node => node.props?.className === "venue-tab-count");
  assert.equal(badge().props.children,127);
  assert.equal(badge().props['aria-label'],"127 shared contacts");
  assert.ok(!ui.nodes().some(node => node.type === "VenueCustomersPanel"));
  ui.button("Contacts").props.onClick(); ui.render();
  assert.equal(badge().props.children,127);
  ui.render({ operations: { contactsShared: 0 } });
  assert.equal(badge().props.children,0);
  ui.render({ operations: null }); assert.equal(badge(),undefined);
  ui.close();
});

test("Guests loads tabs on demand and retains opened panes and drafts while marking hidden tools inactive", () => {
  const ui = fixture("VenueGuestsPanel", guestProps);
  assert.equal(ui.nodes().filter(node => node.props.role === "tab").length, 4);
  assert.ok(ui.nodes().some(node => node.type === "VenueGuestListPanel"));
  assert.ok(!ui.nodes().some(node => node.type === "VenueVipPanel"));
  ui.button("VIP requests").props.onClick(); ui.render();
  assert.equal(ui.pane("venue-vip").props.hidden, false);
  assert.ok(ui.nodes().find(node => node.type === "VenueVipPanel").props.active);
  ui.button("Guest list").props.onClick(); ui.render();
  assert.equal(ui.pane("venue-vip").props.hidden, true);
  assert.equal(ui.nodes().find(node => node.type === "VenueVipPanel").props.active, false);
  ui.button("Guest list").props.onKeyDown({ key: "End", preventDefault() {} }); ui.render();
  assert.equal(ui.window.location.hash, "#venue-customers");
  assert.equal(ui.focused.at(-1), "venue-customers-tab");
  assert.equal(ui.button("Contacts").props.tabIndex, 0);
  ui.render({ active: false });
  assert.ok(ui.nodes().filter(node => /Panel$/.test(String(node.type))).every(node => node.props.active === false));
  ui.close();
});

test("existing notification and contact links select and focus their guest tab without losing unrelated navigation", () => {
  const ui = fixture("VenueGuestsPanel", guestProps, undefined, "#venue-pickups");
  assert.equal(ui.pane("venue-pickups").props.hidden, false);
  assert.equal(ui.focused.at(-1), "venue-pickups");
  ui.hash("#venue-customers"); assert.equal(ui.pane("venue-customers").props.hidden, false);
  assert.equal(ui.focused.at(-1), "venue-customers");
  ui.hash("#venue-overview"); assert.equal(ui.button("Contacts").props["aria-selected"], true);
  ui.close();
});

test("staff and unresolved roles cannot mount private ride, VIP or contacts panes through hashes", () => {
  for (const role of ["staff", ""]) {
    const ui = fixture("VenueGuestsPanel", { ...guestProps, role }, undefined, "#venue-customers");
    assert.equal(ui.nodes().filter(node => node.props.role === "tab").length, 1);
    ui.hash("#venue-pickups");
    assert.ok(!ui.nodes().some(node => ["VenueCustomersPanel", "PickupDashboardPanel", "VenueVipPanel"].includes(node.type)));
    assert.equal(ui.pane("venue-guest-list").props.hidden, false); ui.close();
  }
});

const ride = { id: "ride-1", venue_id: "venue-a", venue_name: "Club A", name: "Ride Guest", phone: "+17025550123", email: "ride@example.test", location: "Hotel lobby", party_size: 3, requested_at: "2026-10-11T22:12:00Z" };
test("ride details are scoped to the current venue, paginate without duplication and clear after access failure", async () => {
  let fail = false;
  const ui = fixture("PickupDashboardPanel", guestProps, async url => {
    if (fail) throw new DashboardDataRequestError("Access removed", 403);
    const params = new URL(url, "https://example.test").searchParams;
    assert.equal(params.get("venueId"), "venue-a");
    return params.get("phoneOffset") === "0"
      ? { phoneRequests: [ride, { ...ride, id: "foreign", venue_id: "other", name: "Foreign guest" }], hasMorePhoneRequests: true }
      : { phoneRequests: [ride, { ...ride, id: "ride-2", name: "Earlier guest" }], hasMorePhoneRequests: false };
  });
  await ui.settle();
  assert.match(ui.html(), /Hotel lobby|tel:\+17025550123/); assert.doesNotMatch(ui.html(), /Foreign guest/);
  assert.match(ui.html(), /Received/); assert.match(ui.html(), /Statuses are recorded by your team/);
  ui.button("Load older requests").props.onClick(); await ui.settle();
  assert.equal(ui.nodes().filter(node => node.type === "article").length, 2);
  assert.match(ui.calls.at(-1).url, /phoneOffset=1/);
  const count = ui.calls.length; ui.tick(); await ui.settle(); assert.equal(ui.calls.length, count);
  fail = true; ui.button("Refresh ride requests").props.onClick(); await ui.settle();
  assert.equal(ui.nodes().filter(node => node.type === "article").length, 0);
  assert.match(ui.html(), /Access removed/); ui.close(); assert.equal(ui.intervals.size, 0);
});

test("inactive ride tabs stop polling and abort pending loads before a venue changes", async () => {
  let resolve;
  const ui = fixture("PickupDashboardPanel", { ...guestProps, active: false }, () => new Promise(done => { resolve = done; }));
  assert.equal(ui.calls.length, 0); assert.equal(ui.intervals.size, 0);
  ui.render({ active: true }); assert.equal(ui.calls.length, 1);
  ui.render({ active: false }); assert.equal(ui.calls[0].options.signal.aborted, true); assert.equal(ui.intervals.size, 0);
  resolve({ phoneRequests: [ride], hasMorePhoneRequests: false }); await ui.settle();
  assert.doesNotMatch(ui.html(), /Ride Guest/);
  ui.render({ active: true, venueId: "venue-b" }); assert.match(ui.calls.at(-1).url, /venueId=venue-b/); ui.close();
});

test("guest list shows recorded admission details and removes private entries after access is revoked", async () => {
  let fail = false;
  const ui = fixture("VenueGuestListPanel", guestProps, async () => {
    if (fail) throw new DashboardDataRequestError("Access removed",403);
    return { entries: [{ id: "pass", name: "Admitted guest", phone: ride.phone, email: null, createdAt: ride.requested_at,
      expiresAt: "2026-10-12T12:00:00Z", arrivalMethod: "self_drive", status: "redeemed", redeemedAt: null }], hasMore: false, counts: {all:1,redeemed:1,generated:0}, updatedAt:'2026-10-12T01:00:00Z' };
  });
  await ui.settle(); assert.match(ui.html(), /Admitted/); assert.match(ui.html(), /Time unavailable/);
  assert.match(ui.html(), /Pass valid until/); assert.match(ui.html(), /America\/Los Angeles/);
  fail = true; ui.button("Refresh guest list").props.onClick(); await ui.settle();
  assert.doesNotMatch(ui.html(), /Admitted guest/); assert.match(ui.html(), /Access removed/); ui.close();
});

test("shared contacts show sharing purpose separately from email and text subscriptions", async () => {
  const ui = fixture("VenueCustomersPanel", { refreshKey: "owner", active: true }, async () => ({ entries: [
    { id: "contact", name: "Guest", email: "guest@example.test", phone: null, is_guest: true, is_follower: false, joined_at: ride.requested_at },
  ], hasMore: false }));
  await ui.settle();
  assert.match(ui.html(), /Current guest-list visit/); assert.match(ui.html(), /Email updates/); assert.match(ui.html(), /Text updates/);
  assert.equal((ui.html().match(/No active opt-in recorded/g) || []).length, 2);
  assert.match(ui.html(), /mailto:guest%40example.test/); assert.ok(ui.calls.every(call => !call.options.method)); ui.close();
});

const guestRow = index => ({ id: `pass-${index}`, name: `Guest ${index}`, phone: ride.phone, email: 'guest@example.test',
  createdAt: ride.requested_at, expiresAt: '2026-10-12T12:00:00Z', arrivalMethod:'self_drive',status:'generated' });
const guestPage = (entries, extra={}) => ({entries,hasMore:false,counts:{all:entries.length,generated:entries.length,redeemed:0},updatedAt:'2026-10-12T01:00:00Z',timezone:'America/Los_Angeles',...extra});

test('guest refresh retains every loaded page and scroll position; a new filter resets the list',async()=>{
 let hold=false, release;
 const ui=fixture('VenueGuestListPanel',guestProps,async url=>{
  if(hold){await new Promise(resolve=>{release=resolve;});hold=false;}
  const p=new URL(url,'https://example.test').searchParams;
  const start=Number(p.get('offset')),length=start===0?50:5;
  return guestPage(Array.from({length},(_,i)=>guestRow(start+i)),{hasMore:start===0,counts:{all:55,generated:55,redeemed:0}});
 });
 await ui.settle();assert.match(ui.calls[0].url,/period=tonight/);assert.match(ui.html(),/55 guests in this view/);
 assert.equal(ui.nodes().filter(n=>n.type==='details').length,50);
 const region=ui.nodes().find(n=>n.props.className==='venue-guest-scroll');region.props.ref.current={scrollTop:240};
 ui.button('Load more guests').props.onClick();await ui.settle();assert.equal(ui.nodes().filter(n=>n.type==='details').length,55);
 hold=true;ui.button('Refresh guest list').props.onClick();ui.render();assert.match(ui.html(),/Guest 54/);assert.match(ui.html(),/Updating/);
 release();await ui.settle();assert.equal(ui.nodes().filter(n=>n.type==='details').length,55);assert.equal(region.props.ref.current.scrollTop,240);
 assert.match(ui.calls.at(-1).url,/offset=50/);
 ui.button('Admitted').props.onClick();ui.render();assert.equal(region.props.ref.current.scrollTop,0);assert.doesNotMatch(ui.html(),/Guest 54/);
 await ui.settle();assert.match(ui.calls.at(-1).url,/status=redeemed/);assert.match(ui.calls.at(-1).url,/offset=0/);ui.close();
});

test('transient guest refresh failures retain details and Retry recovers without an empty-state flash',async()=>{
 let fail=false;
 const ui=fixture('VenueGuestListPanel',guestProps,async()=>{if(fail)throw new DashboardDataRequestError('Try again.',503);return guestPage([guestRow(1)]);});
 await ui.settle();fail=true;ui.button('Refresh guest list').props.onClick();await ui.settle();
 assert.match(ui.html(),/Guest 1/);assert.match(ui.html(),/Showing the last loaded list/);assert.doesNotMatch(ui.html(),/No guests tonight/);
 fail=false;ui.button('Retry').props.onClick();await ui.settle();assert.doesNotMatch(ui.html(),/role="alert"/);assert.match(ui.html(),/Guest 1/);ui.close();
});

test('guest search, empty states and date selection remain separate from admission controls',async()=>{
 const ui=fixture('VenueGuestListPanel',guestProps,async()=>guestPage([]));await ui.settle();assert.match(ui.html(),/No guests tonight/);
 ui.nodes().find(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'Nobody'}});ui.render();
 ui.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});ui.render();await ui.settle();
 assert.match(ui.html(),/No guests match your search/);assert.match(ui.calls.at(-1).url,/search=Nobody/);
 ui.button('Clear filters').props.onClick();ui.render();await ui.settle();
 const calls=ui.calls.length;ui.nodes().find(n=>n.type==='select').props.onChange({target:{value:'date'}});ui.render();
 assert.equal(ui.calls.length,calls);assert.match(ui.html(),/Choose a date to see/);
 ui.nodes().find(n=>n.props.type==='date').props.onChange({target:{value:'2026-10-11'}});ui.render();await ui.settle();
 assert.match(ui.calls.at(-1).url,/date=2026-10-11/);assert.match(ui.html(),/No guests for this date/);
 assert.doesNotMatch(ui.html(),/Scan pass|Mark admitted|Verify admission/);ui.close();
});

test('hidden guest tabs abort pending refreshes and ignore late private data',async()=>{
 let resolve;
 const ui=fixture('VenueGuestListPanel',{...guestProps,active:false},()=>new Promise(done=>{resolve=done;}));
 assert.equal(ui.calls.length,0);ui.render({active:true});ui.render({active:false});assert.equal(ui.calls[0].options.signal.aborted,true);
 resolve(guestPage([guestRow(1)]));await ui.settle();assert.doesNotMatch(ui.html(),/Guest 1/);ui.close();
});

test("guest searches and status filters restart pagination and reach the server", async () => {
  const ui = fixture("VenueGuestListPanel", guestProps, async () => guestPage([]));
  await ui.settle();
  ui.nodes().find(n => n.type === "input").props.onChange({ target: { value: "María" } }); ui.render();
  ui.nodes().find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); await ui.settle();
  let params = new URL(ui.calls.at(-1).url, "https://example.test").searchParams;
  assert.equal(params.get("search"), "María"); assert.equal(params.get("offset"), "0");
  ui.button("Awaiting admission").props.onClick(); await ui.settle();
  params = new URL(ui.calls.at(-1).url, "https://example.test").searchParams;
  assert.equal(params.get("status"), "generated"); assert.equal(params.get("search"), "María");
  ui.close();
});

test("ride status saves persist the expected version, avoid duplicate writes and remove completed open requests", async () => {
  let finish;
  const ui = fixture("PickupDashboardPanel", guestProps, async (_url, options) => {
    if (options.method === "POST") return new Promise(resolve => { finish = resolve; });
    return { phoneRequests: [{ ...ride, staff_status: "received", staff_status_version: 2 }], hasMorePhoneRequests: false };
  });
  await ui.settle();
  const selector = () => ui.nodes().find(n => n.type === "select" && n.props["aria-label"] === "Ride status for Ride Guest");
  selector().props.onChange({ target: { value: "completed" } }); ui.render();
  selector().props.onChange({ target: { value: "cancelled" } }); ui.tick(); await ui.settle();
  const writes = ui.calls.filter(c => c.options.method === "POST"); assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].options.body), { id: "ride-1", status: "completed", version: 2 });
  finish({ ride: { id: "ride-1", staff_status: "completed", staff_status_version: 3 } }); await ui.settle();
  assert.equal(ui.nodes().filter(n => n.type === "article").length, 0); ui.close();
});

test("failed ride updates retain the recorded status and allow a refresh", async () => {
  const ui = fixture("PickupDashboardPanel", guestProps, async (_url, options) => {
    if (options.method === "POST") throw new Error("Another staff member updated this ride. Refresh before trying again.");
    return { phoneRequests: [{ ...ride, staff_status: "contacted", staff_status_version: 1 }], hasMorePhoneRequests: false };
  });
  await ui.settle();
  const selector = () => ui.nodes().find(n => n.type === "select" && n.props["aria-label"]);
  selector().props.onChange({ target: { value: "arranged" } }); await ui.settle();
  assert.equal(selector().props.value, "contacted"); assert.match(ui.html(), /Another staff member/);
  assert.equal(ui.button("Refresh ride requests").props.disabled, false); ui.close();
});

test("ride updates clear private guest details when access is lost", async () => {
  for (const status of [401, 403]) {
    const ui = fixture("PickupDashboardPanel", guestProps, async (_url, options) => {
      if (options.method === "POST") throw Object.assign(new Error("Access removed"), { status });
      return { phoneRequests: [ride], hasMorePhoneRequests: true };
    });
    await ui.settle();
    ui.nodes().find(n => n.type === "select" && n.props["aria-label"]).props.onChange({ target: { value: "arranged" } });
    await ui.settle();
    assert.doesNotMatch(ui.html(), /Ride Guest|Hotel lobby|ride@example/);
    assert.match(ui.html(), /Access removed/);
    assert.equal(ui.button("Load older requests"), undefined); ui.close();
  }
});
