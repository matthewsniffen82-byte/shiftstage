import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { createNfcDatabase, seedNfcDatabase, nfcSnapshot, fixtureId, requestNfcSupport } from "./helpers/nfc-support-database.mjs";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const actions = {};
vm.runInNewContext(compile(source("src/lib/dancr/nfc-support.ts")), { exports: actions, Error, require: () => ({ PublicApiError }) });
const routePath = "app/api/venue/nfc-support/route.ts";
const routeCode = compile(process.env.NFC_CALLER_BASELINE === "1" ? execFileSync("git", ["show", "HEAD:" + routePath], { encoding: "utf8", windowsHide: true }) : source(routePath));
const supportCode = compile(source("src/lib/dancr/support.ts"));
let pg;
before(async () => { pg = await createNfcDatabase(); });
beforeEach(async () => { await seedNfcDatabase(pg); });
after(async () => { await pg?.close(); });
const input = { userId: fixtureId(1), venueId: fixtureId(10), tagId: fixtureId(20), requestType: "damaged", notes: "Synthetic details", requestId: fixtureId(100) };

function nativeClient(options = {}) {
  const calls = [], reads = [];
  return { calls, reads,
    from(table) {
      assert.equal(table, "nfc_tags", "No separate request/message write or compensating deletion is permitted");
      const filters = {};
      const query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; }, async maybeSingle() {
        reads.push(filters);
        if (options.tagFailure) return { data: null, error: options.tagFailure };
        const rows = (await pg.query("select id,label,tag_type from public.nfc_tags where id=$1 and venue_id=$2", [filters.id, filters.venue_id])).rows;
        return { data: rows[0] || null, error: null };
      } };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "create_venue_nfc_support_safely"); calls.push(args);
      if (options.failure) return { data: null, error: options.failure };
      if (options.override) return options.override();
      try {
        const data = await requestNfcSupport(pg, { user: args.p_user_id, venue: args.p_venue_id, tag: args.p_tag_id, type: args.p_request_type, notes: args.p_notes, id: args.p_request_id });
        if (options.lost) { options.lost = false; return { data: null, error: { code: "08006", message: "private response data" } }; }
        return { data, error: null };
      } catch (error) { return { data: null, error }; }
    },
  };
}
function endpoint(client, options = {}) {
  const exports = {}, support = {}, delivery = [], activity = [], logs = [];
  const dependencies = name => {
    if (name.endsWith("notification-delivery")) return { deliverNotificationRows: async (_client, rows) => { delivery.push(rows); if (options.deliveryFailure) throw new Error("private delivery failure"); } };
    if (name.endsWith("api-error-policy")) return { PublicApiError };
    return {};
  };
  vm.runInNewContext(supportCode, { exports: support, Error, console: { error: (...args) => logs.push(args) }, require: dependencies });
  vm.runInNewContext(routeCode, { exports, Error, console: { error: (...args) => logs.push(args) },
    require(name) {
      if (name === "node:crypto") return { randomUUID: () => fixtureId(101) };
      if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      if (name.endsWith("/api")) return { apiError(error, fallback, status) { const resolved = resolveApiError(error, fallback, status); return Response.json(resolved.body, { status: resolved.status }); } };
      if (name.endsWith("/nfc-support")) return actions;
      if (name.endsWith("/support")) return support;
      if (name.endsWith("bounded-json-body")) return { readBoundedJsonObject: request => request.json() };
      if (name.endsWith("venue-access")) return { requireVenueAccess: async (_client, id, permission) => {
        assert.equal(id, fixtureId(1)); assert.equal(permission, "request_nfc_support");
        if (options.accessFailure) throw options.accessFailure;
        return { venueId: fixtureId(10), venueName: "Synthetic venue", role: "owner" };
      } };
      if (name.endsWith("venue-team")) return { recordVenueActivity: async (_client, value) => { activity.push(value); if (options.activityFailure) throw new Error("private activity data"); return true; } };
      if (name.endsWith("supabase/admin")) return { createAdminSupabaseClient: () => client };
      if (name.endsWith("supabase/request")) return { createRequestSupabaseContext: async () => {
        if (options.authFailure) throw options.authFailure;
        return { user: { id: fixtureId(1) }, client, session: { accessToken: "synthetic rotated session" } };
      } };
      throw new Error("Unexpected dependency " + name);
    },
  });
  return { delivery, activity, logs, async post(body = { tagId: input.tagId, requestType: input.requestType, notes: input.notes, requestId: input.requestId }) {
    const response = await exports.POST(new Request("https://example.invalid/nfc-support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { response, body: await response.json() };
  } };
}
test("the actual endpoint returns only a confirmed request, session and safe message", async () => {
  const client = nativeClient(), route = endpoint(client);
  const { response, body } = await route.post();
  assert.equal(response.status, 200); assert.equal(body.ok, true);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(Object.keys(body.supportRequest).sort(), ["id", "nfc_tag_id", "request_type", "notes", "status", "created_at"].sort());
  assert.equal(body.supportRequest.id, input.requestId);
  assert.equal(body.session.accessToken, "synthetic rotated session");
  assert.equal(client.calls.length, 1); assert.equal(route.activity.length, 1); assert.equal(route.delivery.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(client.calls[0])), { p_user_id: input.userId, p_venue_id: input.venueId, p_tag_id: input.tagId, p_request_type: input.requestType, p_notes: input.notes, p_request_id: input.requestId });
  assert.equal((await nfcSnapshot(pg)).support_messages.length, 1);
});
test("a response lost after commit is safely recovered by a same-key endpoint retry", async () => {
  const client = nativeClient({ lost: true }), route = endpoint(client);
  const first = await route.post();
  assert.equal(first.response.status, 503); assert.equal(first.body.ok, false);
  assert.doesNotMatch(JSON.stringify(first.body), /private/);
  const committed = await nfcSnapshot(pg);
  assert.equal(committed.venue_nfc_support_requests.length, 1); assert.equal(committed.support_messages.length, 1);
  assert.equal((await route.post()).body.ok, true);
  assert.deepEqual(await nfcSnapshot(pg), committed);
  assert.equal(client.calls.length, 2); assert.equal(route.delivery.length, 0); assert.equal(route.activity.length, 0);
});
test("an ordinary completed duplicate does not repeat optional delivery or activity", async () => {
  const route = endpoint(nativeClient());
  assert.equal((await route.post()).body.ok, true);
  assert.equal((await route.post()).body.ok, true);
  assert.equal(route.delivery.length, 1); assert.equal(route.activity.length, 1);
});
for (const option of ["deliveryFailure", "activityFailure"]) {
  test(option + " does not turn a committed request into a failed response", async () => {
    const route = endpoint(nativeClient(), { [option]: true });
    assert.equal((await route.post()).body.ok, true);
    assert.equal((await nfcSnapshot(pg)).venue_nfc_support_requests.length, 1);
    assert.equal(route.logs.length, 1); assert.doesNotMatch(JSON.stringify(route.logs), /private/);
  });
}
for (const [code, status] of [["42501", 403], ["P0002", 404], ["22023", 409], ["P0001", 429], ["40001", 503], ["40P01", 503], ["55P03", 503], ["PGRST202", 503], ["57014", 503], ["XX000", 500]]) {
  test("RPC " + code + " fails safely without retries or separate writes", async () => {
    const before = await nfcSnapshot(pg), client = nativeClient({ failure: { code, message: "private database message" } }), route = endpoint(client);
    const result = await route.post();
    assert.equal(result.response.status, status); assert.equal(result.body.ok, false);
    assert.doesNotMatch(JSON.stringify(result.body), /private/); assert.equal(client.calls.length, 1);
    assert.equal(route.delivery.length, 0); assert.equal(route.activity.length, 0);
    assert.deepEqual(await nfcSnapshot(pg), before);
  });
}
test("a real SQL failure rolls back the request before the endpoint responds", async () => {
  await pg.exec("reset role;create or replace function public.synthetic_failure() returns trigger language plpgsql as $$begin raise exception 'private message failure';end$$;create trigger synthetic_failure before insert on public.support_messages for each row execute function public.synthetic_failure();set role service_role");
  const before = await nfcSnapshot(pg), route = endpoint(nativeClient());
  const result = await route.post();
  assert.equal(result.body.ok, false); assert.doesNotMatch(JSON.stringify(result.body), /private/);
  assert.deepEqual(await nfcSnapshot(pg), before);
});
for (const [name, transform] of [
  ["null", () => null], ["empty", () => ({})], ["other request", row => ({ ...row, request: { ...row.request, id: fixtureId(999) } })],
  ...["venue_id", "requested_by_user_id", "nfc_tag_id"].map(field => [field, row => ({ ...row, request: { ...row.request, [field]: fixtureId(999) } })]),
  ["type", row => ({ ...row, request: { ...row.request, request_type: "lost" } })],
  ["notes", row => ({ ...row, request: { ...row.request, notes: "wrong notes" } })],
  ["status", row => ({ ...row, request: { ...row.request, status: "approved" } })],
  ["timestamp", row => ({ ...row, request: { ...row.request, created_at: "invalid" } })],
  ["thread", row => ({ ...row, threadId: "invalid" })], ["duplicate", row => ({ ...row, duplicate: undefined })],
  ["notifications", row => ({ ...row, notifications: undefined })],
]) {
  test("malformed acknowledgment " + name + " is not exposed as success", async () => {
    const valid = await requestNfcSupport(pg), before = await nfcSnapshot(pg);
    const client = nativeClient({ override: () => ({ data: transform(valid), error: null }) }), route = endpoint(client);
    assert.equal((await route.post()).response.status, 503);
    assert.equal(route.delivery.length, 0); assert.equal(route.activity.length, 0);
    assert.deepEqual(await nfcSnapshot(pg), before);
  });
}
for (const requestId of [null, "", "invalid", 12, {}, []]) {
  test("invalid client request ID " + JSON.stringify(requestId) + " is rejected before database access", async () => {
    const client = nativeClient(), route = endpoint(client);
    assert.equal((await route.post({ tagId: input.tagId, requestType: "damaged", notes: "", requestId })).response.status, 400);
    assert.equal(client.calls.length, 0); assert.equal(client.reads.length, 0);
  });
}
test("legacy clients without a request ID receive a generated identifier", async () => {
  const client = nativeClient(), route = endpoint(client);
  const result = await route.post({ tagId: input.tagId, requestType: "damaged", notes: "" });
  assert.equal(result.response.status, 200); assert.equal(result.body.supportRequest.id, fixtureId(101));
});
for (const [key, failure, status] of [["authFailure", new Error("Sign in required."), 401], ["accessFailure", new Error("Your venue team role does not allow this action."), 403], ["tagFailure", { code: "57014", message: "private tag query" }, 503]]) {
  test(key + " prevents request creation", async () => {
    const client = nativeClient({ [key]: failure }), route = endpoint(client, { [key]: failure });
    assert.equal((await route.post()).response.status, status); assert.equal(client.calls.length, 0);
  });
}

const panelSource = source("app/dashboard/VenueNfcTagPanel.tsx");
const ast = ts.createSourceFile("panel.tsx", panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "sendSupportRequest") handler = node.getText(ast); ts.forEachChild(node, visit); }
visit(ast); assert.ok(handler);
function formHarness(responder) {
  let nextId = 199;
  const calls = [], state = { canRequestSupport: true, supportTagId: input.tagId, supportType: "damaged", supportNotes: "Synthetic details",
    mountedRef: { current: true }, savingRef: { current: false }, supportSubmissionRef: { current: null }, actionSequenceRef: { current: 0 },
    actionAbortRef: { current: null }, loadSequenceRef: { current: 0 }, loadAbortRef: { current: null }, loadInFlightRef: { current: null },
    readDashboardAccessToken: () => "synthetic token", setStatus: value => { state.status = value; }, setIsLoading() {}, setIsSaving() {},
    setSupportTagId: value => { state.supportTagId = value; }, setSupportNotes: value => { state.supportNotes = value; },
    crypto: { randomUUID: () => fixtureId(++nextId) }, AbortController, Error,
    async requestVenueNfcSupportJson(options) { const body = JSON.parse(options.body); calls.push(body); return responder(body, calls.length); },
  };
  vm.createContext(state); vm.runInContext(compile(handler + "\nglobalThis.send = sendSupportRequest;"), state);
  return { state, calls, send: () => state.send() };
}
test("form keeps fields and UUID after failure, then clears them only after confirmed success", async () => {
  const form = formHarness((body, n) => { if (n === 1) throw new Error("Temporary failure"); return { supportRequest: { id: body.requestId } }; });
  await form.send(); assert.equal(form.state.supportNotes, input.notes); assert.equal(form.state.savingRef.current, false);
  await form.send(); assert.equal(form.calls[0].requestId, form.calls[1].requestId);
  assert.equal(form.state.supportNotes, ""); assert.equal(form.state.supportTagId, ""); assert.equal(form.state.supportSubmissionRef.current, null);
});
test("changed submission content gets a new UUID after failure", async () => {
  const form = formHarness(() => { throw new Error("Temporary failure"); });
  await form.send(); form.state.supportNotes = "New details"; await form.send();
  assert.notEqual(form.calls[0].requestId, form.calls[1].requestId);
});
test("double submit while the first call is pending is ignored synchronously", async () => {
  let complete;
  const form = formHarness(body => new Promise(resolve => { complete = () => resolve({ supportRequest: { id: body.requestId } }); }));
  const first = form.send(); await form.send(); assert.equal(form.calls.length, 1);
  complete(); await first; assert.equal(form.state.savingRef.current, false);
});
test("an unconfirmed form response preserves fields and identity for retry", async () => {
  const form = formHarness(() => ({ supportRequest: { id: fixtureId(999) } }));
  await form.send(); assert.equal(form.state.supportNotes, input.notes); assert.ok(form.state.supportSubmissionRef.current);
  assert.match(form.state.status, /could not be confirmed/);
});
test("form cannot submit without support permission", async () => {
  const form = formHarness(() => assert.fail("No submission expected")); form.state.canRequestSupport = false;
  await form.send(); assert.equal(form.calls.length, 0);
});
