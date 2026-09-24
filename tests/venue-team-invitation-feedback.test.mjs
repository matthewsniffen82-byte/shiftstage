import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function compile(source, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports, Error, URL, Date, AbortController,
    console: { warn() {}, error() {} },
    require: name => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; },
  });
  return exports;
}
const policy = compile(read("../src/lib/api-error-policy.ts"), {
  "./dancr/phone-tap-copy.ts": { phoneTapCopy: value => value },
  "./dancr/payout-copy.ts": { payoutCopy: value => value },
});
const serviceSource = read("../src/lib/dancr/venue-team.ts");
const routeSource = read("../app/api/venue/team/route.ts");
function fixture({ account = null, member = null, authorized = true, delivery = { delivered: true }, deliveryThrows = false, databaseError = null } = {}) {
  const writes = [], emails = [], permissions = [];
  const client = { from(table) {
    let operation = "read", payload, owner = false;
    const result = () => {
      if (operation !== "read") writes.push({ table, operation, payload });
      if (databaseError) return { error: databaseError };
      if (table === "app_users") return { data: owner ? { email: "owner@example.invalid" } : account };
      if (table === "venue_team_members") return { data: member };
      if (table === "venue_team_invitations" && operation === "insert") return { data: { id: "invitation", ...payload, created_at: new Date().toISOString() } };
      return { data: null };
    };
    const query = {
      select: () => query, ilike: () => query, is: () => query, limit: () => query,
      eq: (column) => { if (table === "app_users" && column === "id") owner = true; return query; },
      insert: value => { operation = "insert"; payload = value; return query; },
      update: value => { operation = "update"; payload = value; return query; },
      maybeSingle: async () => result(), single: async () => result(),
      then: resolve => Promise.resolve(result()).then(resolve),
    };
    return query;
  } };
  const service = compile(serviceSource, {
    "node:crypto": crypto,
    "../api-error-policy": policy,
    "../security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
    "./venue-access": { requireVenueAccess: async (_client, actor, permission) => {
      permissions.push({ actor, permission });
      if (!authorized) throw new policy.PublicApiError("FORBIDDEN", "Your venue team role does not allow this action.", 403);
      return { venueId: "club", venueName: "Synthetic Club", role: "owner" };
    } },
  });
  const route = compile(routeSource, {
    "next/server": { NextResponse: Response },
    "@/src/lib/api": { apiError: (error, fallback, status) => {
      const result = policy.resolveApiError(error, fallback, status);
      return Response.json(result.body, { status: result.status });
    } },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: request => request.json() },
    "@/src/lib/dancr/notification-delivery": { sendTransactionalEmail: async input => {
      emails.push(input); if (deliveryThrows) throw new Error("private delivery details"); return delivery;
    } },
    "@/src/lib/dancr/public-app-url": { publicAppUrl: () => "https://www.mydancr.com" },
    "@/src/lib/dancr/venue-team": service,
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => client },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => ({ user: { id: "authenticated-owner" } }) },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
  });
  return { writes, emails, permissions, post: (email = "NewMember@example.invalid") => route.POST(new Request("https://www.mydancr.com/api/venue/team", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role: "staff", actorUserId: "forged" }),
  })) };
}

for (const role of ["dancer", "customer", "admin"]) test(`an existing ${role} account gets an actionable conflict before creating an invitation or sending email`, async () => {
  const f = fixture({ account: { id: "recipient", role, account_state: "active" } });
  const response = await f.post(), body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "CONFLICT");
  assert.match(body.error, /Use a different email for venue team access/);
  assert.equal(body.invitationUrl, undefined);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.emails, []);
});

test("inactive accounts, owner addresses, and existing members get useful errors without email", async () => {
  for (const [options, email, expected] of [
    [{ account: { role: "venue", account_state: "disabled" } }, undefined, /not active/],
    [{}, "OWNER@example.invalid", /already has full access/],
    [{ account: { role: "venue", account_state: "active" }, member: { status: "active", venue_id: "club" } }, undefined, /already has venue team access/],
    [{ account: { role: "venue", account_state: "active" }, member: { status: "active", venue_id: "other", venues: { name: "Private club name" } } }, undefined, /another venue team/],
  ]) {
    const f = fixture(options), response = await f.post(email), body = await response.json();
    assert.equal(response.status, 409); assert.match(body.error, expected);
    assert.doesNotMatch(body.error, /Private club name/);
    assert.equal(f.writes.length, 0); assert.equal(f.emails.length, 0);
  }
});

test("the invite route preserves authorization and keeps unexpected database details private", async () => {
  for (const [options, status] of [[{ authorized: false }, 403], [{ databaseError: new Error("private database details") }, 400]]) {
    const f = fixture(options), response = await f.post(), body = await response.json();
    assert.equal(response.status, status); assert.doesNotMatch(body.error, /private database details/);
    assert.deepEqual(f.permissions, [{ actor: "authenticated-owner", permission: "manage_team" }]);
    assert.equal(f.writes.length, 0); assert.equal(f.emails.length, 0);
  }
});

test("a new team email is normalized, invited once, and reported sent only when the provider accepts it", async () => {
  const f = fixture(), response = await f.post(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.emailDelivered, true);
  assert.equal(body.message, "Invitation sent.");
  assert.equal(f.emails.length, 1); assert.equal(f.emails[0].to, "newmember@example.invalid");
  const inserts = f.writes.filter(row => row.table === "venue_team_invitations" && row.operation === "insert");
  assert.equal(inserts.length, 1); assert.equal(inserts[0].payload.role, "staff");
  const token = new URL(body.invitationUrl).pathname.split("/").at(-1);
  assert.equal(inserts[0].payload.token_digest, crypto.createHash("sha256").update(token).digest("hex"));
  assert.equal(inserts[0].payload.token, undefined);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

for (const options of [{ delivery: { delivered: false, reason: "email_not_configured" } }, { delivery: { delivered: false, reason: "provider_rejected" } }, { deliveryThrows: true }]) test(`failed email delivery preserves the invitation and provides an honest recovery link: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options), response = await f.post(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.emailDelivered, false);
  assert.match(body.message, /email could not be sent/);
  assert.match(body.invitationUrl, /^https:\/\/www\.mydancr\.com\/venue-team\/invite\/vti_/);
  assert.doesNotMatch(body.message, /Invitation sent|delayed|private delivery/);
  assert.equal(f.emails.length, 1);
});
