import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { resolveApiError } from "../src/lib/api-error-policy.ts";
import { createLifecycleDatabase, seedLifecycleDatabase, lifecycleSnapshot, fixtureId } from "./helpers/redemption-lifecycle-database.mjs";

function compile(path, baseline = false) {
  const source = baseline ? execFileSync("git", ["show", "HEAD:" + path], { encoding: "utf8", windowsHide: true })
    : readFileSync(new URL("../" + path, import.meta.url), "utf8");
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
const actionExports = {};
vm.runInNewContext(compile("src/lib/dancr/deal-redemption-actions.ts", process.env.LIFECYCLE_CALLER_BASELINE === "1"), {
  exports: actionExports, Error, require: () => ({}),
});
const routeCode = compile("app/api/deals/redemptions/[token]/events/route.ts");
const token = "synthetic-token-" + "10".repeat(20);
const request = new Request("https://example.invalid/events", { headers: {
  "x-forwarded-for": "192.0.2.1, 192.0.2.2", "user-agent": "synthetic-agent", "x-dancr-device": "synthetic-device",
} });
let pg;
before(async () => { pg = await createLifecycleDatabase(); });
beforeEach(async () => { await seedLifecycleDatabase(pg); });
after(async () => { await pg?.close(); });

function nativeClient({ override, lost = false, failure } = {}) {
  const calls = [];
  return { calls, from() { assert.fail("No separate-query fallback is permitted"); },
    async rpc(name, args) {
      assert.equal(name, "record_deal_lifecycle_event_safely"); calls.push(args);
      if (failure) return { data: null, error: failure };
      if (override) return override();
      try {
        const result = (await pg.query("select public.record_deal_lifecycle_event_safely($1,$2,$3,$4,$5,$6,$7) as result", [
          args.p_token, args.p_event_type, args.p_actor_user_id, args.p_session_id, args.p_ip_address, args.p_user_agent, args.p_device_fingerprint,
        ])).rows[0].result;
        if (lost) return { data: null, error: { code: "08006", message: "private event response" } };
        return { data: result, error: null };
      } catch (error) { return { data: null, error }; }
    },
  };
}
const record = (client, event = "saved", input, value = token) => actionExports.recordDealRedemptionEvent(client, value, event, request, input);
for (const event of ["saved", "shared", "scanner_opened"]) {
  test("the application records " + event + " with one atomic call and the original audit fields", async () => {
    const client = nativeClient();
    const result = await record(client, event, { actorUserId: fixtureId(1), sessionId: fixtureId(2) });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { id: fixtureId(10), eventType: event, status: "generated" });
    assert.equal(client.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(client.calls[0])), {
      p_token: token, p_event_type: event, p_actor_user_id: fixtureId(1), p_session_id: fixtureId(2),
      p_ip_address: "192.0.2.1", p_user_agent: "synthetic-agent", p_device_fingerprint: "synthetic-device",
    });
    const events = (await lifecycleSnapshot(pg)).qr_redemption_events.filter(row => row.event_type === event);
    assert.equal(events.length, 1);
    assert.equal(events[0].actor_user_id, fixtureId(1));
    assert.equal(events[0].session_id, fixtureId(2));
  });
}
test("guest events remain supported without inventing an actor or session", async () => {
  const client = nativeClient(); await record(client);
  const event = (await lifecycleSnapshot(pg)).qr_redemption_events.find(row => row.event_type === "saved");
  assert.equal(event.actor_user_id, null); assert.equal(event.session_id, null);
  assert.equal(client.calls.length, 1);
});
test("a genuine missing token returns null and leaves data unchanged", async () => {
  const before = await lifecycleSnapshot(pg), client = nativeClient();
  assert.equal(await record(client, "saved", undefined, "not-found-" + "a".repeat(32)), null);
  assert.deepEqual(await lifecycleSnapshot(pg), before); assert.equal(client.calls.length, 1);
});
test("the application never claims success after an atomic insert rollback", async () => {
  const before = await lifecycleSnapshot(pg), client = nativeClient();
  await assert.rejects(record(client, "saved", { actorUserId: fixtureId(999) }), { code: "23503" });
  assert.deepEqual(await lifecycleSnapshot(pg), before); assert.equal(client.calls.length, 1);
});
test("a lost response after commit is not retried or followed by separate writes", async () => {
  const client = nativeClient({ lost: true });
  await assert.rejects(record(client), { code: "08006" });
  assert.equal(client.calls.length, 1);
  assert.equal((await lifecycleSnapshot(pg)).qr_redemption_events.filter(row => row.event_type === "saved").length, 1);
});
for (const code of ["57014", "42501", "PGRST202"]) {
  test("RPC failure " + code + " never falls back to the prior multi-write operation", async () => {
    const before = await lifecycleSnapshot(pg), client = nativeClient({ failure: { code, message: "private server detail" } });
    await assert.rejects(record(client), { code });
    assert.deepEqual(await lifecycleSnapshot(pg), before); assert.equal(client.calls.length, 1);
  });
}
for (const [label, data] of [
  ["undefined", undefined], ["empty object", {}], ["array", []], ["wrong id", { id: "wrong", eventType: "saved", status: "generated" }],
  ["different event", { id: fixtureId(10), eventType: "shared", status: "generated" }],
  ["missing status", { id: fixtureId(10), eventType: "saved" }],
  ["unknown status", { id: fixtureId(10), eventType: "saved", status: "approved" }],
]) {
  test("malformed acknowledgment " + label + " cannot produce a successful event", async () => {
    const client = nativeClient({ override: () => ({ data, error: null }) });
    await assert.rejects(record(client), /QR activity could not be confirmed/); assert.equal(client.calls.length, 1);
  });
}
test("the public result contains only the confirmed event fields", async () => {
  const client = nativeClient({ override: () => ({ data: { id: fixtureId(10), eventType: "saved", status: "generated", audit: "private info" }, error: null }) });
  assert.deepEqual(JSON.parse(JSON.stringify(await record(client))), { id: fixtureId(10), eventType: "saved", status: "generated" });
});

for (const [label, value, failure, status] of [
  ["success", token, null, 200], ["missing", "not-found-" + "a".repeat(32), null, 404],
  ["failure", token, { code: "57014", message: "private event error" }, 503],
]) {
  test("the actual endpoint exposes the atomic caller's " + label + " outcome safely", async () => {
    const client = nativeClient({ failure }), exports = {};
    vm.runInNewContext(routeCode, { exports, Error,
      require(name) {
        if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
        if (name.endsWith("/api")) return { apiError(error, fallback) { const resolved = resolveApiError(error, fallback); return Response.json(resolved.body, { status: resolved.status }); } };
        if (name.endsWith("deal-redemption-actions")) return actionExports;
        if (name.endsWith("bounded-json-body")) return { readBoundedJsonObject: async () => ({ eventType: "saved" }) };
        if (name.endsWith("supabase/admin")) return { createAdminSupabaseClient: () => client };
        if (name.endsWith("supabase/request")) return { getBearerToken: () => null };
        throw new Error("Unexpected dependency " + name);
      },
    });
    const response = await exports.POST(new Request("https://example.invalid/events", { method: "POST" }), { params: Promise.resolve({ token: value }) });
    const body = await response.json(); assert.equal(response.status, status); assert.equal(body.ok, status === 200);
    assert.equal(client.calls.length, 1); assert.doesNotMatch(JSON.stringify(body), /private|57014/);
    if (status === 200) assert.deepEqual(body.event, { id: fixtureId(10), eventType: "saved", status: "generated" });
  });
}
