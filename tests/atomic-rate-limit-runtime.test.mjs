import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { before, after } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db;
const key = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;");
  // Only this counter's reviewed SQL is loaded into an empty, disposable database.
  await db.exec(readFileSync(new URL("../supabase/migrations/202608300003_atomic_request_rate_limits.sql", import.meta.url), "utf8"));
});
after(async () => db?.close());
async function consume(namespace, ip = 1, subject = 2, ipLimit = 5, subjectLimit = 3) {
  const result = await db.query("select public.consume_request_rate_limit($1,$2::uuid,$3::uuid,60,$4::integer,$5::integer) as decision", [namespace, key(ip), key(subject), ipLimit, subjectLimit]);
  return result.rows[0].decision;
}
for (const role of ["anon", "authenticated"]) test(`${role} cannot execute the privileged counter or read/overwrite buckets`, async () => {
  await db.exec(`set role ${role}`);
  try {
    await assert.rejects(consume("denied"), /permission denied/);
    await assert.rejects(db.query("select * from public.request_rate_limit_buckets"), /permission denied/);
    await assert.rejects(db.query("delete from public.request_rate_limit_buckets"), /permission denied/);
  } finally { await db.exec("reset role"); }
});
test("the service role can consume without direct table grants", async () => {
  await db.exec("set role service_role");
  try { assert.equal((await consume("service")).allowed, true); }
  finally { await db.exec("reset role"); }
});
test("changing subjects does not reset the IP budget", async () => {
  const decisions = [];
  for (let i = 1; i <= 8; i++) decisions.push(await consume("ip_budget", 1, i, 5, 3));
  assert.equal(decisions.filter(d => d.allowed).length, 5);
  assert.ok(decisions.at(-1).retry_after_seconds > 0);
  assert.ok(decisions.at(-1).retry_after_seconds <= 60);
});
test("changing IP addresses does not reset the subject budget", async () => {
  const decisions = [];
  for (let i = 1; i <= 8; i++) decisions.push(await consume("subject_budget", i, 1, 5, 3));
  assert.equal(decisions.filter(d => d.allowed).length, 3);
});
test("a queued burst admits only the configured number of attempts", async () => {
  const decisions = await Promise.all(Array.from({ length: 20 }, () => consume("burst")));
  assert.equal(decisions.filter(d => d.allowed).length, 3);
  const { rows } = await db.query("select request_count from public.request_rate_limit_buckets where namespace='burst'");
  assert.deepEqual(rows.map(r => r.request_count), [20, 20]);
});
test("expired budgets reset, and denied requests do not extend an existing window", async () => {
  for (let i = 0; i < 3; i++) await consume("expiry");
  const before = (await db.query("select expires_at from public.request_rate_limit_buckets where namespace='expiry' order by key_type")).rows;
  assert.equal((await consume("expiry")).allowed, false);
  assert.deepEqual((await db.query("select expires_at from public.request_rate_limit_buckets where namespace='expiry' order by key_type")).rows, before);
  await db.exec("update public.request_rate_limit_buckets set expires_at=clock_timestamp()-interval '1 second' where namespace='expiry'");
  assert.equal((await consume("expiry")).allowed, true);
  assert.deepEqual((await db.query("select request_count from public.request_rate_limit_buckets where namespace='expiry'")).rows.map(r => r.request_count), [1, 1]);
});
test("invalid counter configuration fails without creating buckets", async () => {
  for (const values of [["bad-namespace", 60, 5], ["invalid_window", 1, 5], ["invalid_limit", 60, 0]]) {
    await assert.rejects(db.query("select public.consume_request_rate_limit($1,$2::uuid,$3::uuid,$4::integer,$5::integer,3)", [values[0], key(1), key(2), values[1], values[2]]), /Invalid request rate limit configuration/);
  }
  assert.equal((await db.query("select count(*)::integer as count from public.request_rate_limit_buckets where namespace like 'invalid%'")).rows[0].count, 0);
});
