import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getRankingMetricBatch } from "../src/lib/dancr/ranking-metrics.ts";
import { isMissingSupabaseFunction } from "../src/lib/supabase/missing-function.ts";
import { PublicApiError } from "../src/lib/api-error-policy.ts";

let deliveryCalls = 0;
function compile(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console: { log() {}, error() {} }, require: () => ({
    isMissingSupabaseFunction, PublicApiError,
    getRankingMetricBatch,
    safeErrorMetadata: error => ({ code: error?.code || "unknown" }),
    initialDancerApprovalValues: () => ({ status: "draft", is_public: false }),
    deliverNotificationRows: async () => { deliveryCalls++; throw new Error("Delivery unavailable"); },
  }) });
  return exports;
}
const provisioning = compile("src/lib/dancr/account-provisioning.ts");
const support = compile("src/lib/dancr/support.ts");
const publication = compile("src/lib/dancr/profile-publication.ts");
const input = { userId: "user", role: "customer", email: "current@example.test", displayName: "New name", city: "New city" };
const outage = { code: "57014", message: "Statement timeout" };

test("uncertain provisioning and support RPC failures never fall back to another write", async () => {
  let writes = 0;
  const db = { rpc: async () => ({ error: outage }), from() { writes++; throw new Error("Unexpected fallback"); } };
  await assert.rejects(provisioning.provisionAppAccount(db, input), error => error === outage);
  await assert.rejects(support.createOwnSupportMessage(db, { ...input, body: "Help please" }, db), error => error === outage);
  assert.equal(writes, 0);
});

test("compatibility provisioning does not overwrite an existing account or customer city", async () => {
  const rows = { app_users: { role: "customer", display_name: "Keep my name" }, customer_profiles: { city: "Keep my city" } };
  const db = { rpc: async () => ({ error: { code: "PGRST202" } }), from(table) {
    const query = { upsert: async (value, options) => {
      assert.equal(options.ignoreDuplicates, true);
      if (!options.ignoreDuplicates) rows[table] = value;
      return { error: null };
    }, select() { return query; }, eq() { return query; }, single: async () => ({ data: rows[table], error: null }) };
    return query;
  } };
  await provisioning.provisionAppAccount(db, input);
  assert.equal(rows.app_users.display_name, "Keep my name");
  assert.equal(rows.customer_profiles.city, "Keep my city");
});

test("successful atomic support writes survive notification failure without another database read", async () => {
  const thread = { id: "thread", user_id: "user", user_role: "customer", support_messages: [] };
  const client = { from() { throw new Error("Unexpected post-write read"); } };
  const admin = { rpc: async () => ({ data: { thread, duplicate: false, notifications: [{ recipient_id: "user" }] }, error: null }), from() { throw new Error("Unexpected notification insert"); } };
  assert.equal((await support.createOwnSupportMessage(client, { ...input, body: "Help please" }, admin)).id, "thread");
  assert.equal(deliveryCalls, 1);
  admin.rpc = async () => ({ data: { thread, duplicate: true }, error: null });
  assert.equal((await support.createOwnSupportMessage(client, { ...input, body: "Help please" }, admin)).id, "thread");
  assert.equal(deliveryCalls, 1);
});

test("publication authorization and concurrent edits fail safely", async () => {
  await assert.rejects(publication.transitionDancerPublication({ rpc: async () => ({ error: { code: "42501" } }) }, "dancer", "set_public", { actorUserId: "other" }), error => error.status === 403);
  const profile = { id: "dancer", user_id: "user", status: "approved", verification_status: "approved", approved_at: "approved", venue_approved_at: "approved", updated_at: "old-version" };
  const guards = [];
  const db = { rpc: async () => ({ error: { code: "PGRST202" } }), from(table) {
    let writing = false;
    const query = { select() { return query; }, update() { writing = true; return query; }, eq(field, value) { if (writing) guards.push([field, value]); return query; },
      maybeSingle: async () => ({ data: writing ? null : table === "dancer_profiles" ? profile : { id: "user", role: "dancer", account_state: "active" }, error: null }) };
    return query;
  } };
  await assert.rejects(publication.transitionDancerPublication(db, "dancer", "set_private", { actorUserId: "user" }), error => error.status === 409);
  assert.ok(guards.some(([field, value]) => field === "updated_at" && value === "old-version"));
});

const metrics = { profileViews: 1, scheduleViews: 2, followers: 3, favorites: 4, directionRequests: 5, goingSignals: 6, notificationOpens: 7, socialClicks: 8 };
test("ranking reads use bounded complete batches and reject outages or missing results", async () => {
  let calls = 0, legacy = 0;
  const ids = Array.from({ length: 401 }, (_, index) => String(index));
  const db = { rpc: async (_name, args) => { calls++; assert.ok(args.p_dancer_ids.length <= 200); return { data: args.p_dancer_ids.map(id => ({ dancer_id: id, metrics })), error: null }; } };
  const result = await getRankingMetricBatch(db, ids, new Date(), async () => { legacy++; return metrics; });
  assert.equal(result.size, 401); assert.equal(calls, 3); assert.equal(legacy, 0);
  await assert.rejects(getRankingMetricBatch({ rpc: async () => ({ error: outage }) }, ["one"], new Date(), async () => { legacy++; return metrics; }), error => error === outage);
  await assert.rejects(getRankingMetricBatch({ rpc: async () => ({ data: [], error: null }) }, ["one"], new Date(), async () => metrics), /incomplete/);
  assert.equal(legacy, 0);
});

test("older-schema ranking fallback has bounded concurrency", async () => {
  let active = 0, peak = 0;
  const result = await getRankingMetricBatch({ rpc: async () => ({ error: { code: "PGRST202" } }) }, ["a", "b", "c", "d", "e"], new Date(), async () => {
    active++; peak = Math.max(active, peak); await Promise.resolve(); active--; return metrics;
  });
  assert.equal(result.size, 5); assert.equal(peak, 2);
});

test("committed rankings remain successful when notification and audit writes fail", async () => {
  const admin = compile("src/lib/dancr/admin.ts");
  let saved = false;
  const dancer = { id: "dancer", user_id: "user", stage_name: "Dancer", city: "City", trending_scores: { rank: 5 } };
  const db = { rpc: async () => ({ data: [{ dancer_id: "dancer", metrics }], error: null }), from(table) {
    const query = { select() { return query; }, eq() { return query; }, order() { return query; },
      range: async () => ({ data: [dancer], error: null }),
      upsert: async () => { assert.equal(table, "trending_scores"); saved = true; return { error: null }; },
      insert: async () => { throw outage; },
    };
    return query;
  } };
  const result = await admin.recalculateCityRankings(db, "admin", "City");
  assert.equal(saved, true);
  assert.equal(result.rankings.length, 1);
  assert.equal(result.warnings.length, 2);
});
