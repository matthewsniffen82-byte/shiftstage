import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import {
  createLifecycleDatabase, seedLifecycleDatabase, lifecycleSnapshot, lifecycleMigration,
  lifecycleSignature, fixtureId,
} from "./helpers/redemption-lifecycle-database.mjs";

let pg;
before(async () => { pg = await createLifecycleDatabase(); });
beforeEach(async () => { await seedLifecycleDatabase(pg); });
after(async () => { await pg?.close(); });
const token = "synthetic-token-" + "10".repeat(20);
async function record(event = "saved", { actor = null, session = null, value = token } = {}) {
  return (await pg.query("select public.record_deal_lifecycle_event_safely($1,$2,$3,$4,$5,$6,$7) as result", [
    value, event, actor, session, "192.0.2.1", "synthetic-agent", "synthetic-device",
  ])).rows[0].result;
}
for (const [event, column] of [["saved", "saved_at"], ["shared", "shared_at"], ["scanner_opened", "first_scanned_at"]]) {
  test(event + " records its timestamp and event in one transaction without altering financial or other redemption data", async () => {
    const before = await lifecycleSnapshot(pg);
    assert.deepEqual(await record(event, { actor: fixtureId(1), session: fixtureId(2) }), { id: fixtureId(10), eventType: event, status: "generated" });
    const after = await lifecycleSnapshot(pg);
    const added = after.qr_redemption_events.filter(row => !before.qr_redemption_events.some(old => old.id === row.id));
    assert.equal(added.length, 1);
    const row = added[0];
    assert.equal(row.event_type, event);
    assert.equal(row.qr_redemption_id, fixtureId(10));
    assert.equal(row.actor_user_id, fixtureId(1));
    assert.equal(row.session_id, fixtureId(2));
    assert.equal(row.ip_address, "192.0.2.1");
    assert.equal(row.user_agent, "synthetic-agent");
    assert.deepEqual(row.audit, { device_fingerprint: "synthetic-device" });
    assert.ok(row.occurred_at instanceof Date);
    assert.deepEqual(after.qr_redemptions, before.qr_redemptions.map(parent => parent.id === fixtureId(10) ? { ...parent, [column]: row.occurred_at } : parent));
    assert.deepEqual(after.deal_revenue_events, before.deal_revenue_events);
    assert.deepEqual(after.commission_events, before.commission_events);
  });
  test(event + " preserves the first timestamp while recording distinct repeated actions", async () => {
    const initial = "2026-01-01T12:00:00.000Z";
    await pg.query("update public.qr_redemptions set " + column + "=$1 where id=$2", [initial, fixtureId(10)]);
    const before = await lifecycleSnapshot(pg);
    await Promise.all([record(event), record(event)]);
    const after = await lifecycleSnapshot(pg);
    assert.deepEqual(after.qr_redemptions, before.qr_redemptions);
    assert.equal(after.qr_redemption_events.filter(row => row.event_type === event).length, 2);
  });
  test(event + " rolls back a timestamp if its event insert fails", async () => {
    const before = await lifecycleSnapshot(pg);
    await pg.exec(`reset role;create or replace function public.synthetic_event_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic event failure';end$$;
      create trigger synthetic_event_failure before insert on public.qr_redemption_events for each row execute function public.synthetic_event_failure();set role service_role`);
    await assert.rejects(record(event), /synthetic event failure/);
    assert.deepEqual(await lifecycleSnapshot(pg), before);
  });
}
test("a failed timestamp update does not insert its event", async () => {
  const before = await lifecycleSnapshot(pg);
  await pg.exec(`reset role;create or replace function public.synthetic_timestamp_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic timestamp failure';end$$;
    create trigger synthetic_timestamp_failure before update on public.qr_redemptions for each row execute function public.synthetic_timestamp_failure();set role service_role`);
  await assert.rejects(record(), /synthetic timestamp failure/);
  assert.deepEqual(await lifecycleSnapshot(pg), before);
});
test("a missing actor reference rolls back both timestamp and event", async () => {
  const before = await lifecycleSnapshot(pg);
  await assert.rejects(record("saved", { actor: fixtureId(999) }), { code: "23503" });
  assert.deepEqual(await lifecycleSnapshot(pg), before);
});
test("a genuine missing redemption returns null without writing", async () => {
  const before = await lifecycleSnapshot(pg);
  assert.equal(await record("saved", { value: "absent-token-" + "a".repeat(32) }), null);
  assert.deepEqual(await lifecycleSnapshot(pg), before);
});
for (const event of [null, "", "venue_confirmed", "issued", "expired", "voided", "shared;update"]) {
  test("rejects unsupported event " + event + " before changing records", async () => {
    const before = await lifecycleSnapshot(pg);
    await assert.rejects(record(event), { code: "22023" });
    assert.deepEqual(await lifecycleSnapshot(pg), before);
  });
}
for (const value of [null, "short", "a".repeat(161), " ".repeat(32), "a".repeat(32) + "/"]) {
  test("rejects invalid redemption token " + String(value).slice(0, 12), async () => {
    const before = await lifecycleSnapshot(pg);
    await assert.rejects(record("saved", { value }), { code: "22023" });
    assert.deepEqual(await lifecycleSnapshot(pg), before);
  });
}
test("rejects an invalid session without storing activity", async () => {
  const before = await lifecycleSnapshot(pg);
  await assert.rejects(record("saved", { session: "invalid session" }), { code: "22023" });
  assert.deepEqual(await lifecycleSnapshot(pg), before);
});
for (const status of ["generated", "redeemed", "expired", "voided"]) {
  test("engagement preserves existing " + status + " status", async () => {
    await pg.query("update public.qr_redemptions set status=$1 where id=$2", [status, fixtureId(10)]);
    assert.equal((await record()).status, status);
    assert.equal((await pg.query("select status from public.qr_redemptions where id=$1", [fixtureId(10)])).rows[0].status, status);
  });
}
for (const role of ["anon", "authenticated"]) {
  test(role + " cannot call the server-only event function", async () => {
    const before = await lifecycleSnapshot(pg);
    await pg.exec("set role " + role);
    await assert.rejects(record("saved", { actor: fixtureId(1) }), { code: "42501" });
    await pg.exec("set role service_role");
    assert.deepEqual(await lifecycleSnapshot(pg), before);
  });
}
test("the new function uses invoker access, an empty search path, a bounded row lock and retained RLS", async () => {
  const row = (await pg.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [lifecycleSignature])).rows[0];
  assert.equal(row.prosecdef, false);
  assert.ok(row.proconfig.includes('search_path=""'));
  assert.ok(row.proconfig.includes("lock_timeout=3s"));
  assert.equal((await pg.query("select count(*)::int as n from pg_class where oid in('public.qr_redemptions'::regclass,'public.qr_redemption_events'::regclass) and relrowsecurity")).rows[0].n, 2);
});
test("the migration refuses repeat application instead of replacing an unexpected function", async () => {
  await pg.exec("reset role");
  const before = await lifecycleSnapshot(pg);
  await assert.rejects(pg.exec(lifecycleMigration), { code: "42723" });
  await pg.exec("rollback");
  assert.deepEqual(await lifecycleSnapshot(pg), before);
});
