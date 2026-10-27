import { refreshButtonModule } from './helpers/refresh-button.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";
import { createInternalRosterDatabase } from "./helpers/internal-roster-database.mjs";
import { fixtureId as id } from "./helpers/dancer-tap-database.mjs";
import { existingTableNumbers, readTableQrRange } from "../app/admin/admin-table-qr-range.ts";
import { loadTableQrPrintImages } from "../app/admin/admin-table-qr-print.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, Request, Response, URL, Date, Error, AbortController, AbortSignal, process: { env: {} }, ...globals,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return exports;
}
const code = (overrides = {}) => ({ id: id(80), venue_id: id(20), kind: "table", label: "Table 1", token: id(90), active: true, updated_at: "2026-10-19T00:00:00Z", ...overrides });
// Match Echo's deterministic row IDs; its separate QR tokens remain random UUIDs.
const echoTableIds = Array.from({ length: 6 }, (_, i) => createHash("md5")
  .update(`mydancr-echo-dashboard-v1:table:${i + 1}`).digest("hex")
  .replace(/^(........)(....)(....)(....)(............)$/, "$1-$2-$3-$4-$5"));

test("admin table QR database enforces ownership, retry safety, labels and atomic revocation", async () => {
  const db = await createInternalRosterDatabase();
  try {
    await db.exec(read("supabase/migrations/20261019071556_admin_table_qr_codes.sql"));
    const call = async (action, data, actor = id(3), venue = id(20)) => (await db.query(
      "select public.admin_manage_table_qr($1,$2,$3,$4::jsonb) result", [actor, venue, action, JSON.stringify(data)],
    )).rows[0].result;
    await db.exec("set role service_role");
    for (const actor of [id(1), id(2), id(4), id(999)]) {
      await assert.rejects(call("create", { id: id(80), label: "Table 1" }, actor), /ADMIN_REQUIRED/);
    }
    await db.query("update public.app_users set account_state='disabled' where id=$1", [id(3)]);
    await assert.rejects(call("create", { id: id(80), label: "Table 1" }), /ADMIN_REQUIRED/);
    await db.query("update public.app_users set account_state='active' where id=$1", [id(3)]);
    for (const label of ["", " ", "a".repeat(61), "Table\n1"]) {
      await assert.rejects(call("create", { id: id(80), label }), /INVALID_TABLE_LABEL/);
    }
    await assert.rejects(call("create", { id: id(80), label: "Table 1" }, id(3), id(999)), /VENUE_NOT_FOUND/);
    const first = await call("create", { id: id(80), label: " Table 1 " });
    assert.equal(first.kind, "table"); assert.equal(first.active, true); assert.equal(first.label, "Table 1");
    assert.notEqual(first.token, first.id);
    assert.deepEqual(await call("create", { id: id(80), label: "Table 1" }), first);
    assert.equal((await db.query("select count(*)::int n from public.internal_roster_links")).rows[0].n, 1);
    await assert.rejects(call("create", { id: id(81), label: "table 1" }), /TABLE_LABEL_EXISTS/);
    await assert.rejects(call("create", { id: id(80), label: "Table 2" }), /TABLE_QR_CHANGED/);
    await assert.rejects(call("disable", { id: id(80) }, id(3), id(21)), /TABLE_QR_NOT_FOUND/);
    await assert.rejects(call("rename", { id: id(80), label: "Patio", expectedUpdatedAt: "2000-01-01Z" }), /TABLE_QR_CHANGED/);
    const renamed = await call("rename", { id: id(80), label: "Patio", expectedUpdatedAt: first.updated_at });
    assert.equal(renamed.token, first.token);
    assert.equal((await call("rename", { id: id(80), label: "Patio", expectedUpdatedAt: first.updated_at })).label, "Patio");
    await call("create", { id: id(81), label: "Table 2" });
    await assert.rejects(call("rename", { id: id(81), label: "Patio", expectedUpdatedAt: first.updated_at }), /TABLE_LABEL_EXISTS/);
    await db.query("insert into public.internal_roster_requests(venue_id,link_id,dancer_id,request_key,status) values($1,$2,$3,$4,'pending'),($1,$2,$3,$5,'completed')", [id(20), id(80), id(10), id(100), id(101)]);
    await db.exec("reset role; create function fail_table_cancel() returns trigger language plpgsql as $$begin raise exception 'synthetic cancel failure'; end$$; create trigger fail_table_cancel before update on public.internal_roster_requests for each row execute function fail_table_cancel(); set role service_role;");
    await assert.rejects(call("disable", { id: id(80) }), /synthetic cancel failure/);
    assert.equal((await db.query("select active from public.internal_roster_links where id=$1", [id(80)])).rows[0].active, true);
    await db.exec("reset role; drop trigger fail_table_cancel on public.internal_roster_requests; set role service_role;");
    const disabled = await call("disable", { id: id(80) });
    assert.equal(disabled.active, false); assert.notEqual(disabled.token, first.token);
    assert.deepEqual(await call("disable", { id: id(80) }), disabled);
    assert.deepEqual((await db.query("select status from public.internal_roster_requests order by request_key")).rows.map(row => row.status), ["cancelled", "completed"]);
    assert.equal((await db.query("select active from public.internal_roster_links where id=$1", [id(81)])).rows[0].active, true);
    await assert.rejects(call("rename", { id: id(80), label: "Reopen", expectedUpdatedAt: disabled.updated_at }), /TABLE_QR_CHANGED/);
    await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(call("create", { id: id(82), label: "Table 3" }), /permission denied/);
      await assert.rejects(db.query("select token from public.internal_roster_links"), /permission denied/);
      await db.exec("reset role");
    }
    assert.equal((await db.query("select prosecdef from pg_proc where oid='public.admin_manage_table_qr(uuid,uuid,text,jsonb)'::regprocedure")).rows[0].prosecdef, false);
  } finally { await db.close(); }
});

function apiFixture({ role = "admin", signedIn = true, missing = false, rpcError = null, badResult = false } = {}) {
  const calls = [];
  const admin = {
    from(table) {
      calls.push({ table }); let venueId, linkId;
      const query = { select() { return query; }, eq(key, value) { if (key === "venue_id" || table === "venues" && key === "id") venueId = value; if (key === "id") linkId = value; calls.push({ filter: key, value }); return query; },
        order() { return query; }, maybeSingle: async () => ({ data: missing ? null : table === "venues" ? { id: venueId } : code({ id: linkId, venue_id: venueId }) }),
        then(resolve, reject) { return Promise.resolve({ data: [code({ venue_id: venueId })] }).then(resolve, reject); } };
      return query;
    },
    async rpc(name, args) { calls.push({ name, args }); return { error: rpcError, data: badResult ? null : code({ id: args.p_data.id, venue_id: args.p_venue,
      active: args.p_action !== "disable", label: args.p_data.label || "Table 1" }) }; },
  };
  const route = compile("app/api/admin/venues/table-qr/route.ts", {
    "next/server": { NextResponse: Response },
    "@/src/lib/dancr/table-qr-image": { createTableQrImage: async (url, label) => { calls.push({ qrUrl: url, label }); return "data:image/png;base64,synthetic"; } },
    "@/src/lib/api": { PublicApiError, apiError: error => { const result = resolveApiError(error, "Failed."); return Response.json(result.body, { status: result.status }); } },
    "@/src/lib/dancr/admin": { requireAdmin: async () => { if (role !== "admin") throw new PublicApiError("FORBIDDEN", "Admin required.", 403); } },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async (_request, access) => {
      assert.equal(access.role, "admin");
      if (!signedIn) throw new PublicApiError("AUTH_REQUIRED", "Sign in.", 401);
      return { client: {}, user: { id: id(3) }, session: { accessToken: "refreshed" } };
    } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => admin },
  });
  return { calls, get: (venue = id(20), download) => route.GET(new Request(`https://example.invalid/api/admin/venues/table-qr?venueId=${venue}${download ? `&download=${download}` : ""}`)),
    post: (body = {}) => route.POST(new Request("https://example.invalid/api/admin/venues/table-qr", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", id: id(80), venueId: id(20), label: "Table 1", ...body }) })) };
}
test("API restricts reads and writes to admins and uses the verified actor", async () => {
  for (const options of [{ signedIn: false }, { role: "venue" }, { role: "dancer" }, { role: "customer" }]) {
    const f = apiFixture(options);
    assert.ok([401, 403].includes((await f.get()).status)); assert.ok([401, 403].includes((await f.post()).status)); assert.equal(f.calls.length, 0);
  }
  const f = apiFixture(); const readResponse = await f.get();
  assert.match(readResponse.headers.get("cache-control"), /private, no-store/);
  assert.equal((await readResponse.json()).links[0].venue_id, id(20));
  const response = await f.post({ actor: id(2), token: "untrusted", kind: "display" });
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await response.json()).session.accessToken, "refreshed");
  const { args } = f.calls.at(-1);
  assert.equal(args.p_actor, id(3)); assert.equal(args.p_venue, id(20));
  assert.deepEqual(JSON.parse(JSON.stringify(args.p_data)), { id: id(80), label: "Table 1" });
});
test("QR download encodes only a saved active table in the authorized club", async () => {
  const f = apiFixture(); const response = await f.get(id(20), id(80));
  assert.equal(response.status, 200); assert.equal((await response.json()).imageDataUrl, "data:image/png;base64,synthetic");
  assert.equal(f.calls.at(-1).qrUrl, `https://www.mydancr.com/internal/club/${id(90)}`);
  assert.equal(f.calls.at(-1).label, "Table 1");
  for (const [filter, value] of [["venue_id", id(20)], ["kind", "table"], ["active", true], ["id", id(80)]]) {
    assert.ok(f.calls.some(call => call.filter === filter && call.value === value));
  }
  assert.equal((await apiFixture({ signedIn: false }).get(id(20), id(80))).status, 401);
  for (const role of ['venue', 'dancer', 'customer']) {
    const denied = apiFixture({ role });
    assert.equal((await denied.get(id(20), id(80))).status, 403);
    assert.equal(denied.calls.some(call => call.qrUrl), false);
  }
  assert.equal((await apiFixture().get(id(20), "bad")).status, 400);
});
test("API fails closed for bad inputs, conflicts and unconfirmed database writes", async () => {
  for (const body of [{ label: " " }, { label: "x".repeat(61) }, { label: "Table\n1" }, { id: "bad" }, { venueId: "bad" }, { action: "delete" }, { action: "rename" }, { action: "rename", expectedUpdatedAt: "bad" }]) {
    const f = apiFixture(); assert.equal((await f.post(body)).status, 400); assert.equal(f.calls.length, 0);
  }
  assert.equal((await apiFixture().post({ label: "x".repeat(3000) })).status, 413);
  assert.equal((await apiFixture().get("bad")).status, 400);
  assert.equal((await apiFixture({ missing: true }).get()).status, 404);
  assert.equal((await apiFixture({ badResult: true }).post()).status, 500);
  for (const [message, status] of [["TABLE_LABEL_EXISTS", 409], ["TABLE_QR_CHANGED", 409], ["TABLE_QR_NOT_FOUND", 404], ["ADMIN_REQUIRED", 403]]) {
    assert.equal((await apiFixture({ rpcError: { message } }).post()).status, status);
  }
});

test("admin API accepts seeded table row IDs for download, rename and disable", async () => {
  for (const tableId of echoTableIds) {
    const f = apiFixture();
    assert.equal((await f.get(id(20), tableId)).status, 200);
    assert.equal(f.calls.at(-1).qrUrl, `https://www.mydancr.com/internal/club/${id(90)}`);
    for (const action of ["rename", "disable"]) {
      const response = await f.post({ id: tableId, action, label: "Patio", expectedUpdatedAt: code().updated_at });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).link.id, tableId);
      assert.equal(f.calls.at(-1).args.p_venue, id(20));
      assert.equal(f.calls.at(-1).args.p_actor, id(3));
    }
    assert.equal((await apiFixture({ role: "venue" }).post({ id: tableId })).status, 403);
  }
  for (const malformed of ["not-a-uuid", `${echoTableIds[0]}/extra`, echoTableIds[0].replace(/-/g, ""), echoTableIds[0].replace(/f/, "g")]) {
    assert.equal((await apiFixture().post({ id: malformed })).status, 400);
    assert.equal((await apiFixture().get(id(20), malformed)).status, 400);
  }
});

const Preview = () => null;
function componentFixture(handler) {
  const slots = [], effects = []; let cursor = 0, tree; const requests = [];
  const printWindows = [];
  let nextId = 80;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++; const old = slots[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) { old?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = effect(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const { default: Component } = compile("app/admin/AdminTableQrCodes.tsx", {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx }, "./admin-table-qr.css": {},
    "../components/RefreshButton": refreshButtonModule,
    "./admin-table-qr-range": { existingTableNumbers, readTableQrRange },
    "./admin-table-qr-print": { loadTableQrPrintImages },
    "./AdminTableQrPreview": { default: Preview },
    "./admin-session": { isAdminAuthenticationError: error => error.status === 401, requestAdminJson: async (url, options) => {
      requests.push({ url, options }); return handler(url, options, requests.length);
    } },
  }, { crypto: { randomUUID: () => id(nextId++) }, window: { confirm: () => true, location: { origin: "https://www.mydancr.com" }, open: () => {
    printWindows.push(true); return null; // Mobile popup blockers must not prevent previews.
  } },
    navigator: { clipboard: { writeText: async () => {} } } });
  function render() { cursor = 0; tree = Component({ venueId: id(20), name: "Synthetic club" }); while (effects.length) effects.shift()(); return tree; }
  function nodes(node) { if (!node || typeof node !== "object") return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(child => nodes(child))]; }
  const find = predicate => nodes(tree).find(predicate);
  async function settle() { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } }
  render();
  return { requests, printWindows, render, find, settle, preview: () => find(node => node.type === Preview)?.props, open() { tree.props.onToggle({ currentTarget: { open: true } }); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
test("admin component loads on demand, creates once and exposes an authenticated print action", async () => {
  let resolveWrite;
  const f = componentFixture(async (_url, options) => options.method === "POST" ? new Promise(resolve => { resolveWrite = resolve; }) : { venueId: id(20), links: [] });
  assert.equal(f.requests.length, 0); f.open(); await f.settle();
  f.find(node => node.type === "input").props.onChange({ target: { value: "Table 1" } }); f.render();
  const submit = f.find(node => node.type === "form").props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await f.settle();
  assert.equal(f.requests.filter(item => item.options.method === "POST").length, 1);
  resolveWrite({ venueId: id(20), link: code() }); await f.settle();
  assert.ok(f.find(node => node.type === "button" && node.props.children === 'Print QR sign'));
  assert.equal(f.find(node => node.type === "a" && node.props.href?.startsWith('/internal/sign/')), undefined);
  assert.ok(f.find(node => node.type === "a" && node.props.href === `/internal/club/${id(90)}`));
  assert.equal(f.find(node => node.type === "input").props.value, "");
  f.unmount();
});

test("single and bulk signs preview in Admin even when popup windows are blocked", async () => {
  const codes = [code(), code({ id: id(81), label: 'Table 2' }), code({ id: id(82), active: false })];
  const f = componentFixture(async path => {
    const download = new URL(path, 'https://example.invalid').searchParams.get('download');
    return download ? { venueId: id(20), id: download, imageDataUrl: 'data:image/png;base64,cXI=' } : { venueId: id(20), links: codes };
  });
  f.open(); await f.settle();
  f.find(node => node.type === 'button' && node.props.children === 'Print QR sign').props.onClick(); await f.settle();
  assert.deepEqual(f.preview().images.map(image => image.label), ['Table 1']);
  assert.equal(f.printWindows.length, 0);
  assert.equal(f.requests.filter(request => request.url.includes('download=')).length, 1);
  f.find(node => node.type === 'button' && node.props.children === 'Print all').props.onClick(); await f.settle();
  assert.deepEqual(f.preview().images.map(image => image.label), ['Table 1', 'Table 2']);
  assert.equal(f.printWindows.length, 0);
  assert.ok(f.requests.every(request => request.url.startsWith('/api/admin/venues/table-qr')));
  f.unmount();
});

test("expired Admin authorization cannot render or print a saved table sign", async () => {
  const f = componentFixture(async path => {
    if (path.includes('download=')) throw Object.assign(new Error('Sign in required.'), { status: 401 });
    return { venueId: id(20), links: [code()] };
  });
  f.open(); await f.settle();
  f.find(node => node.type === 'button' && node.props.children === 'Print QR sign').props.onClick(); await f.settle();
  assert.equal(f.preview(), undefined);
  assert.equal(f.printWindows.length, 0);
  assert.match(f.find(node => node.props.role === 'alert').props.children, /Sign in required/);
  assert.equal(f.find(node => node.type === 'button' && node.props.children === 'Print QR sign'), undefined);
  f.unmount();
});

test("view and download waits for a matching saved image without claiming a download happened", async () => {
  let finish;
  const f = componentFixture(async path => path.includes('download=')
    ? new Promise(resolve => { finish = resolve; }) : { venueId: id(20), links: [code()] });
  f.open(); await f.settle();
  const button = f.find(node => node.type === 'button' && node.props.children === 'View / download QR');
  button.props.onClick(); button.props.onClick(); await f.settle();
  assert.equal(f.requests.filter(request => request.url.includes('download=')).length, 1);
  assert.equal(f.preview(), undefined);
  finish({ venueId: id(20), id: id(80), imageDataUrl: 'data:image/png;base64,cXI=' }); await f.settle();
  assert.equal(f.preview().images[0].id, id(80));
  assert.match(f.find(node => node.props.role === 'status').props.children, /QR preview ready/);
  assert.equal(f.printWindows.length, 0);
  f.preview().onClose(); f.render(); assert.equal(f.preview(), undefined);
  f.unmount();
});

test("failed, mismatched and aborted image requests cannot expose a stale QR preview", async () => {
  for (const failure of ['request', 'venue', 'code', 'unmount']) {
    let finish;
    const f = componentFixture(async path => path.includes('download=')
      ? new Promise((resolve, reject) => { finish = failure === 'request' ? () => reject(new Error('Image request failed')) : resolve; })
      : { venueId: id(20), links: [code()] });
    f.open(); await f.settle();
    f.find(node => node.type === 'button' && node.props.children === 'View / download QR').props.onClick(); await f.settle();
    if (failure === 'unmount') f.unmount();
    finish({ venueId: failure === 'venue' ? id(21) : id(20), id: failure === 'code' ? id(81) : id(80), imageDataUrl: 'data:image/png;base64,cXI=' });
    await f.settle();
    assert.equal(f.preview(), undefined);
    if (failure !== 'unmount') assert.ok(f.find(node => node.props.role === 'alert'));
    f.unmount();
  }
});
test("Echo's existing sample tables do not block the create form or a new table", async () => {
  const existing = echoTableIds.map((tableId, i) => code({ id: tableId, label: `Sample table ${i + 1}`, token: id(100 + i) }));
  existing.push(code({ id: id(79), label: "Table 1" }));
  const f = componentFixture(async (_url, options) => {
    if (options.method !== "POST") return { venueId: id(20), links: existing };
    const body = JSON.parse(options.body);
    return { venueId: id(20), link: code({ id: body.id, label: body.label }) };
  });
  try {
    f.open(); await f.settle();
    assert.equal(f.find(node => node.props.role === "alert"), undefined);
    for (const row of existing) assert.ok(f.find(node => node.type === "strong" && node.props.children === row.label));
    const input = f.find(node => node.type === "input");
    assert.ok(input, "The create form must remain available with all seven existing Echo tables");
    input.props.onChange({ target: { value: "Table 2" } }); f.render();
    assert.equal(f.find(node => node.type === "button" && node.props.children === "Create QR code").props.disabled, false);
    f.find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await f.settle();
    assert.ok(f.find(node => node.type === "strong" && node.props.children === "Table 2"));
    assert.ok(f.find(node => node.props.role === "status" && node.props.children === "Table QR code created."));
  } finally { f.unmount(); }
});
test("accepting seeded row IDs does not accept malformed IDs or QR tokens", async () => {
  for (const override of [{ id: "bad" }, { id: `${echoTableIds[0]}/extra` }, { token: echoTableIds[0] }, { token: "bad" }, { venue_id: id(21) }, { kind: "display" }]) {
    const f = componentFixture(async () => ({ venueId: id(20), links: [code({ id: echoTableIds[0], ...override })] }));
    try {
      f.open(); await f.settle();
      assert.ok(f.find(node => node.props.role === "alert"));
      assert.equal(f.find(node => node.type === "form"), undefined);
      assert.equal(f.find(node => node.type === "a"), undefined);
    } finally { f.unmount(); }
  }
});
test("create retry preserves its id and malformed or aborted loads do not expose codes", async () => {
  const f = componentFixture(async (_url, options) => { if (options.method === "POST") throw new Error("Connection lost"); return { venueId: id(20), links: [] }; });
  f.open(); await f.settle(); f.find(node => node.type === "input").props.onChange({ target: { value: "Table 1" } }); f.render();
  for (let i = 0; i < 2; i++) { f.find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await f.settle(); }
  const writes = f.requests.filter(item => item.options.method === "POST").map(item => JSON.parse(item.options.body));
  assert.equal(writes.length, 2); assert.equal(writes[0].id, writes[1].id); f.unmount();
  const bad = componentFixture(async () => ({ venueId: id(21), links: [code()] })); bad.open(); await bad.settle();
  assert.ok(bad.find(node => node.props.role === "alert")); assert.equal(bad.find(node => node.type === "a"), undefined); bad.unmount();
  const pending = componentFixture(async () => new Promise(() => {})); pending.open(); pending.unmount();
  assert.equal(pending.requests[0].options.signal.aborted, true);
});
test("creator is mounted in club records while venue provisioning remains forbidden", () => {
  assert.match(read("app/admin/AdminClient.tsx"), /openedVenues\[venueId\].*<AdminInternalNfcTables/);
  assert.match(read("app/api/internal/[[...path]]/route.ts"), /\["link_create", "link_update", "link_revoke"\][\s\S]*Table (?:NFC|phone tap) setup is managed by MyDancr Admin/);
  assert.match(read("app/admin/admin-table-qr.css"), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("table ranges include both ends, support club numbering, and reject invalid numbers", () => {
  for (const [first, last, count] of [[201, 210, 10], [201, 211, 11], [501, 501, 1], [1, 10001, 10001], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1]]) {
    assert.deepEqual(readTableQrRange(String(first), String(last)), { range: { start: first, end: last, count }, error: "" });
  }
  for (const [first, last] of [["", "210"], ["201", ""], ["211", "201"], ["0", "10"], ["-1", "10"], ["1.5", "3"], ["1e2", "200"], ["201", "Infinity"], ["1", "9007199254740992"]]) {
    const result = readTableQrRange(first, last);
    assert.equal(result.range, null); assert.ok(result.error);
  }
  assert.equal(readTableQrRange("", "").range, null);
  const range = readTableQrRange("201", "211").range;
  assert.deepEqual([...existingTableNumbers(range, [
    code({ label: " table 201 " }), code({ label: "Table 201" }), code({ label: "Table 202", active: false }),
    code({ label: "Table 200" }), code({ label: "Table 212" }), code({ label: "Patio 203" }), code({ label: "Table 0204" }),
  ])], [201]);
});

async function selectRange(f, first = "201", last = "210") {
  f.find(node => node.type === "button" && node.props.children === "Number range").props.onClick(); f.render();
  f.find(node => node.type === "input" && node.props.placeholder === "201").props.onChange({ target: { value: first } });
  f.find(node => node.type === "input" && node.props.placeholder === "210").props.onChange({ target: { value: last } });
  f.render();
}
const rangeForm = f => f.find(node => node.type === "form" && node.props.className === "admin-table-qr-range");
const posts = f => f.requests.filter(item => item.options.method === "POST").map(item => JSON.parse(item.options.body));

test("bulk creation previews the count and creates each internal table once, skipping current active labels", async () => {
  const saved = [code({ id: id(70), label: "Table 201" }), code({ id: id(71), label: "Table 202", active: false })];
  let reads = 0;
  const f = componentFixture(async (_url, options) => {
    if (options.method !== "POST") {
      // Another admin created this code after the first load; the bulk preflight must see it.
      if (++reads === 2) saved.push(code({ id: id(72), label: "table 205" }));
      return { venueId: id(20), links: [...saved] };
    }
    const body = JSON.parse(options.body);
    const link = code({ id: body.id, label: body.label, token: id(200 + saved.length) }); saved.push(link);
    return { venueId: id(20), link };
  });
  try {
    f.open(); await f.settle(); await selectRange(f);
    assert.ok(f.find(node => node.type === "button" && node.props.children === "Create 9 QR codes"));
    const submit = rangeForm(f).props.onSubmit;
    submit({ preventDefault() {} }); submit({ preventDefault() {} }); await f.settle();
    assert.deepEqual(posts(f).map(row => row.label), [202, 203, 204, 206, 207, 208, 209, 210].map(number => `Table ${number}`));
    assert.equal(new Set(posts(f).map(row => row.id)).size, 8);
    assert.ok(posts(f).every(row => row.venueId === id(20) && row.action === "create"));
    assert.equal(saved.filter(row => row.active).length, 10);
    assert.ok(f.find(node => node.props.role === "status" && /8 QR codes created\. 2 existing codes kept\. All tables/.test(node.props.children)));
    assert.equal(f.find(node => node.type === "button" && node.props.children === "All codes already exist").props.disabled, true);
    assert.equal(f.find(node => node.type === "button" && node.props.children === "Number range").props.disabled, false);
  } finally { f.unmount(); }
});

test("bulk retries keep confirmed codes and reuse the pending table id after a failure", async () => {
  const saved = []; let fail = true;
  const f = componentFixture(async (_url, options) => {
    if (options.method !== "POST") return { venueId: id(20), links: [...saved] };
    const body = JSON.parse(options.body);
    if (body.label === "Table 202" && fail) { fail = false; throw new Error("Connection lost"); }
    const link = code({ id: body.id, label: body.label }); saved.push(link);
    return { venueId: id(20), link };
  });
  try {
    f.open(); await f.settle(); await selectRange(f, "201", "203");
    rangeForm(f).props.onSubmit({ preventDefault() {} }); await f.settle();
    assert.deepEqual(posts(f).map(row => row.label), ["Table 201", "Table 202"]);
    assert.match(f.find(node => node.props.role === "alert").props.children, /1 QR code confirmed.*Connection lost/);
    rangeForm(f).props.onSubmit({ preventDefault() {} }); await f.settle();
    assert.deepEqual(posts(f).map(row => row.label), ["Table 201", "Table 202", "Table 202", "Table 203"]);
    assert.equal(posts(f)[1].id, posts(f)[2].id);
    assert.equal(saved.length, 3);
    assert.equal(f.find(node => node.props.role === "alert"), undefined);
  } finally { f.unmount(); }
});

test("bulk retries reconcile a saved table whose response was lost without replacing its QR", async () => {
  const saved = []; let fail = true;
  const f = componentFixture(async (_url, options) => {
    if (options.method !== "POST") return { venueId: id(20), links: [...saved] };
    const body = JSON.parse(options.body), link = code({ id: body.id, label: body.label }); saved.push(link);
    if (fail) { fail = false; throw new Error("Response lost"); }
    return { venueId: id(20), link };
  });
  try {
    f.open(); await f.settle(); await selectRange(f, "201", "202");
    rangeForm(f).props.onSubmit({ preventDefault() {} }); await f.settle();
    assert.match(f.find(node => node.props.role === "alert").props.children, /^0 QR codes confirmed/);
    rangeForm(f).props.onSubmit({ preventDefault() {} }); await f.settle();
    assert.deepEqual(posts(f).map(row => row.label), ["Table 201", "Table 202"]);
    assert.equal(saved.length, 2);
    assert.ok(f.find(node => node.props.role === "status" && /1 QR code created\. 1 existing code kept/.test(node.props.children)));
  } finally { f.unmount(); }
});

test("bulk stop finishes the current table and unmount aborts before the next table", async () => {
  for (const unmount of [false, true]) {
    let resolveWrite;
    const f = componentFixture(async (_url, options) => options.method === "POST"
      ? new Promise(resolve => { resolveWrite = resolve; }) : { venueId: id(20), links: [] });
    f.open(); await f.settle(); await selectRange(f, "201", "203");
    rangeForm(f).props.onSubmit({ preventDefault() {} }); await f.settle();
    assert.equal(posts(f).length, 1);
    if (unmount) {
      f.unmount(); assert.equal(f.requests.at(-1).options.signal.aborted, true);
    } else {
      f.find(node => node.type === "button" && node.props.children === "Stop after current table").props.onClick(); f.render();
    }
    resolveWrite({ venueId: id(20), link: code({ id: posts(f)[0].id, label: "Table 201" }) });
    await f.settle();
    assert.equal(posts(f).length, 1);
    if (!unmount) {
      assert.ok(f.find(node => node.props.role === "status" && /1 QR code created\. 2 remaining/.test(node.props.children)));
      f.unmount();
    }
  }
});

test("invalid ranges and unconfirmed bulk responses never continue creating codes", async () => {
  for (const failure of ["invalid-range", "bad-read", "bad-write", "auth"]) {
    let reads = 0;
    const f = componentFixture(async (_url, options) => {
      if (options.method !== "POST") return { venueId: failure === "bad-read" && ++reads > 1 ? id(21) : id(20), links: [] };
      if (failure === "auth") throw Object.assign(new Error("Sign in again"), { status: 401 });
      return { venueId: id(20), link: code({ label: "Wrong table" }) };
    });
    try {
      f.open(); await f.settle(); await selectRange(f, failure === "invalid-range" ? "211" : "201", "203");
      rangeForm(f).props.onSubmit({ preventDefault() {} }); await f.settle();
      assert.equal(posts(f).length, ["invalid-range", "bad-read"].includes(failure) ? 0 : 1);
      if (failure === "auth") assert.equal(rangeForm(f), undefined);
      if (failure !== "invalid-range") assert.ok(f.find(node => node.props.role === "alert"));
    } finally { f.unmount(); }
  }
});
