import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/internal/InternalRoster.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(`${source}\nexport { rosterFetch };`, {
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

function harness(fetch, { token = "table-token", session = null, component = "InternalRoster", url = "https://example.invalid/internal/club/table-token" } = {}) {
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
  const cleanups = [];
  const persisted = [];
  const replacements = [];
  const listeners = new Map();
  const documentListeners = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener: (name, callback) => documentListeners.set(name, callback),
    removeEventListener: name => documentListeners.delete(name),
  };
  let stateIndex = 0;
  let refIndex = 0;
  let mounting = true;
  const exports = {};
  vm.runInNewContext(code, {
    exports, fetch, document, Error, AbortController, URL, crypto: { randomUUID: () => `request-key-${++nextRequestKey}` },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => schedule(callback, delay),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearTimeout: id => timers.delete(id),
    clearInterval: id => timers.delete(id),
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
      location: { hash: "", href: url }, history: { state: null, replaceState: (_state, _title, path) => replacements.push(path) }, cancelAnimationFrame() {},
    },
    require(name) {
      if (name === "react/jsx-runtime") return require(name);
      if (name === "react") return {
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
        useEffect: callback => { if (mounting) effects.push(callback); },
      };
      if (name === "./InternalRequestPushSettings") return { InternalRequestPushSettings: () => null };
      if (name === "./InternalFullProfile") return { InternalFullProfile: () => null };
      if (name === "@/src/lib/dancr/browser-session") return {
        BROWSER_AUTH_SESSION_KEY: sessionKey,
        readBrowserAuthSession: () => session,
        isCurrentBrowserSession: expected => expected?.accessToken === session?.accessToken,
        persistRefreshedBrowserAuthSession: (...args) => persisted.push(args),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    const tree = exports[component]({ token, dancerId: dancer.id, stageName: dancer.stageName });
    mounting = false;
    return tree;
  };
  return {
    exports, persisted, timers, render, replacements, listeners, documentListeners,
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
const refreshButton = app => find(app.render(), node => node.props?.className === "ir-roster-refresh");
const refreshMessage = app => find(app.render(), node => node.props?.className === "ir-refresh-message")?.props.children;

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
 assert.match(find(app.render(),node=>node.props?.className==='ir-notice').props.children,/timed out/);
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
 assert.ok(find(app.render(),node=>node.props?.className==='ir-request'));
 await app.advance(10000);assert.equal(calls.at(-1),'/api/internal/requests');
 assert.equal(find(app.render(),node=>node.props?.className==='ir-request'),undefined);assert.ok(grid(app));
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

test("a stalled viewer returns an inline retry message without taking over the roster",async t=>{
 const app=harness(async url=>response(url.includes('/profile/')?{ok:true,profile:{id:dancer.id}}:roster));t.after(()=>app.unmount());await app.mount();
 find(app.render(),node=>node.props?.className==='ir-profile-link').props.onClick();await flush();
 find(app.render(),node=>node.type?.name==='ClubProfileDialog').props.onError();
 assert.equal(profile(app),null);assert.ok(grid(app));
 assert.equal(find(app.render(),node=>node.props?.className==='ir-notice').props.children,'That profile could not load. Please try again.');
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
  assert.ok(find(app.render(), node => node.type === "strong" && node.props.children === "pending"));
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
