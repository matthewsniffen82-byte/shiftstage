import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = file => ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ configured = true, error = false } = {}) {
  const filters = [], delivered = [], warnings = [], exports = {};
  const row = { id: "notice-uuid", recipient_id: "database-recipient", notification_type: "support_message", title: "New pickup message", body: "Open your private conversation", payload: { kind: "club_pickup", pickupRequestId: "pickup-one" } };
  const query = { select() { return this; }, eq(...args) { filters.push(args); return this; }, gte(...args) { filters.push(args); return this; }, order() { return this; },
    limit: async value => { assert.equal(value, 100); return { data: [row], error: error ? new Error("Database unavailable") : null }; } };
  const client = { from: table => { assert.equal(table, "notifications"); return query; } };
  vm.runInNewContext(compile("src/lib/dancr/pickup-push-delivery.ts"), { exports,
    process: { env: configured ? { NEXT_PUBLIC_ONESIGNAL_APP_ID: "synthetic", ONESIGNAL_REST_API_KEY: "synthetic" } : {} },
    console: { warn: message => warnings.push(message) }, require(name) {
      if (name.endsWith("/admin")) return { createAdminSupabaseClient: () => client };
      if (name === "./notification-delivery") return { deliverNotificationRows: async (received, rows, options) => {
        assert.equal(received, client); delivered.push({ rows, options });
      } };
      return {};
    },
  });
  return { ...exports, filters, delivered, warnings };
}
test("pickup delivery uses only scoped database notices, stable provider IDs and the existing preference gate", async () => {
  const f = fixture(); await f.deliverPickupPush("pickup-one", "2026-09-15T12:00:00Z");
  assert.deepEqual(f.filters, [["channel", "in_app"], ["payload->>kind", "club_pickup"], ["payload->>pickupRequestId", "pickup-one"], ["created_at", "2026-09-15T12:00:00Z"]]);
  assert.equal(f.delivered[0].rows[0].deliveryId, "notice-uuid");
  assert.equal(f.delivered[0].rows[0].recipient_id, "database-recipient");
  assert.equal(f.delivered[0].options.email, false);
});
test("missing provider configuration performs no service reads or delivery", async () => {
  const f = fixture({ configured: false }); await f.deliverPickupPush("pickup-one", "now");
  assert.equal(f.filters.length, 0); assert.equal(f.delivered.length, 0);
});
test("provider work cannot fail an already committed pickup action", async () => {
  const f = fixture({ error: true }); await f.deliverPickupPush("pickup-one", "now");
  assert.equal(f.delivered.length, 0); assert.deepEqual(f.warnings, ["PICKUP_PUSH_DELIVERY_UNAVAILABLE"]);
});

test("pickup routes schedule delivery only after an authorized successful mutation, including guest requests", async () => {
  for (const guest of [false, true]) for (const fails of [false, true]) for (const detail of [false, true]) {
    const events = [], jobs = [], exports = {};
    const operation = async () => { events.push("authorized-mutation"); if (fails) throw new Error("Denied"); return "pickup-one"; };
    vm.runInNewContext(compile(detail ? "app/api/pickups/[requestId]/route.ts" : "app/api/pickups/route.ts"), { exports, URL, Date,
      require(name) {
        if (name === "next/server") return { NextResponse: { json: Response.json }, after: fn => { events.push("schedule"); jobs.push(fn); } };
        if (name.endsWith("/api")) return { apiError: () => Response.json({ ok: false }, { status: 403 }) };
        if (name.endsWith("/bounded-json-body")) return { readBoundedJsonObject: async () => ({ action: "message" }) };
        if (name.endsWith("/supabase/request")) return { createRequestSupabaseContext: async () => ({ client: {}, user: { id: "caller" } }) };
        if (name.endsWith("/pickup-validation")) return { pickupCreateArgs: () => ({}), pickupCommand: () => ({ name: "pickup_send_message", args: { p_id: "pickup-one" } }) };
        if (name.endsWith("/pickup-server")) return { pickupRpc: operation };
        if (name.endsWith("/pickup-guest-server")) return { createGuestPickup: operation, commandGuestPickup: operation };
        if (name.endsWith("/pickup-push-delivery")) return { deliverPickupPush: async id => { assert.equal(id, "pickup-one"); events.push("deliver"); } };
        return {};
      },
    });
    const response = await exports.POST(new Request("https://example.test/api/pickups", { method: "POST", headers: guest ? { "x-pickup-guest-key": "synthetic" } : { authorization: "Bearer synthetic" } }), { params: Promise.resolve({ requestId: "pickup-one" }) });
    assert.equal(response.status, fails ? 403 : 200);
    assert.deepEqual(events, fails ? ["authorized-mutation"] : ["authorized-mutation", "schedule"]);
    for (const job of jobs) await job();
    assert.equal(events.includes("deliver"), !fails);
  }
});
