import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as accessTerms from "../src/lib/dancr/access-terms.ts";
import * as guestTheme from "../src/lib/dancr/venue-guest-theme.ts";
import { DEMO_TABLE_REQUEST_COUNT } from "../src/lib/dancr/venue-dashboard-demo.ts";

const require = createRequire(import.meta.url);
const refreshButtonModule = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/components/RefreshButton.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: refreshButtonModule, require });
const source = readFileSync(new URL("../app/internal/InternalRoster.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(`${source}\nexport { rosterFetch, ProtectedMedia };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const refreshInterval = 20 * 60 * 1000;
const sessionKey = "dancrAuthSessionV1";
const dancer = { id: "dancer-1", stageName: "Demo dancer", mainPhotoId: null };
const roster = { ok: true, venueName: "Demo club", dancers: [dancer] };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(fetch, { token = "table-token", session = null, component = "InternalRoster", props = {}, sharedOpen = null, persistRefresh = false, url = "https://example.invalid/internal/club/table-token" } = {}) {
  let now = 0;
  let nextTimer = 0;
  let nextRequestKey = 0;
  const timers = new Map();
  const schedule = (callback, delay, interval = false) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: now + delay, interval: interval ? delay : 0 });
    return id;
  };
  const states = [];
  const refs = [];
  const effects = [];
  const latestEffects = [];
  const cleanups = [];
  const persisted = [];
  const replacements = [];
  const navigations = [];
  const listeners = new Map();
  const documentListeners = new Map();
  const elements = new Map();
  class HTMLDetailsElement {}
  const document = {
    visibilityState: "visible",
    getElementById: id => elements.get(id),
    addEventListener: (name, callback) => documentListeners.set(name, callback),
    removeEventListener: name => documentListeners.delete(name),
  };
  let stateIndex = 0;
  let refIndex = 0;
  let mounting = true;
  const exports = {};
  const window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    location: { hash: new URL(url).hash, href: url, assign: href => navigations.push(href) }, history: { state: null, replaceState: (_state, _title, path) => replacements.push(path) },
    requestAnimationFrame: callback => schedule(callback, 0), cancelAnimationFrame: id => timers.delete(id),
  };
  vm.runInNewContext(code, {
    exports, fetch, document, HTMLDetailsElement, Error, AbortController, URL, crypto: { randomUUID: () => `request-key-${++nextRequestKey}` },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => schedule(callback, delay),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearTimeout: id => timers.delete(id),
    clearInterval: id => timers.delete(id),
    window,
    require(name) {
      if (name === "react/jsx-runtime") return require(name);
      if (name === "../components/RefreshButton") return refreshButtonModule;
      if (name.endsWith(".css")) return {};
      if (name === "react") return {
        createContext: () => ({ Provider: "VenueProfileContext" }), useContext: () => sharedOpen,
        useState(initial) {
          const index = stateIndex++;
          if (mounting) states[index] = component === "VenueRosterProfileButton" && index === 0 ? true : initial;
          return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
        },
        useRef(initial) {
          const index = refIndex++;
          if (mounting) refs[index] = { current: initial };
          return refs[index];
        },
        useCallback: callback => callback,
        useEffect: callback => { latestEffects.push(callback); if (mounting) effects.push(callback); },
      };
      if (name === "../dashboard/VenueAdminUtilities") return { default: () => null };
      if (name === "../dashboard/VenueGridImage") return { default: "VenueGridImage" };
      if (name === "./InternalRequestPushSettings") return { InternalRequestPushSettings: () => null };
      if (name === "./FullProfileDialog") return { ClubProfileDialog: function ClubProfileDialog() {} };
      if (name === "./InternalFullProfile") return { InternalFullProfile: () => null };
      if (name === "@/src/lib/dancr/access-terms") return accessTerms;
      if (name === "@/src/lib/dancr/venue-guest-theme") return guestTheme;
      if (name === "@/src/lib/dancr/venue-dashboard-demo") return { DEMO_TABLE_REQUEST_COUNT };
      if (name === "@/src/lib/dancr/browser-session") return {
        BROWSER_AUTH_SESSION_KEY: sessionKey,
        readBrowserAuthSession: () => session,
        isCurrentBrowserSession: expected => expected?.accessToken === session?.accessToken,
        persistRefreshedBrowserAuthSession: (...args) => { persisted.push(args); if (persistRefresh && args[0]?.accessToken) session = { ...session, ...args[0] }; },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    latestEffects.length = 0;
    const tree = exports[component]({ token, dancerId: dancer.id, stageName: dancer.stageName, ...props });
    mounting = false;
    return tree;
  };
  return {
    exports, persisted, timers, render, replacements, navigations, listeners, documentListeners, elements, HTMLDetailsElement, window,
    runEffect: (index, cleanupPrevious = false) => { if (cleanupPrevious) cleanups[index]?.(); cleanups[index] = latestEffects[index](); },
    focus: () => listeners.get("focus")?.(),
    pageshow: persisted => listeners.get("pageshow")?.({ persisted }),
    visibility: value => { document.visibilityState = value; documentListeners.get("visibilitychange")?.(); },
    setSession: next => { session = next; },
    storage: key => listeners.get("storage")?.({ key }),
    async mount() { render(); effects.forEach(effect => cleanups.push(effect())); await flush(); },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (Array.isArray(tree)) return tree.map(item => find(item, predicate)).find(Boolean);
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
const alert = app => find(app.render(), node => node.props?.role === "alert");
const alertMessage = app => find(alert(app), node => node.type === "p")?.props.children;
const grid = app => find(app.render(), node => node.props?.className === "ir-grid ir-directory-grid");
const profile = app => find(app.render(), node => node.type?.name === "ClubProfileDialog")?.props.profile;
const requestButton = (app, id) => find(find(app.render(), node => node.type === "article" && node.key === id), node => node.props?.className === "ir-table-request");
const cardNotice = (app, id) => find(find(app.render(), node => node.type === "article" && node.key === id), node => node.props?.className === "ir-dancer-notice");
const refreshButton = app => {
  const node = find(app.render(), node => node.type === refreshButtonModule.default);
  return node ? node.type(node.props) : undefined;
};
const refreshMessage = app => find(app.render(), node => node.props?.className === "ir-refresh-message")?.props.children;
const textContent = tree => typeof tree === "string" || typeof tree === "number" ? String(tree)
  : Array.isArray(tree) ? tree.map(textContent).join("") : textContent(tree?.props?.children || "");
const requestStatusPanel = app => find(app.render(), node => node.props?.["aria-label"] === "Table request status");

for (const staff of [false, true]) test(`Star stays first in the ${staff ? "staff" : "table"} internal grid across refreshes`, async t => {
  const star = { ...dancer, id: "70e50bad-b7be-45ad-bc7a-64f1cba6b5e2", stageName: "Star" };
  const otherStar = { ...dancer, id: "another-star", stageName: "Star" };
  let dancers = [dancer, otherStar, star];
  const app = harness(async () => response({ ...roster, dancers }), staff ? {
    session: { accessToken: "owner-token", account: { role: "venue" } }, props: { token: undefined },
  } : {});
  t.after(() => app.unmount());
  await app.mount();
  const ids = () => Array.from(grid(app).props.children, card => card.key);
  assert.deepEqual(ids(), [star.id, dancer.id, otherStar.id]);
  assert.deepEqual(dancers.map(item => item.id), [dancer.id, otherStar.id, star.id], "rendering does not mutate the roster snapshot");
  dancers = [otherStar, star, dancer];
  await app.advance(refreshInterval);
  assert.deepEqual(ids(), [star.id, otherStar.id, dancer.id], "keep the server's order for all other dancers");
  dancers = [dancer, otherStar];
  await app.advance(refreshInterval);
  assert.deepEqual(ids(), [dancer.id, otherStar.id], "do not add Star when she is absent or promote a matching stage name");
});

test("venue table sections reserve their place before the roster while the first request is pending", async t => {
  const pending = deferred();
  const app = harness(() => pending.promise, {
    session: { accessToken: 'owner-token', account: { role: 'venue' } },
    props: { token: undefined, operationsOnly: true, roster: 'DANCER ROSTER' },
  });
  t.after(() => app.unmount());
  const sectionOrder = tree => find(tree, node => node.props?.className === 'ir-operations').props.children.map(node => node?.props?.id || node);
  const expectedOrder = ['table-requests', 'DANCER ROSTER'];
  assert.deepEqual(Array.from(sectionOrder(app.render())), expectedOrder, 'the first paint already has the final section order');
  await app.mount();
  const loading = app.render();
  assert.deepEqual(Array.from(sectionOrder(loading)), expectedOrder);
  for (const id of expectedOrder.slice(0, 1)) {
    const section = find(loading, node => node.props?.id === id);
    assert.equal(section.props['aria-busy'], true);
    assert.match(textContent(find(section, node => node.type === 'h2')), /—$/);
    assert.equal(find(section, node => node.type === 'button' || node.type === 'form' || node.type === 'a'), undefined);
  }
  const placeholder = find(loading, node => node.props?.className === 'venue-dancer-grid');
  assert.equal(placeholder.props['aria-hidden'], 'true');
  assert.equal(placeholder.props.children.length, 3);
  assert.doesNotMatch(textContent(loading), /No open requests|No table QR codes|Loading the live roster/);
  pending.resolve(response({ ...roster, role: 'owner', links: [{ id: 'table-1', label: 'Table 7', token: 'active-token' }], requests: [
    { id: 'request-1', dancer_id: dancer.id, link_id: 'table-1', status: 'pending', created_at: '2026-10-13T03:00:00Z' },
  ] }));
  await flush();
  const loaded = app.render();
  assert.deepEqual(Array.from(sectionOrder(loaded)), expectedOrder);
  for (const id of expectedOrder.slice(0, 1)) {
    const section = find(loaded, node => node.props?.id === id);
    assert.equal(section.props['aria-busy'], undefined);
    assert.match(textContent(find(section, node => node.type === 'h2')), /1$/);
  }
  assert.ok(find(loaded, node => node.props?.['data-request-id'] === 'request-1'));
  assert.doesNotMatch(textContent(loaded), /Loading table/);
});

test("failed table loading retains section order and distinguishes unavailable data from a confirmed empty result", async t => {
  let reads = 0;
  const app = harness(async () => ++reads === 1
    ? response({ ok: false, error: 'Connection interrupted.' }, 503)
    : response({ ...roster, role: 'owner', links: [], requests: [] }), {
    session: { accessToken: 'owner-token', account: { role: 'venue' } },
    props: { token: undefined, operationsOnly: true, roster: 'DANCER ROSTER' },
  });
  t.after(() => app.unmount()); await app.mount();
  const failed = app.render();
  const operations = find(failed, node => node.props?.className === 'ir-operations');
  assert.deepEqual(Array.from(operations.props.children, node => node?.props?.id || node), ['table-requests', 'DANCER ROSTER']);
  assert.match(textContent(operations), /Table requests unavailable/);
  assert.doesNotMatch(textContent(operations), /Loading|No open requests|No table QR codes/);
  assert.equal(find(operations, node => node.props?.['aria-busy'] || node.type === 'form'), undefined);
  find(alert(app), node => node.type === 'button').props.onClick(); await flush();
  assert.equal(alert(app), undefined);
  const recovered = find(app.render(), node => node.props?.className === 'ir-operations');
  for (const id of ['table-requests']) {
    const heading = find(find(recovered, node => node.props?.id === id), node => node.type === 'h2');
    assert.equal(find(heading, node => node.type === 'span').props.children, 0);
  }
  assert.match(textContent(recovered), /No open requests/);
  assert.doesNotMatch(textContent(recovered), /Table QR|QR codes|Print/);
});

test("venue dashboard keeps table requests without exposing QR codes or printing", async t => {
  const calls = [];
  const links = [{ id: 'table-1', kind: 'table', label: 'Table 7', token: 'active-table-token' }];
  const app = harness(async (url, options) => {
    calls.push({ url, options });
    return response({ ...roster, role: 'owner', links, requests: [] });
  }, { session: { accessToken: 'owner-token', account: { role: 'venue' } }, props: { token: undefined, operationsOnly: true, roster: 'DANCER ROSTER' } });
  t.after(() => app.unmount()); await app.mount();
  const operations = find(app.render(), node => node.props?.className === 'ir-operations');
  assert.equal(operations.props.children[0].props.id, 'table-requests');
  assert.equal(find(operations, node => node.props?.id === 'table-qr-codes'), undefined);
  assert.equal(find(operations, node => node.type === 'a' && /\/internal\/(sign|club)\//.test(node.props.href)), undefined);
  assert.doesNotMatch(textContent(operations), /Table QR|Print|Copy|Add a table|Create link|Rename table|Save name|Revoke/);
  assert.equal(calls.some(call => call.options.method === 'POST'), false);
});

test("standalone staff and guest rosters never expose QR management or printing", async t => {
  const data = { ...roster, role: 'staff', links: [{ id: 'table-1', label: 'Table 7', token: 'active-token' }] };
  const app = harness(async () => response(data), { session: { accessToken: 'staff-token', account: { role: 'venue' } }, props: { token: undefined } });
  t.after(() => app.unmount()); await app.mount();
  const qr = find(app.render(), node => node.props?.id === 'table-qr-codes');
  assert.equal(qr, undefined);
  assert.doesNotMatch(textContent(app.render()), /Print QR|Table QR|Rename table|Revoke/);
  const guest = harness(async () => response({ ...data, kind: 'table' }));
  t.after(() => guest.unmount()); await guest.mount();
  assert.equal(find(guest.render(), node => node.props?.id === 'table-qr-codes'), undefined);
});

for (const role of ['owner', 'manager', 'staff', undefined]) test(`QR tools stay absent with no tables for ${role || 'unknown'} access`, async t => {
  const app = harness(async () => response({ ...roster, role, links: [] }), {
    session: { accessToken: 'owner-token', account: { role: 'venue' } }, props: { token: undefined, operationsOnly: true },
  });
  t.after(() => app.unmount()); await app.mount();
  const qr = find(app.render(), node => node.props?.id === 'table-qr-codes');
  assert.equal(qr, undefined);
  assert.doesNotMatch(textContent(app.render()), /Table QR|Print QR|Add a table|Create link|Rename table|Revoke/);
});

test("dashboard request deep link waits for authorized data and focuses the requests once", async t => {
  const app = harness(async () => response({ ...roster, role: 'owner', links: [] }), {
    url: 'https://example.invalid/dashboard/venue#table-requests',
    session: { accessToken: 'owner-token', account: { role: 'venue' } }, props: { token: undefined, operationsOnly: true },
  });
  t.after(() => app.unmount());
  const panel = new app.HTMLDetailsElement();
  const parent = new app.HTMLDetailsElement();
  let focus = 0; let scroll = 0;
  Object.assign(panel, { parentElement: parent, scrollIntoView: () => { scroll++; }, focus: () => { focus++; } });
  app.elements.set('table-requests', panel);
  await app.mount();
  assert.equal(focus, 0, 'initial render has no authorized table data');
  app.render(); app.runEffect(1); await app.advance(0);
  assert.equal(panel.open, true);
  assert.equal(parent.open, true);
  assert.equal(focus, 1);
  assert.equal(scroll, 1);
  app.render(); app.runEffect(1); await app.advance(0);
  assert.equal(focus, 1, 'polling must not continually steal focus');
  app.window.location.hash = '#table-qr-codes';
  app.listeners.get('hashchange')();
  app.window.location.hash = '#table-requests';
  await app.advance(0);
  assert.equal(focus, 1, 'stale animation frames do not open the previous section');
  app.listeners.get('hashchange')(); await app.advance(0);
  assert.equal(focus, 2, 'an explicit request navigation can open the section again');
});

test("staff table requests have a protected avatar and open the matching profile without mutating requests", async t => {
  const calls = [];
  const app = harness(async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/profile/') || url.startsWith('/api/public/dancers/')) return response({ ok: true, profile: { id: dancer.id, slug: 'actual-dancer', stage_name: dancer.stageName } });
    return response({ ...roster, requests: [{ id: 'request-1', dancer_id: dancer.id, link_id: 'table-1', status: 'pending', created_at: '2026-10-13T03:00:00Z' }], links: [{ id: 'table-1', label: 'Table 7' }] });
  }, { token: undefined, session: { accessToken: 'staff-token', account: { role: 'venue' } }, props: { token: undefined, operationsOnly: true } });
  t.after(() => app.unmount()); await app.mount();
  const request = find(app.render(), node => node.props?.['data-request-id']);
  const button = find(request, node => node.props?.className === 'ir-profile-link venue-card-profile');
  assert.equal(button.props['aria-label'], 'View Demo dancer profile');
  const avatar = find(button, node => node.type?.name === 'ProtectedMedia');
  assert.equal(avatar.props.id, dancer.id);
  assert.equal(avatar.props.kind, 'avatar');
  assert.equal(avatar.props.token, undefined);
  assert.match(textContent(button), /Demo dancer/);
  assert.match(textContent(request), /Table 7/);
  assert.match(textContent(request), /New request/);
  assert.equal(find(request, node => node.type === 'time').props.dateTime, '2026-10-13T03:00:00Z');
  button.props.onClick(); await flush(); await flush();
  assert.deepEqual(app.navigations, []);
  assert.equal(profile(app).id, dancer.id);
  assert.ok(calls.some(call => call.url === '/api/internal/profile/' + dancer.id && call.options.headers.authorization === 'Bearer staff-token'));
  assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.ok(find(app.render(), node => node.props?.['data-request-id']));
});

test("private table photos distinguish downloading, HTTP failure and a stalled connection", async t => {
  for (const timeout of [false, true]) {
    const pending = deferred();
    const app = harness(() => pending.promise, { component: 'ProtectedMedia', session: { accessToken: 'staff-token', account: { role: 'venue' } },
      props: { token: undefined, id: 'photo-1', kind: 'photo', grid: true } });
    t.after(() => app.unmount()); await app.mount();
    assert.equal(app.render().props.pending, true);
    if (timeout) await app.advance(15000);
    else { pending.resolve({ ok: false }); await flush(); }
    assert.equal(app.render().props.pending, false);
    assert.equal(app.render().props.src, '');
  }
});

test("private table photos reveal the authorized Blob and cancel downloads on unmount", async t => {
  let signal;
  const pending = deferred();
  const app = harness((_url, options) => { signal = options.signal; return pending.promise; }, {
    component: 'ProtectedMedia', session: { accessToken: 'staff-token', account: { role: 'venue' } },
    props: { token: undefined, id: 'photo-1', kind: 'photo', grid: true },
  });
  t.after(() => app.unmount()); await app.mount();
  pending.resolve({ ok: true, blob: async () => new Blob(['photo']) }); await flush();
  assert.match(app.render().props.src, /^blob:/);
  assert.equal(app.timers.size, 0, 'settled media clears its deadline');
  app.unmount();
  assert.equal(signal.aborted, true);
});

test("requests for dancers no longer in the authorized roster have a photo fallback without a dead profile action", async t => {
  const app = harness(async () => response({ ...roster, dancers: [], requests: [{ id: 'request-1', dancer_id: 'removed-id', dancerName: 'Former dancer', status: 'pending', created_at: '2026-10-13T03:00:00Z' }] }),
    { session: { accessToken: 'staff-token', account: { role: 'venue' } }, props: { token: undefined, operationsOnly: true } });
  t.after(() => app.unmount()); await app.mount();
  const identity = find(app.render(), node => node.props?.className === 'venue-table-request-identity');
  assert.match(textContent(identity), /Former dancer/);
  assert.ok(find(identity, node => node.type === 'VenueGridImage' && !node.props.src));
  assert.equal(find(identity, node => node.type === 'button' || node.type?.name === 'ProtectedMedia'), undefined);
});

test("staff request cards prioritize pending requests, use authorized main photos and keep actions on the selected request", async t => {
  const saved = [
    { id: 'seen', dancer_id: dancer.id, link_id: 'table-1', status: 'acknowledged', created_at: '2026-10-13T04:00:00Z' },
    { id: 'older', dancer_id: dancer.id, link_id: 'table-1', status: 'pending', created_at: '2026-10-13T02:00:00Z' },
    { id: 'newest', dancer_id: dancer.id, link_id: 'table-2', status: 'pending', created_at: '2026-10-13T03:00:00Z' },
  ];
  const calls = [];
  const app = harness(async (_url, options) => {
    if (options.body) calls.push(JSON.parse(options.body));
    return response({ ...roster, dancers: [{ ...dancer, mainPhotoId: 'approved-photo', mainPhotoRevision: 'revision-2' }], requests: saved,
      links: [{ id: 'table-1', label: 'Table 1' }, { id: 'table-2', label: 'VIP Booth' }] });
  }, { session: { accessToken: 'staff-token', account: { role: 'venue' } }, props: { token: undefined, operationsOnly: true } });
  t.after(() => app.unmount()); await app.mount();
  const cards = find(app.render(), node => node.props?.['aria-label'] === 'Table request cards').props.children;
  assert.deepEqual(Array.from(cards, card => card.props['data-request-id']), ['newest', 'older', 'seen']);
  assert.deepEqual(saved.map(row => row.id), ['seen', 'older', 'newest'], 'rendering must not reorder the saved snapshot');
  const photo = find(cards[0], node => node.type?.name === 'ProtectedMedia');
  assert.equal(photo.props.id, 'approved-photo');
  assert.equal(photo.props.kind, 'photo');
  assert.equal(photo.props.revision, 'revision-2');
  assert.equal(photo.props.token, undefined);
  assert.equal(photo.props.grid, true);
  assert.equal(photo.props.lazy, false);
  assert.equal(photo.props.priority, true);
  assert.match(textContent(cards[0]), /VIP Booth/);
  assert.match(textContent(cards[2]), /Seen by staff/);
  const caption = find(cards[0], node => node.props?.className === 'venue-card-caption');
  assert.match(textContent(caption), /VIP Booth/);
  assert.match(textContent(caption), /New request/);
  const menu = find(cards[0], node => node.type === 'details' && node.props?.className === 'venue-card-menu');
  assert.equal(find(menu, node => node.type === 'summary').props['aria-label'], 'VIP Booth request details for Demo dancer');
  const actions = find(cards[0], node => node.props?.className === 'ir-actions venue-card-actions');
  assert.equal(find(menu, node => node.props?.className === 'ir-actions venue-card-actions'), actions, 'actions stay accessible without extending card height');
  find(actions, node => node.type === 'button' && node.props.children === 'Mark seen').props.onClick();
  await flush(); await flush();
  assert.equal(calls[0].id, 'newest');
  assert.equal(calls[0].status, 'acknowledged');
  assert.equal(calls[0].expectedStatus, 'pending');
});

test("roster profile triggers retain clickable custom identity content", async t => {
  const children = require('react').createElement('span', null, 'Avatar and dancer name');
  const app = harness(async () => response({ ok: true, profile: { id: dancer.id } }), {
    component: 'VenueRosterProfileButton', session: { accessToken: 'staff-token', account: { role: 'venue' } },
    props: { children, className: 'ir-profile-link venue-dancer-profile-trigger' },
  });
  t.after(() => app.unmount()); await app.mount();
  const button = find(app.render(), node => node.type === 'button');
  assert.equal(button.props.children, children);
  assert.equal(button.props.className, 'ir-profile-link venue-dancer-profile-trigger');
  assert.equal(button.props['aria-label'], 'View Demo dancer profile');
  assert.equal(button.props['aria-busy'], false);
});

for (const outcome of ["available", "private", "wrong-dancer", "account-changed"]) test(`dashboard profiles open in place after one authorized lookup: ${outcome}`, async t => {
  const calls = [];
  const app = harness(async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.authorization, "Bearer staff-token");
    assert.equal(url, "/api/internal/profile/" + dancer.id);
    if (outcome === "account-changed") app.setSession({ accessToken: "another-account", account: { role: "venue" } });
    return response({ ok: true, profile: { id: outcome === "wrong-dancer" ? "someone-else" : dancer.id, slug: outcome === "private" ? "" : "canonical-dancer" } });
  }, { component: "VenueRosterProfileButton", session: { accessToken: "staff-token", account: { role: "venue" } } });
  t.after(() => app.unmount()); await app.mount();
  assert.equal(calls.length, 1);
  assert.deepEqual(app.navigations, []);
  if (["available", "private"].includes(outcome)) assert.equal(profile(app).id, dancer.id);
  else { assert.equal(profile(app), null); assert.ok(find(app.render(), node => node.props?.role === "status")); }
});

test("table requests open the authorized full profile in place without a public lookup", async t => {
  const app = harness(async url => {
    assert.ok(!url.startsWith("/api/public/"));
    if (url.startsWith("/api/internal/profile/")) return response({ ok: true, profile: { id: dancer.id, slug: "private-dancer" } });
    return response({ ...roster, requests: [{ id: "request", dancer_id: dancer.id, status: "pending", created_at: "2026-10-20T03:00:00Z" }] });
  }, { token: "", props: { operationsOnly: true }, session: { accessToken: "staff-token", account: { role: "venue" } } });
  t.after(() => app.unmount()); await app.mount();
  const cards = () => find(app.render(), node => node.props?.["aria-label"] === "Table request cards");
  find(cards(), node => node.type === "button").props.onClick(); await flush();
  assert.ok(cards());
  assert.equal(alert(app), undefined);
  assert.equal(profile(app).id, dancer.id);
  assert.deepEqual(app.navigations, []);
});

test("table QR opens the roster directly with collapsed terms and no consent gate", async t => {
  const calls = [];
  const app = harness(async (url, options) => { calls.push({ url, options }); return response({ ...roster, kind: "table", label: "Table 1" }); });
  t.after(() => app.unmount()); await app.mount();
  assert.ok(grid(app));
  const tree = app.render();
  const notice = find(tree, node => node.type === "details" && node.props.className === "ir-terms");
  assert.ok(notice); assert.equal(notice.props.open, undefined);
  assert.equal(find(notice, node => node.type === "summary").props.children, "View terms");
  assert.ok(textContent(notice).includes(accessTerms.TABLE_REQUEST_NOTICE));
  assert.equal(find(notice, node => node.type === "a").props.href, accessTerms.ACCESS_TERMS_HREF);
  assert.equal(find(tree, node => node.props?.type === "checkbox"), undefined);
  assert.doesNotMatch(textContent(tree), /Continue to roster|I agree/);
  assert.ok(calls.every(call => call.options.method === "GET"), "opening never writes an acceptance");
});

test("a guest hard reload shows loading progress until the real venue and table header arrive", async t => {
  const pending = deferred();
  const app = harness(() => pending.promise);
  t.after(() => app.unmount()); await app.mount();
  const loading = app.render();
  assert.equal(loading.props["aria-busy"], true);
  assert.equal(find(loading, node => node.props?.role === "status").props.className, "ir-loading-status");
  assert.equal(textContent(find(loading, node => node.props?.role === "status")), "Loading dancers…");
  assert.equal(find(loading, node => node.props?.className === "ir-loading-spinner").props["aria-hidden"], "true");
  assert.equal(find(loading, node => node.props?.className === "ir-loading-placeholder"), undefined);
  assert.equal(find(loading, node => node.type === "header" || node.type === "footer"), undefined);
  assert.equal(grid(app), undefined);
  assert.equal(refreshButton(app), undefined);
  assert.doesNotMatch(textContent(loading), /Welcome to the club|Loading the live roster|0 available/);
  pending.resolve(response({ ...roster, venueLogoUrl: "/club-logo.svg", label: "Table 1", kind: "table" }));
  await flush();
  const loaded = app.render();
  assert.equal(loaded.props["aria-busy"], undefined);
  assert.equal(find(loaded, node => node.props?.className === "ir-loading-status"), undefined);
  assert.equal(find(loaded, node => node.type?.name === "VenueBrandLogo").props.name, roster.venueName);
  const header = find(loaded, node => node.type === "header");
  assert.equal(find(header, node => node.type === "p").props.children, "Table 1");
  const credit = find(header, node => node.props?.className === "ir-brand");
  assert.equal(textContent(credit), "Powered by mydancr.com");
  assert.equal(credit.props.href, "https://www.mydancr.com");
  assert.equal(credit.props.target, "_blank");
  assert.equal(credit.props.rel, "noopener noreferrer");
  assert.ok(grid(app));
  assert.ok(refreshButton(app));
});

test("guest loading failures replace progress with an error and retain a working retry", async t => {
  let calls = 0;
  const app = harness(async () => ++calls === 1
    ? response({ ok: false, error: "This club link is unavailable." }, 403)
    : response({ ...roster, label: "Table 12" }));
  t.after(() => app.unmount()); await app.mount();
  assert.equal(alertMessage(app), "This club link is unavailable.");
  assert.equal(find(app.render(), node => node.props?.className === "ir-loading-status"), undefined);
  assert.equal(find(app.render(), node => node.type === "header"), undefined);
  find(alert(app), node => node.type === "button").props.onClick(); await flush();
  assert.equal(alert(app), undefined);
  assert.equal(find(app.render(), node => node.type === "h1").props.children, roster.venueName);
  assert.match(textContent(find(app.render(), node => node.type === "header")), /Table 12/);
});

test("staff keep their existing sign-in and loading presentation", async t => {
  const pending = deferred();
  const app = harness(() => pending.promise, { token: "", session: { accessToken: "staff-token", account: { role: "venue" } } });
  t.after(() => app.unmount()); await app.mount();
  assert.ok(find(app.render(), node => node.type === "header"));
  assert.equal(find(app.render(), node => node.props?.role === "status").props.children, "Loading the live roster…");
  assert.equal(find(app.render(), node => node.props?.className === "ir-loading-status"), undefined);
});

test("Rhino dashboard samples show ten distinct authorized dancers without entering live requests", async t => {
  const dancers = Array.from({ length: 12 }, (_, index) => ({
    ...dancer, id: `dancer-${index}`, stageName: `Dancer ${String(index + 1).padStart(2, "0")}`,
    mainPhotoId: `photo-${index}`, mainPhotoRevision: "revision-1",
  }));
  const calls = [];
  const app = harness(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/profile/") || url.startsWith("/api/public/dancers/")) return response({ ok: true, profile: { id: dancers[0].id, slug: "actual-dancer-1", stage_name: dancers[0].stageName } });
    return response({ ...roster, dancers: [...dancers].reverse().concat(dancers[0]), requests: [{
      id: "real-request", dancer_id: dancers[11].id, link_id: "real-table", status: "pending", created_at: "2026-10-20T03:00:00Z",
    }], links: [{ id: "real-table", label: "VIP 12" }] });
  }, { token: "", session: { accessToken: "staff-token", account: { role: "venue" } },
    props: { operationsOnly: true, sampleTableRequests: true } });
  t.after(() => app.unmount()); await app.mount();
  const section = find(app.render(), node => node.props?.id === "table-requests");
  const cards = find(section, node => node.props?.["aria-label"] === "Table request cards").props.children;
  assert.equal(cards.length, 11);
  assert.equal(cards[0].props["data-request-id"], "real-request", "live requests stay ahead of samples");
  assert.match(textContent(find(section, node => node.type === "h2")), /1 live/);
  assert.match(textContent(section), /10 sample requests/);
  const samples = cards.filter(card => card.props["data-sample"]);
  assert.equal(samples.length, 10);
  assert.equal(new Set(samples.map(card => card.props["data-request-id"])).size, 10);
  samples.forEach((card, index) => {
    assert.equal(card.props["data-request-id"], `demo-table-${dancers[index].id}`);
    assert.match(textContent(card), new RegExp(`Sample · Table ${index + 1}`));
    assert.ok(find(card, node => node.props?.["aria-label"] === `View ${dancers[index].stageName} profile`));
    assert.equal(find(card, node => node.type?.name === "ProtectedMedia").props.id, dancers[index].mainPhotoId);
    assert.equal(find(card, node => node.props?.className === "ir-actions venue-card-actions"), undefined);
    assert.doesNotMatch(textContent(card), /Mark seen|Mark arrived|Complete|Dismiss/);
  });
  assert.equal(samples.filter(card => textContent(card).includes("New request")).length, 6);
  assert.equal(samples.filter(card => textContent(card).includes("Seen by staff")).length, 2);
  assert.equal(samples.filter(card => textContent(card).includes("Arrived at table")).length, 2);
  const sampleTimes = samples.map(card => find(card, node => node.type === "time").props.dateTime);
  await app.advance(60_000);
  const refreshedCards = find(app.render(), node => node.props?.["aria-label"] === "Table request cards").props.children.filter(card => card.props["data-sample"]);
  assert.deepEqual(refreshedCards.map(card => find(card, node => node.type === "time").props.dateTime), sampleTimes);
  find(samples[0], node => node.type === "button").props.onClick(); await flush();
  assert.deepEqual(app.navigations, []);
  assert.equal(profile(app).id, dancers[0].id);
  assert.ok(calls.every(call => call.options.method === "GET"), "samples cannot create requests or notifications");
  find(cards[0], node => node.type === "button" && node.props.children === "Mark seen").props.onClick(); await flush();
  const action = calls.find(call => call.options.method === "POST");
  assert.equal(JSON.parse(action.options.body).id, "real-request", "live actions still target the actual request");
});

for (const scenario of [
  { name: "normal venue dashboard", token: "", props: { operationsOnly: true } },
  { name: "standalone staff roster", token: "", props: { sampleTableRequests: true } },
  { name: "guest table roster", token: "table-token", props: { operationsOnly: true, sampleTableRequests: true } },
]) test(`sample requests stay out of the ${scenario.name}`, async t => {
  const app = harness(async () => response({ ...roster, requests: [] }), {
    ...scenario, session: { accessToken: "staff-token", account: { role: "venue" } },
  });
  t.after(() => app.unmount()); await app.mount();
  assert.equal(find(app.render(), node => node.props?.["data-sample"]), undefined);
  assert.doesNotMatch(textContent(app.render()), /sample requests/);
});

test("sample cards stay empty without an authorized roster and do not invent dancers", async t => {
  const app = harness(async () => response({ ...roster, dancers: [], requests: [] }), {
    token: "", session: { accessToken: "staff-token", account: { role: "venue" } },
    props: { operationsOnly: true, sampleTableRequests: true },
  });
  t.after(() => app.unmount()); await app.mount();
  assert.equal(find(app.render(), node => node.props?.["data-sample"]), undefined);
  assert.match(textContent(app.render()), /No open requests/);
});

test("sample table requests are enabled only by the existing exact demo venue gate", () => {
  const panels = readFileSync(new URL("../app/dashboard/VenueDashboardPanels.tsx", import.meta.url), "utf8");
  const nfcPanel = readFileSync(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8");
  assert.match(panels, /sampleTableRequests=\{isVenueDashboardDemo\(profile\)\}/);
  assert.match(nfcPanel, /sampleTableRequests = false/);
  assert.match(nfcPanel, /<InternalRoster operationsOnly sampleTableRequests=\{sampleTableRequests\}/);
});

test("saved table requests identify every requested dancer without locking other cards", async t => {
  const dancers = [
    { ...dancer, requestStatus: "pending", requestId: "first" },
    { ...dancer, id: "second", stageName: "Second dancer", requestStatus: "acknowledged", requestId: "second" },
    { ...dancer, id: "third", stageName: "Third dancer" },
  ];
  const app = harness(async () => response({ ...roster, kind: "table", label: "Table 12", dancers, receipt: null }));
  t.after(() => app.unmount()); await app.mount();
  const card = id => find(app.render(), node => node.type === "article" && node.key === id);
  assert.equal(card(dancer.id).props["data-request-state"], "pending");
  assert.equal(card("second").props["data-request-state"], "acknowledged");
  assert.equal(card("third").props["data-request-state"], undefined);
  assert.match(textContent(card(dancer.id)), /Requested ✓/);
  assert.match(textContent(card("second")), /Seen by staff/);
  assert.equal(requestButton(app, "third").props.disabled, false);
  const status = textContent(requestStatusPanel(app));
  assert.match(status, /Demo dancer requested · Table 12Pending staff acknowledgment/);
  assert.match(status, /Second dancer requested · Table 12Request seen by staff/);
  assert.match(status, /Availability is not guaranteed/);
  assert.doesNotMatch(status, /confirmed|Third dancer/i);
});

for (const terminal of ["completed", "cancelled", "expired"]) test(`refresh presents seen accurately and compacts ${terminal} requests`, async t => {
  let status = "pending";
  const app = harness(async () => response({ ...roster, kind: "table", label: "Table 1", receipt: { status }, dancers: [{ ...dancer,
    requestStatus: ["pending", "acknowledged"].includes(status) ? status : null, requestId: "saved-request" }] }));
  t.after(() => app.unmount()); await app.mount();
  status = "acknowledged"; refreshButton(app).props.onClick(); await flush();
  assert.match(textContent(requestStatusPanel(app)), /Request seen by staff/);
  assert.match(textContent(requestStatusPanel(app)), /Availability is not guaranteed/);
  status = terminal; refreshButton(app).props.onClick(); await flush();
  assert.match(requestStatusPanel(app).props.className, /is-inactive/);
  assert.equal(textContent(requestStatusPanel(app)), `Request ${terminal} · Table 1`);
  const card = find(app.render(), node => node.type === "article" && node.key === dancer.id);
  assert.equal(card.props["data-request-state"], undefined);
  assert.doesNotMatch(textContent(card), /Requested ✓|Seen by staff/);
  assert.equal(requestButton(app, dancer.id).props.children, "Request");
});

test("a failed request never adds requested styling or a successful status", async t => {
  const app = harness(async (_url, options) => options.method === "POST" ? response({ ok: false, error: "Please try again." }, 503) : response({ ...roster, kind: "table", label: "Table 1" }));
  t.after(() => app.unmount()); await app.mount();
  requestButton(app, dancer.id).props.onClick(); await flush();
  assert.equal(requestStatusPanel(app), undefined);
  assert.equal(find(app.render(), node => node.type === "article" && node.key === dancer.id).props["data-request-state"], undefined);
  assert.equal(requestButton(app, dancer.id).props.disabled, false);
});

test("manual refresh keeps requests usable and the grid visible while updating availability and statuses", async t => {
  const pending = deferred();
  let calls = 0;
  const initial = { ...roster, kind: "table", dancers: [{ ...dancer, requestStatus: "pending", requestId: "saved-request" }, { ...dancer, id: "other" }] };
  const app = harness(async (_url, options) => {
    assert.equal(options.method, "GET", "Refreshing must never create or cancel requests");
    return ++calls === 1 ? response(initial) : pending.promise;
  });
  t.after(() => app.unmount()); await app.mount();
  refreshButton(app).props.onClick(); refreshButton(app).props.onClick(); app.focus();
  assert.equal(calls, 2, "Repeated taps and focus share the active refresh");
  assert.equal(refreshButton(app).props["aria-busy"], true);
  assert.equal(refreshButton(app).props.disabled, true);
  assert.ok(grid(app));
  assert.equal(requestButton(app, dancer.id).props.children, "Cancel request");
  assert.equal(requestButton(app, dancer.id).props.disabled, false);
  assert.equal(requestButton(app, "other").props.disabled, false);
  pending.resolve(response({ ...initial, dancers: [{ ...dancer, requestStatus: "acknowledged", requestId: "saved-request" }] }));
  await flush();
  assert.equal(requestButton(app, "other"), undefined);
  assert.equal(requestButton(app, dancer.id).props.children, "Cancel request");
  assert.equal(refreshButton(app).props["aria-busy"], false);
  assert.equal(refreshMessage(app), "Roster updated.");
  await app.advance(refreshInterval - 1);
  assert.equal(calls, 2, "Manual refresh resets the scheduled refresh instead of adding another poll");
});

test("returning to the guest page refreshes once across visibility, focus and restored-page events", async t => {
  let calls = 0;
  const app = harness(async () => { calls++; return response(roster); });
  t.after(() => app.unmount()); await app.mount();
  app.visibility("hidden"); app.focus(); app.pageshow(false); await flush();
  assert.equal(calls, 1);
  app.visibility("visible"); await flush(); app.focus(); app.pageshow(true); await flush();
  assert.equal(calls, 2, "Companion events must not issue duplicate reads even after a quick response");
  assert.equal(refreshMessage(app), undefined, "Automatic refresh stays quiet");
  await app.advance(1001); app.pageshow(true); await flush();
  assert.equal(calls, 3);
  await app.advance(1001); app.focus(); await flush();
  assert.equal(calls, 4);
  app.unmount();
  assert.equal(app.timers.size, 0);
  assert.equal(app.listeners.size, 0);
  assert.equal(app.documentListeners.size, 0);
});

test("a manual timeout retains saved requests, stops spinning and can be retried", async t => {
  let calls = 0;
  const initial = { ...roster, kind: "table", dancers: [{ ...dancer, requestStatus: "pending", requestId: "saved-request" }] };
  const app = harness(async () => ++calls === 2 ? new Promise(() => {}) : response(initial));
  t.after(() => app.unmount()); await app.mount();
  refreshButton(app).props.onClick(); await app.advance(15000);
  assert.ok(grid(app)); assert.equal(alert(app), undefined);
  assert.equal(requestButton(app, dancer.id).props.children, "Cancel request");
  assert.equal(refreshButton(app).props.disabled, false);
  assert.match(refreshMessage(app), /Couldn’t refresh/);
  app.focus(); await flush();
  assert.equal(calls, 3); assert.equal(refreshMessage(app), undefined, "A successful return refresh clears the earlier connection error");
  refreshButton(app).props.onClick(); await flush();
  assert.equal(calls, 4); assert.equal(refreshMessage(app), "Roster updated.");
});

test("manual refresh can bring available dancers onto an empty floor", async t => {
  let calls = 0;
  const app = harness(async () => response(++calls === 1 ? { ...roster, dancers: [] } : { ...roster, kind: "table" }));
  t.after(() => app.unmount()); await app.mount();
  assert.ok(refreshButton(app)); assert.equal(grid(app), undefined);
  refreshButton(app).props.onClick(); await flush();
  assert.ok(grid(app)); assert.equal(requestButton(app, dancer.id).props.children, "Request");
});

test("a refresh already running cannot undo a request sent during it", async t => {
  const stale = deferred(); let reads = 0, sent = false;
  const app = harness(async (_url, options) => {
    if (options.method === "POST") { sent = true; return response({ ok: true, receipt: { id: "new-request", status: "pending" } }); }
    if (++reads === 2) return stale.promise;
    return response({ ...roster, kind: "table", dancers: [{ ...dancer, requestStatus: sent ? "pending" : null, requestId: sent ? "new-request" : null }] });
  });
  t.after(() => app.unmount()); await app.mount();
  refreshButton(app).props.onClick(); requestButton(app, dancer.id).props.onClick(); await flush();
  stale.resolve(response({ ...roster, kind: "table" })); await flush(); await app.advance(1500);
  assert.equal(requestButton(app, dancer.id).props.children, "Cancel request");
  assert.equal(refreshButton(app).props.disabled, false);
});

test("unmount aborts a manual refresh and removes return-to-page listeners", async () => {
  let calls = 0, signal;
  const app = harness(async (_url, options) => {
    signal = options.signal;
    return ++calls === 1 ? response(roster) : new Promise(() => {});
  });
  await app.mount(); refreshButton(app).props.onClick(); app.unmount(); await flush();
  assert.equal(signal.aborted, true);
  assert.equal(app.timers.size, 0);
  assert.equal(app.listeners.size, 0);
  assert.equal(app.documentListeners.size, 0);
});

test('the same grid and profile action confirms briefly, cancels exactly once, then allows a new request',async t=>{
 const posts=[],cancellation=deferred();let status=null,requestId=null;
 const app=harness(async(url,options)=>{
  if(options.method==='POST') {
   const body=JSON.parse(options.body);posts.push(body);
   if(body.action==='cancel_request') { await cancellation.promise;status=null;requestId=null;return response({ok:true,receipt:{id:body.requestId,status:'cancelled'}}); }
   status='pending';requestId='request-'+posts.length;return response({ok:true,receipt:{id:requestId,status}});
  }
  if(url.includes('/profile/'))return response({ok:true,profile:{id:dancer.id,requestStatus:status,requestId}});
  return response({...roster,kind:'table',dancers:[{...dancer,requestStatus:status,requestId},{...dancer,id:'other'}]});
 });t.after(()=>app.unmount());await app.mount();
 find(app.render(),node=>node.props?.className==='ir-profile-link').props.onClick();await flush();
 const dialog=()=>find(app.render(),node=>node.type?.name==='ClubProfileDialog');
 dialog().props.onRequest();await flush();
 assert.equal(dialog().props.request.confirmed,true);assert.equal(profile(app).requestId,'request-1');
 assert.equal(find(requestButton(app,dancer.id),node=>node.type==='span').props.children,'Request sent');
 await app.advance(1499);assert.equal(requestButton(app,dancer.id).props.disabled,true);
 await app.advance(1);assert.equal(requestButton(app,dancer.id).props.children,'Cancel request');assert.equal(dialog().props.request.confirmed,false);
 dialog().props.onCancel();requestButton(app,dancer.id).props.onClick();
 assert.equal(posts.length,2);assert.deepEqual(posts[1],{action:'cancel_request',dancerId:dancer.id,requestId:'request-1'});
 assert.equal(requestButton(app,dancer.id).props.children,'Cancelling…');assert.equal(requestButton(app,'other').props.disabled,false);
 assert.equal(dialog().props.request.busy,true);
 cancellation.resolve();await flush();await flush();
 assert.equal(requestButton(app,dancer.id).props.children,'Request');assert.equal(requestButton(app,dancer.id).props.disabled,false);
 assert.equal(profile(app).requestStatus,null);assert.equal(profile(app).requestId,null);
 dialog().props.onRequest();await flush();assert.notEqual(posts[2].requestKey,posts[0].requestKey);
 app.unmount();assert.equal(app.timers.size,0);
});

for(const status of ['pending','acknowledged'])test('failed cancellation preserves '+status+' and retries the same request without locking other dancers',async t=>{
 const posts=[],app=harness(async(_url,options)=>{
  if(options.method==='POST'){posts.push(JSON.parse(options.body));throw Error('Connection failed.');}
  return response({...roster,kind:'table',dancers:[{...dancer,requestStatus:status,requestId:'saved-request'},{...dancer,id:'other'}]});
 });t.after(()=>app.unmount());await app.mount();
 assert.equal(requestButton(app,dancer.id).props.children,'Cancel request');
 for(let i=0;i<2;i++){requestButton(app,dancer.id).props.onClick();await flush();assert.equal(requestButton(app,dancer.id).props.children,'Cancel request');assert.equal(requestButton(app,dancer.id).props.disabled,false);}
 assert.deepEqual(posts[0],posts[1]);assert.equal(requestButton(app,'other').props.disabled,false);
});

test('a timed-out cancellation reconciles the saved state without claiming cancellation succeeded',async t=>{
 let status='acknowledged';
 const app=harness(async(_url,options)=>{
  if(options.method==='POST'){status=null;return new Promise(()=>{});}
  return response({...roster,kind:'table',dancers:[{...dancer,requestStatus:status,requestId:status?'saved-request':null}]});
 });t.after(()=>app.unmount());await app.mount();requestButton(app,dancer.id).props.onClick();
 await app.advance(15000);assert.equal(requestButton(app,dancer.id).props.children,'Request');
 assert.match(textContent(cardNotice(app,dancer.id)),/timed out/);
 assert.ok(find(cardNotice(app,dancer.id),node=>node.props?.role==='alert'));
});

test('an older background read cannot bring back a cancelled request',async t=>{
 const old=deferred();let reads=0,status='pending';
 const app=harness(async(_url,options)=>{
  if(options.method==='POST'){status=null;return response({ok:true,receipt:{id:'saved-request',status:'cancelled'}});}
  if(++reads===2)return old.promise;
  return response({...roster,kind:'table',dancers:[{...dancer,requestStatus:status,requestId:status?'saved-request':null}]});
 });t.after(()=>app.unmount());await app.mount();await app.advance(refreshInterval);
 requestButton(app,dancer.id).props.onClick();await flush();
 old.resolve(response({...roster,kind:'table',dancers:[{...dancer,requestStatus:'pending',requestId:'saved-request'}]}));await flush();
 assert.equal(requestButton(app,dancer.id).props.children,'Request');
});

test('staff see cancelled requests disappear on a lightweight inbox refresh',async t=>{
 const calls=[],saved={id:'saved-request',dancer_id:dancer.id,link_id:'table',status:'pending',created_at:new Date().toISOString()};
 const app=harness(async url=>{calls.push(url);return response(url==='/api/internal/requests'?{ok:true,requests:[]}:{...roster,requests:[saved],links:[]});},
  {token:'',session:{accessToken:'staff-token',account:{role:'venue'}}});t.after(()=>app.unmount());await app.mount();
 assert.ok(find(app.render(),node=>node.props?.['data-request-id']));
 await app.advance(10000);assert.equal(calls.at(-1),'/api/internal/requests');
 assert.equal(find(app.render(),node=>node.props?.['data-request-id']),undefined);assert.ok(grid(app));
});

test('staff explicitly confirm arrival before completing and record no-shows separately',async t=>{
 for(const outcome of ['arrived','no_show']) {
  const writes=[]; let saved={id:'saved-request',dancer_id:dancer.id,dancerName:'Demo dancer',link_id:'table',status:'acknowledged',attendance:null,created_at:new Date().toISOString()};
  const app=harness(async(_url,options)=>{
   if(options?.method==='POST') {const body=JSON.parse(options.body);writes.push(body);saved={...saved,attendance:body.attendance,status:body.attendance==='no_show'?'cancelled':saved.status};}
   return response({...roster,requests:saved.status==='cancelled'?[]:[saved],links:[]});
  },{token:'',session:{accessToken:'staff-token',account:{role:'venue'}}});
  t.after(()=>app.unmount());await app.mount();
  const button=label=>find(app.render(),node=>node.type==='button'&&node.props.children===label);
  assert.equal(button('Complete'),undefined);
  button(outcome==='arrived'?'Mark arrived':'Didn’t arrive at table').props.onClick();await flush();
  assert.equal(writes[0].action,'request_attendance');assert.equal(writes[0].attendance,outcome);assert.equal(writes[0].expectedStatus,'acknowledged');
  if(outcome==='arrived') {assert.ok(button('Complete'));button('Complete').props.onClick();await flush();assert.equal(writes[1].action,'request_status');assert.equal(writes[1].status,'completed');}
  else assert.equal(find(app.render(),node=>node.props?.['data-request-id']),undefined);
 }
});

test("opening a profile starts its viewer alongside the API and keeps the roster available",async t=>{
 const pending=deferred();
 const app=harness(async url=>url.includes('/profile/')?pending.promise:response(roster));t.after(()=>app.unmount());await app.mount();
 find(app.render(),node=>node.props?.className==='ir-profile-link').props.onClick();await flush();
 const dialog=find(app.render(),node=>node.type?.name==='ClubProfileDialog');
 assert.equal(dialog.props.profileId,dancer.id);assert.equal(dialog.props.profile,null);assert.ok(grid(app));
 assert.equal(find(app.render(),node=>node.props?.className==='ir-profile-link').props['aria-busy'],true);
 pending.resolve(response({ok:true,profile:{id:dancer.id}}));await flush();
 const loaded=find(app.render(),node=>node.type?.name==='ClubProfileDialog');loaded.props.onReady();
 assert.equal(profile(app).id,dancer.id);assert.equal(find(app.render(),node=>node.props?.className==='ir-profile-link').props['aria-busy'],false);
});

test('the roster warms one viewer after authorization, while individual staff buttons start on demand', async t => {
  const pending = deferred();
  const app = harness(() => pending.promise);
  t.after(() => app.unmount());
  await app.mount();
  assert.equal(find(app.render(), node => node.type?.name === 'ClubProfileDialog'), undefined);
  pending.resolve(response(roster)); await flush();
  const dialog = find(app.render(), node => node.type?.name === 'ClubProfileDialog');
  assert.equal(dialog.props.prewarm, true);
  assert.equal(dialog.props.profile, null);
  const staff = harness(() => new Promise(() => {}), { component: 'VenueRosterProfileButton', session: { accessToken: 'staff-token', account: { role: 'venue' } } });
  t.after(() => staff.unmount()); await staff.mount();
  const loading = find(staff.render(), node => node.type?.name === 'ClubProfileDialog');
  assert.equal(loading.props.prewarm, undefined);
  assert.equal(loading.props.profileId, dancer.id);
  assert.equal(loading.props.profile, null, 'The staff viewer starts alongside its API request');
});

test("a stalled viewer returns an inline retry message without taking over the roster",async t=>{
 const app=harness(async url=>response(url.includes('/profile/')?{ok:true,profile:{id:dancer.id}}:roster));t.after(()=>app.unmount());await app.mount();
 find(app.render(),node=>node.props?.className==='ir-profile-link').props.onClick();await flush();
 find(app.render(),node=>node.type?.name==='ClubProfileDialog').props.onError();
 assert.equal(profile(app),null);assert.ok(grid(app));
 assert.equal(find(cardNotice(app,dancer.id),node=>node.type==='p').props.children,'That profile could not load. Please try again.');
 assert.equal(find(app.render(),node=>node.props?.className==='ir-notice'),undefined);
});

test('request and cancellation feedback stays at its card and replaces its own expiry timer', async t => {
  let status = null;
  const app = harness(async (_url, options) => {
    if (options.method === 'POST') {
      status = JSON.parse(options.body).action === 'cancel_request' ? null : 'pending';
      return response({ ok: true, receipt: { id: 'saved-request', status: status || 'cancelled' } });
    }
    return response({ ...roster, kind: 'table', dancers: [{ ...dancer, requestStatus: status, requestId: status ? 'saved-request' : null }, { ...dancer, id: 'other' }] });
  });
  t.after(() => app.unmount()); await app.mount();
  requestButton(app, dancer.id).props.onClick(); await flush();
  const sent = cardNotice(app, dancer.id);
  assert.match(textContent(sent), /Request sent to club staff/);
  assert.equal(find(sent, node => node.type === 'strong').props.children, dancer.stageName);
  assert.equal(requestButton(app, dancer.id).props['aria-describedby'], find(sent, node => node.props?.role === 'status').props.id);
  assert.equal(cardNotice(app, 'other'), undefined);
  assert.equal(find(app.render(), node => node.props?.className === 'ir-notice'), undefined);
  await app.advance(2000);
  requestButton(app, dancer.id).props.onClick();
  assert.equal(cardNotice(app, dancer.id), undefined, 'a new action clears only its previous feedback');
  await flush();
  assert.match(textContent(cardNotice(app, dancer.id)), /Request cancelled/);
  await app.advance(8000);
  assert.ok(cardNotice(app, dancer.id), 'the previous confirmation timer cannot remove the cancellation message');
  await app.advance(2000);
  assert.equal(cardNotice(app, dancer.id), undefined);
  requestButton(app, dancer.id).props.onClick(); await flush();
  find(cardNotice(app, dancer.id), node => node.type === 'button').props.onClick();
  assert.equal(cardNotice(app, dancer.id), undefined, 'confirmations can be dismissed immediately');
  assert.equal(requestButton(app, dancer.id).props['aria-describedby'], undefined);
  app.unmount(); assert.equal(app.timers.size, 0);
});

test('concurrent card feedback never overwrites another dancer or their open profile', async t => {
  const other = { ...dancer, id: 'other', stageName: 'Other dancer' };
  const requests = new Map();
  const app = harness(async (url, options) => {
    if (options.method === 'POST') {
      const pending = deferred();
      requests.set(JSON.parse(options.body).dancerId, pending);
      return pending.promise;
    }
    if (url.includes('/profile/')) return response({ ok: true, profile: { id: other.id } });
    return response({ ...roster, kind: 'table', dancers: [dancer, other] });
  });
  t.after(() => app.unmount()); await app.mount();
  requestButton(app, dancer.id).props.onClick();
  requestButton(app, other.id).props.onClick();
  const otherCard = find(app.render(), node => node.type === 'article' && node.key === other.id);
  find(otherCard, node => node.props?.className === 'ir-profile-link').props.onClick(); await flush();
  const dialog = () => find(app.render(), node => node.type?.name === 'ClubProfileDialog');
  requests.get(other.id).resolve(response({ ok: false, error: 'Please wait before requesting again.' }, 429)); await flush();
  assert.equal(dialog().props.request.message, 'Please wait before requesting again.');
  requests.get(dancer.id).resolve(response({ ok: true, receipt: { id: 'request-1', status: 'pending' } })); await flush();
  assert.match(textContent(cardNotice(app, dancer.id)), /Request sent/);
  assert.equal(dialog().props.request.message, 'Please wait before requesting again.');
  assert.ok(find(cardNotice(app, other.id), node => node.props?.role === 'alert'));
  await app.advance(10000);
  assert.equal(cardNotice(app, dancer.id), undefined);
  assert.ok(cardNotice(app, other.id), 'errors remain available after confirmation expiry');
  requestButton(app, other.id).props.onClick();
  assert.equal(cardNotice(app, other.id), undefined);
  assert.equal(dialog().props.request.message, '');
  requests.get(other.id).resolve(response({ ok: false, error: 'Please try later.' }, 503)); await flush();
  find(cardNotice(app, other.id), node => node.type === 'button').props.onClick();
  assert.equal(cardNotice(app, other.id), undefined);
  assert.equal(dialog().props.request.message, '');
});

test('profile fetch errors are card-local and access loss clears all card feedback', async t => {
  let revoked = false;
  const app = harness(async url => {
    if (revoked) return response({ ok: false, error: 'This table is no longer available.' }, 410);
    if (url.includes('/profile/')) return response({ ok: false, error: 'Profile temporarily unavailable.' }, 503);
    return response({ ...roster, kind: 'table' });
  });
  t.after(() => app.unmount()); await app.mount();
  find(app.render(), node => node.props?.className === 'ir-profile-link').props.onClick(); await flush();
  assert.match(textContent(cardNotice(app, dancer.id)), /Profile temporarily unavailable/);
  assert.equal(find(app.render(), node => node.props?.className === 'ir-notice'), undefined);
  revoked = true;
  refreshButton(app).props.onClick(); await flush();
  assert.equal(grid(app), undefined);
  assert.match(alertMessage(app), /no longer available/);
  revoked = false;
  find(alert(app), node => node.type === 'button').props.onClick(); await flush();
  assert.ok(grid(app)); assert.equal(cardNotice(app, dancer.id), undefined);
});

test("returning from sign-in reopens only the requested dancer on the authorized roster", async t => {
  for (const requested of [dancer.id, "unrelated-dancer"]) {
    const calls = [];
    const app = harness(async url => {
      calls.push(url);
      return response(url.includes("/profile/") ? { ok: true, profile: { id: dancer.id } } : roster);
    }, { url: `https://example.invalid/internal/club/table-token?profile=${requested}` });
    t.after(() => app.unmount());
    await app.mount();
    assert.equal(profile(app)?.id, requested === dancer.id ? dancer.id : undefined);
    assert.equal(calls.filter(url => url.includes("/profile/")).length, requested === dancer.id ? 1 : 0);
    assert.deepEqual(app.replacements, ["/internal/club/table-token"]);
  }
});

for (const message of [
  "This club link has been revoked or is unavailable.",
  "This club link is unavailable.",
  "You do not have permission to view this roster.",
]) {
  test(`initial access failures preserve the actual error: ${message}`, async t => {
    const app = harness(async () => response({ ok: false, error: message }, 403));
    t.after(() => app.unmount());
    await app.mount();
    assert.equal(alertMessage(app), message);
    await app.advance(refreshInterval);
    assert.equal(alertMessage(app), message);
    assert.equal(grid(app), undefined);
  });
}

test("the sign-in error is not replaced by a connection error", async t => {
  // An empty token selects the staff flow, like the component's omitted token prop.
  const staff = harness(() => assert.fail("Signed-out staff must not fetch a roster"), { token: "" });
  t.after(() => staff.unmount());
  await staff.mount();
  await staff.advance(30000);
  assert.equal(alertMessage(staff), "Sign in with your MyDancr club account to open the internal roster.");
});

test("a stalled fetch times out, polling recovers, and a late response cannot replace the fresh roster", async t => {
  const stalled = deferred();
  const calls = [];
  const app = harness((_url, options) => {
    calls.push(options);
    return calls.length === 1 ? stalled.promise : Promise.resolve(response(roster));
  });
  t.after(() => app.unmount());
  await app.mount();
  await app.advance(15000);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(alertMessage(app), "The request timed out. Please try again.");
  await app.advance(refreshInterval);
  assert.equal(calls.length, 2);
  assert.equal(alert(app), undefined);
  assert.ok(grid(app));
  stalled.resolve(response({ ok: true, venueName: "Old response", dancers: [] }));
  await flush();
  assert.ok(grid(app));
  assert.equal(find(app.render(), node => node.type === "h1").props.children, "Demo club");
});

test("refreshes wait 20 minutes and a stalled response keeps the roster and profile visible without messages", async t => {
  const stalledBody = deferred();
  let rosterCalls = 0;
  const app = harness(async url => {
    if (url.includes("/profile/")) return response({ ok: true, profile: { id: dancer.id, stage_name: dancer.stageName } });
    rosterCalls++;
    return rosterCalls === 2 ? { ok: true, json: () => stalledBody.promise } : response(roster);
  });
  t.after(() => app.unmount());
  await app.mount();
  find(app.render(), node => node.props?.className === "ir-profile-link").props.onClick();
  await flush();
  assert.ok(profile(app));
  await app.advance(refreshInterval - 1);
  assert.equal(rosterCalls, 1);
  assert.ok(grid(app));
  assert.ok(profile(app));
  await app.advance(1);
  assert.equal(rosterCalls, 2);
  assert.ok(grid(app));
  assert.equal(find(app.render(), node => node.props?.role === "status"), undefined);
  await app.advance(15000);
  assert.equal(alert(app), undefined);
  assert.ok(grid(app));
  assert.ok(profile(app));
  await app.advance(refreshInterval);
  assert.equal(rosterCalls, 3);
  stalledBody.resolve({ ok: true, venueName: "Stale roster", dancers: [] });
  await flush();
  assert.ok(grid(app));
  assert.equal(alert(app), undefined);
  assert.equal(find(app.render(), node => node.type === "h1").props.children, "Demo club");
});

test("non-JSON server responses show a readable error and can be retried manually", async t => {
  let calls = 0;
  const app = harness(async () => ++calls === 1
    ? { ok: false, json: async () => { throw new SyntaxError("Unexpected token <"); } }
    : response(roster));
  t.after(() => app.unmount());
  await app.mount();
  assert.equal(alertMessage(app), "The club roster is temporarily unavailable. Please try again.");
  find(alert(app), node => node.type === "button").props.onClick();
  await flush();
  assert.equal(alert(app), undefined);
  assert.ok(grid(app));
});

test("unmount cancels a stalled poll without leaving request or retry timers", async () => {
  let requestSignal;
  const app = harness((_url, options) => { requestSignal = options.signal; return new Promise(() => {}); });
  await app.mount();
  app.unmount();
  await flush();
  assert.equal(requestSignal.aborted, true);
  assert.equal(app.timers.size, 0);
  await app.advance(30000);
  assert.equal(alert(app), undefined);
});

test("timed-out staff responses cannot persist a late refreshed session", async () => {
  const body = deferred();
  const app = harness(async () => ({ ok: true, json: () => body.promise }), {
    session: { accessToken: "test-token", account: { role: "venue" } },
  });
  const request = app.exports.rosterFetch("/api/internal", undefined);
  const failure = assert.rejects(request, /request timed out/);
  await flush();
  await app.advance(15000);
  await failure;
  body.resolve({ ...roster, session: { accessToken: "late-token" } });
  await flush();
  assert.deepEqual(app.persisted, []);
  assert.equal(app.timers.size, 0);
});

for (const failure of ["offline", 429, 503]) {
  test(`a background ${failure} failure quietly retains the roster and recovers on the next 20-minute refresh`, async t => {
    let calls = 0;
    const app = harness(async () => {
      if (++calls === 2) {
        if (failure === "offline") throw new TypeError("Failed to fetch");
        return response({ ok: false, error: "Try later" }, failure);
      }
      return response(calls > 2 ? { ...roster, dancers: [] } : roster);
    });
    t.after(() => app.unmount());
    await app.mount();
    await app.advance(refreshInterval);
    assert.equal(calls, 2);
    assert.ok(grid(app));
    assert.equal(alert(app), undefined);
    assert.equal(find(app.render(), node => node.props?.role === "status"), undefined);
    await app.advance(refreshInterval - 1);
    assert.equal(calls, 2);
    await app.advance(1);
    assert.equal(calls, 3);
    assert.equal(grid(app), undefined);
    assert.ok(find(app.render(), node => node.props?.className === "ir-empty"));
    assert.equal(alert(app), undefined);
  });
}

for (const status of [401, 403, 404, 410]) {
  test(`confirmed access loss (${status}) still clears an already loaded roster and profile`, async t => {
    let revoked = false;
    const app = harness(async url => revoked
      ? response({ ok: false, error: "This club link is unavailable." }, status)
      : response(url.includes("/profile/") ? { ok: true, profile: { id: dancer.id } } : roster));
    t.after(() => app.unmount());
    await app.mount();
    find(app.render(), node => node.props?.className === "ir-profile-link").props.onClick();
    await flush();
    assert.ok(profile(app));
    revoked = true;
    await app.advance(refreshInterval);
    assert.equal(grid(app), undefined);
    assert.equal(profile(app), null);
    assert.equal(alertMessage(app), "This club link is unavailable.");
  });
}

test("unrelated browser storage changes do not reload or hide the guest roster", async t => {
  let calls = 0;
  const app = harness(async () => { calls++; return response(roster); });
  t.after(() => app.unmount());
  await app.mount();
  for (const key of ["favorites", sessionKey, null]) app.storage(key);
  await flush();
  assert.equal(calls, 1);
  assert.ok(grid(app));
});

test("staff sign-out immediately clears the roster and cancels an in-flight refresh", async t => {
  const pending = deferred();
  let calls = 0;
  let signal;
  const app = harness(async (_url, options) => {
    signal = options.signal;
    return ++calls === 2 ? pending.promise : response(roster);
  }, { token: "", session: { accessToken: "staff-token", account: { role: "venue" } } });
  t.after(() => app.unmount());
  await app.mount();
  app.storage("favorites");
  await flush();
  assert.equal(calls, 1);
  assert.ok(grid(app));
  await app.advance(10000);
  app.setSession(null);
  app.storage(sessionKey);
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(grid(app), undefined);
  assert.equal(alertMessage(app), "Sign in with your MyDancr club account to open the internal roster.");
  pending.resolve(response(roster));
  await flush();
  assert.equal(grid(app), undefined);
});

test("sending a table request updates the roster immediately without waiting 20 minutes", async t => {
  const methods = [];
  const app = harness(async (_url, options) => {
    methods.push(options.method);
    return response({ ...roster, kind: "table", receipt: methods.includes("POST") ? { status: "pending" } : null });
  });
  t.after(() => app.unmount());
  await app.mount();
  find(app.render(), node => node.props?.className === "ir-table-request").props.onClick();
  await flush();
  assert.deepEqual(methods, ["GET", "POST", "GET"]);
  assert.ok(grid(app));
  assert.equal(alert(app), undefined);
  assert.match(textContent(requestStatusPanel(app)), /Pending staff acknowledgment/);
});

test("a request made after link revocation clears the roster immediately", async t => {
  const app = harness(async (_url, options) => options.method === "POST"
    ? response({ ok: false, error: "This club link is unavailable." }, 404)
    : response({ ...roster, kind: "table" }));
  t.after(() => app.unmount());
  await app.mount();
  find(app.render(), node => node.props?.className === "ir-table-request").props.onClick();
  await flush();
  assert.equal(grid(app), undefined);
  assert.equal(alertMessage(app), "This club link is unavailable.");
});

test("profile and roster requests share one submission and Request sent status", async t => {
  const pending = deferred(); let sent=false; const posts=[];
  const app=harness(async(url,options)=>{
    if(options.method==='POST') { posts.push(JSON.parse(options.body)); await pending.promise; sent=true; return response({ok:true,receipt:{status:'pending'}}); }
    if(url.includes('/profile/')) return response({ok:true,profile:{id:dancer.id,requestStatus:sent?'pending':null,requestsTonight:sent?1:0}});
    return response({...roster,kind:'table',label:'Table 1',dancers:[{...dancer,requestStatus:sent?'pending':null}]});
  });
  t.after(()=>app.unmount());await app.mount();
  find(app.render(),node=>node.props?.className==='ir-profile-link').props.onClick();await flush();
  const dialog=find(app.render(),node=>node.type?.name==='ClubProfileDialog');
  dialog.props.onRequest();dialog.props.onRequest();
  find(app.render(),node=>node.props?.className==='ir-table-request').props.onClick();
  assert.equal(posts.length,1,'Rapid clicks in either view cannot submit twice');
  pending.resolve();await flush();await flush();
  const button=find(app.render(),node=>node.props?.className==='ir-table-request');
  assert.equal(find(button,node=>node.type==='span').props.children,'Request sent');assert.equal(button.props.disabled,true);
  assert.equal(profile(app).requestStatus,'pending');assert.equal(profile(app).requestsTonight,1);
  find(app.render(),node=>node.type?.name==='ClubProfileDialog').props.onRequest();
  assert.equal(posts.length,1);
});

test("each dancer has an independent sending state in both the grid and full profile", async t => {
  const dancers = [dancer, { ...dancer, id: 'dancer-2', stageName: 'Second dancer' }, { ...dancer, id: 'dancer-3', stageName: 'Third dancer' }];
  const posts = [], sent = new Set();
  const app = harness(async (url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body), pending = deferred();
      posts.push({ ...body, pending });
      const result = await pending.promise;
      if (result.ok) sent.add(body.dancerId);
      return response(result, result.ok ? 200 : 429);
    }
    if (url.includes('/profile/')) {
      const id = url.split('/profile/')[1].split('?')[0];
      return response({ ok: true, profile: { id, requestStatus: sent.has(id) ? 'pending' : null } });
    }
    return response({ ...roster, kind: 'table', dancers: dancers.map(item => ({ ...item, requestStatus: sent.has(item.id) ? 'pending' : null })) });
  });
  t.after(() => app.unmount()); await app.mount();
  requestButton(app, dancer.id).props.onClick();
  assert.equal(requestButton(app, dancer.id).props.children, 'Sending…');
  assert.equal(requestButton(app, dancer.id).props['aria-busy'], true);
  assert.equal(requestButton(app, 'dancer-2').props.disabled, false);
  assert.equal(requestButton(app, 'dancer-3').props.disabled, false);
  requestButton(app, 'dancer-2').props.onClick();
  requestButton(app, dancer.id).props.onClick();
  assert.equal(posts.length, 2, 'Different dancers can submit while duplicate clicks stay blocked');
  assert.notEqual(posts[0].requestKey, posts[1].requestKey);
  assert.equal(requestButton(app, 'dancer-2').props.children, 'Sending…');
  const open = async id => {
    const card = find(app.render(), node => node.type === 'article' && node.key === id);
    find(card, node => node.props?.className === 'ir-profile-link').props.onClick(); await flush();
    return find(app.render(), node => node.type?.name === 'ClubProfileDialog');
  };
  assert.equal((await open('dancer-3')).props.request.busy, false);
  const secondProfile = await open('dancer-2');
  assert.equal(secondProfile.props.request.busy, true);
  secondProfile.props.onRequest(); assert.equal(posts.length, 2);
  posts[1].pending.resolve({ ok: false, error: 'Please wait before sending another request.' }); await flush();
  assert.equal(requestButton(app, 'dancer-2').props.disabled, false);
  assert.equal(requestButton(app, dancer.id).props.children, 'Sending…', 'A failed request cannot clear another dancer’s sending state');
  requestButton(app, 'dancer-2').props.onClick();
  assert.equal(posts[2].requestKey, posts[1].requestKey, 'A retry retains that dancer’s idempotency key');
  posts[2].pending.resolve({ ok: true, receipt: { status: 'pending' } }); await flush();
  assert.equal(requestButton(app, dancer.id).props.children, 'Sending…');
  assert.equal(find(requestButton(app, 'dancer-2'), node => node.type === 'span').props.children, 'Request sent');
  assert.equal(requestButton(app, 'dancer-3').props.disabled, false);
  posts[0].pending.resolve({ ok: true, receipt: { status: 'pending' } }); await flush();
  assert.equal(find(requestButton(app, dancer.id), node => node.type === 'span').props.children, 'Request sent');
  assert.equal(find(requestButton(app, 'dancer-2'), node => node.type === 'span').props.children, 'Request sent');
  assert.equal(requestButton(app, 'dancer-3').props.disabled, false);
});

test("confirmed requests stop sending immediately even when the follow-up roster read stalls", async t => {
  const delayedRead = deferred(); let sent = false;
  const app = harness(async (_url, options) => {
    if (options.method === 'POST') { sent = true; return response({ ok: true, receipt: { status: 'pending' } }); }
    return sent ? delayedRead.promise : response({ ...roster, kind: 'table' });
  });
  t.after(() => app.unmount()); await app.mount();
  requestButton(app, dancer.id).props.onClick(); await flush();
  const button = requestButton(app, dancer.id);
  assert.equal(button.props['aria-busy'], false);
  assert.equal(button.props.disabled, true);
  assert.equal(find(button, node => node.type === 'span').props.children, 'Request sent');
  delayedRead.resolve(response({ ...roster, kind: 'table', dancers: [{ ...dancer, requestStatus: 'pending' }] })); await flush();
});

test("a timed-out request releases only its own button and can be retried", async t => {
  const second = { ...dancer, id: 'dancer-2', stageName: 'Second dancer' }, posts = [];
  const app = harness(async (_url, options) => {
    if (options.method === 'POST') { posts.push(JSON.parse(options.body)); return new Promise(() => {}); }
    return response({ ...roster, kind: 'table', dancers: [dancer, second] });
  });
  t.after(() => app.unmount()); await app.mount();
  requestButton(app, dancer.id).props.onClick(); await app.advance(1000);
  requestButton(app, second.id).props.onClick(); await app.advance(14000);
  assert.equal(requestButton(app, dancer.id).props.disabled, false);
  assert.equal(requestButton(app, second.id).props.children, 'Sending…');
  requestButton(app, dancer.id).props.onClick();
  assert.equal(posts.length, 3); assert.equal(posts[2].requestKey, posts[0].requestKey);
  await app.advance(15000);
});

test("failed request retries preserve the same idempotency key and a reloaded table can cancel its saved request", async t => {
  const keys=[];
  const app=harness(async(_url,options)=>{
    if(options.method==='POST') { keys.push(JSON.parse(options.body).requestKey); throw new TypeError('Failed to fetch'); }
    return response({...roster,kind:'table'});
  });t.after(()=>app.unmount());await app.mount();
  find(app.render(),node=>node.props?.className==='ir-table-request').props.onClick();await flush();
  find(app.render(),node=>node.props?.className==='ir-table-request').props.onClick();await flush();
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  const reloaded=harness(async(_url,options)=>{assert.equal(options.method,'GET');return response({...roster,kind:'table',dancers:[{...dancer,requestStatus:'pending',requestId:'saved-request'}]});});
  t.after(()=>reloaded.unmount());await reloaded.mount();
  const button=find(reloaded.render(),node=>node.props?.className==='ir-table-request');
  assert.equal(button.props.children,'Cancel request');assert.equal(button.props.disabled,false);
});

test("a background read started before submission cannot undo Request sent", async t => {
  const oldRead=deferred();let reads=0,sent=false;
  const app=harness(async(_url,options)=>{
    if(options.method==='POST'){sent=true;return response({ok:true,receipt:{status:'pending'}});}
    if(++reads===2)return oldRead.promise;
    return response({...roster,kind:'table',dancers:[{...dancer,requestStatus:sent?'pending':null}]});
  });t.after(()=>app.unmount());await app.mount();await app.advance(refreshInterval);
  find(app.render(),node=>node.props?.className==='ir-table-request').props.onClick();await flush();await flush();
  oldRead.resolve(response({...roster,kind:'table',dancers:[{...dancer,requestStatus:null}]}));await flush();
  const button=find(app.render(),node=>node.props?.className==='ir-table-request');
  assert.equal(find(button,node=>node.type==='span').props.children,'Request sent');assert.equal(button.props.disabled,true);
});

test("an open staff profile also refreshes quietly every 20 minutes and closes on confirmed access loss", async t => {
  let calls = 0;
  const app = harness(async () => {
    calls++;
    if (calls === 2) throw new TypeError("Failed to fetch");
    if (calls === 4) return response({ ok: false, error: "Profile unavailable." }, 403);
    return response({ ok: true, profile: { id: dancer.id } });
  }, { component: "VenueRosterProfileButton", session: { accessToken: "staff-token", account: { role: "venue" } } });
  t.after(() => app.unmount());
  await app.mount();
  assert.ok(profile(app));
  await app.advance(refreshInterval - 1);
  assert.equal(calls, 1);
  await app.advance(1);
  assert.equal(calls, 2);
  assert.ok(profile(app));
  assert.equal(find(app.render(), node => node.props?.role === "status"), undefined);
  await app.advance(refreshInterval);
  assert.equal(calls, 3);
  assert.ok(profile(app));
  await app.advance(refreshInterval);
  assert.equal(profile(app), null);
});

test("shared venue cards hand off their existing image without creating per-card viewers", async t => {
  const selections = [];
  const app = harness(() => assert.fail("A shared card cannot fetch its own profile"), { component: "VenueRosterProfileButton", sharedOpen: value => selections.push(value) });
  t.after(() => app.unmount()); await app.mount();
  const tree = app.render();
  assert.equal(find(tree, node => node.type?.name === "ClubProfileDialog"), undefined);
  find(tree, node => node.type === "button").props.onClick({ currentTarget: { querySelector: () => ({ currentSrc: "blob:https://example.invalid/card" }) } });
  assert.equal(selections[0].id, dancer.id);
  assert.equal(selections[0].photoUrl, "blob:https://example.invalid/card");
});

test("one venue viewer opens immediately, cancels a switched dancer and keeps refreshed sessions", async t => {
  const first = deferred(), calls = [];
  const app = harness(async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("first") ? first.promise : response({ ok: true, profile: { id: "second", stage_name: "Second" }, session: { accessToken: "refreshed" } });
  }, { component: "VenueProfileProvider", session: { accessToken: "owner", account: { role: "venue" } }, persistRefresh: true });
  t.after(() => app.unmount()); await app.mount();
  app.render().props.value({ id: "first", stageName: "First", photoUrl: "card-first" });
  let tree = app.render(); app.runEffect(0, true);
  const dialog = () => find(app.render(), node => node.type?.name === "ClubProfileDialog").props;
  assert.equal(dialog().prewarm, true);
  assert.equal(dialog().profileId, "first");
  assert.equal(dialog().profile, null);
  tree.props.value({ id: "second", stageName: "Second", photoUrl: "card-second" });
  app.render(); app.runEffect(0, true); await flush();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(dialog().profile.id, "second");
  assert.equal(dialog().profile.initialPhotoUrl, "card-second");
  first.resolve(response({ ok: true, profile: { id: "first" } })); await flush();
  assert.equal(dialog().profile.id, "second");
  app.focus();
  assert.equal(dialog().profile.id, "second", "Own session refresh does not dismiss the viewer");
  app.setSession({ accessToken: "different-account", account: { role: "venue" } }); app.focus();
  assert.equal(dialog().profileId, "");
  assert.equal(dialog().profile, null);
});
