import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const access = read("supabase/migrations/202609070001_supabase_access_boundaries.sql");
const additive = read("supabase/migrations/202609070002_restore_recovery_and_saved_deal_schema.sql");
test("audited access migration preserves data and closes direct sensitive paths", () => {
  assert.doesNotMatch(access + additive, /(?:delete\s+from|truncate\s|drop\s+(?:table|column))/i);
  assert.match(access, /drop policy if exists "approved dancers are public"/);
  for (const table of ["venue_activity_log", "venue_nfc_support_requests", "venue_club_deal_requests"]) {
    assert.ok(access.includes(`m.venue_id = ${table}.venue_id`));
  }
  assert.match(access, /revoke select \(real_name\)/);
  assert.match(access, /security_invoker = true/);
  assert.match(access, /revoke all on public.dancer_monthly_impact from public, anon, authenticated/);
  assert.match(access, /revoke insert, update, delete on public.shifts/);
  assert.match(access, /after update of email on auth.users/);
  assert.doesNotMatch(access, /set email = new.new_email/);
  assert.match(additive, /primary key \(customer_id, club_deal_id\)/);
  assert.match(additive, /pg_advisory_xact_lock\(least\(/);
  assert.match(additive, /pg_advisory_xact_lock\(greatest\(/);
  assert.match(additive, /':ip:'/);
  assert.match(additive, /':subject:'/);
});

test("an unowned support thread fails before any privileged write", async () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read("src/lib/dancr/support.ts"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, console, require: () => ({ deliverNotificationRows() {} }) });
  let writes = 0;
  const client = { from() {
    const query = { select() { return query; }, eq() { return query; }, in() { return query; },
      gte() { return query; }, maybeSingle: async () => ({ data: null, error: null }),
      then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); } };
    return query;
  } };
  const admin = { from() { writes++; throw new Error("Unexpected privileged write"); } };
  await assert.rejects(exports.createOwnSupportMessage(client, {
    userId: "owner", role: "customer", threadId: "someone-elses-thread", body: "Help please",
  }, admin), /Support thread not found/);
  assert.equal(writes, 0);
});
