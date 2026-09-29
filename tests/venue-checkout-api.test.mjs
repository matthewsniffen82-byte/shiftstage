import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { AsyncLocalStorage } from "node:async_hooks";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, modules = {}) {
  const exports = {};
  const source = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, TextDecoder, Uint8Array, setTimeout, clearTimeout, Error,
    require: name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; },
  });
  return exports;
}
const errorPolicy = load("../src/lib/api-error-policy.ts", { "./dancr/phone-tap-copy.ts": {}, "./dancr/payout-copy.ts": {} });
const boundedBody = load("../src/lib/bounded-json-body.ts", { "./api-error-policy.ts": errorPolicy });
const actor = "10000000-0000-4000-8000-000000000001", venue = "20000000-0000-4000-8000-000000000001", shiftId = "30000000-0000-4000-8000-000000000001";
function fixture({ authError, accessError, rpcError, receipt = { shiftId, venueId: venue, checkedOutAt: new Date().toISOString() } } = {}) {
  const calls = [], permissions = [];
  const route = load("../app/api/venue/check-ins/route.ts", {
    "next/server": { NextResponse: Response },
    "@/src/lib/api": { apiError: e => Response.json({ error: e.message }, { status: e.status || 500 }) },
    "@/src/lib/api-error-policy": errorPolicy,
    "@/src/lib/bounded-json-body": boundedBody,
    "@/src/lib/dancr/auth": { requireActiveVenueAccount: async () => { if (authError) throw authError; } },
    "@/src/lib/dancr/venue-access": { requireVenueAccess: async (_admin, user, permission) => {
      assert.equal(user, actor); permissions.push(permission); if (accessError) throw accessError; return { venueId: venue };
    } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: receipt, error: rpcError }; } }) },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => ({ client: {}, user: { id: actor } }) },
  });
  return { calls, permissions, request: body => route.DELETE(new Request("https://example.invalid/api/venue/check-ins", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })) };
}
test("retired manual checkout returns 410 and cannot mutate working status", async () => {
  const f = fixture(), response = await f.request({ shiftId, actorUserId: "forged", venueId: "forged" });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, "nfc_managed_presence");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(f.calls.length, 0);
});
test("retired checkout still requires an active venue account", async () => {
  const f = fixture({ authError: new errorPolicy.PublicApiError("FORBIDDEN", "Inactive", 403) });
  assert.equal((await f.request({ shiftId })).status, 403);
  assert.equal(f.calls.length, 0);
});
test("venue roles view the roster without manual presence permissions", async () => {
const access = load("../src/lib/dancr/venue-access.ts", { "node:async_hooks": { AsyncLocalStorage } });
  for (const role of ["owner", "manager", "staff"]) {
    const client = { from: table => {
      const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: table === "app_users" ? { id: actor, role: "venue", account_state: "active" } : table === "venues" ? (role === "owner" ? { id: venue, owner_user_id: actor } : null) : { role, status: "active", venues: { id: venue, owner_user_id: "club-owner" } } }) };
      return query;
    } };
    const result = await access.requireVenueAccess(client, actor, "view_roster");
    assert.equal(result.role, role);
    assert.equal(result.permissions.includes("end_checkins"), false);
    assert.equal(result.permissions.includes("manage_roster"), role !== "staff");
  }
});
