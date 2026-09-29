import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("direct push registry protects subscriptions, caps devices and cascades receipts", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const other = "10000000-0000-4000-8000-000000000002";
  const inactive = "10000000-0000-4000-8000-000000000003";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.app_users(id uuid primary key, account_state text);
      insert into public.app_users values ('${owner}', 'active'), ('${other}', 'active'), ('${inactive}', 'suspended');`);
    await db.exec(readFileSync(new URL("../supabase/migrations/20260929070000_direct_web_push.sql", import.meta.url), "utf8"));
    const endpoint = number => "https://fcm.googleapis.com/fcm/send/fixture-" + number;
    const hash = number => createHash("sha256").update(endpoint(number)).digest("hex");
    const save = (user, number, auth = "b".repeat(22)) => db.query(
      "select public.save_web_push_subscription($1,$2,$3,$4,$5,$6) as saved",
      [user, hash(number), endpoint(number), "a".repeat(87), auth, "c".repeat(87)],
    ).then(result => result.rows[0].saved);

    for (const role of ["anon", "authenticated"]) {
      await db.exec("set role " + role);
      await assert.rejects(db.query("select * from public.web_push_subscriptions"), /permission denied/);
      await assert.rejects(db.query("select * from public.web_push_receipts"), /permission denied/);
      await assert.rejects(save(owner, 1), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    for (let number = 1; number <= 12; number++) assert.equal(await save(owner, number), true);
    assert.equal(await save(owner, 13), false, "the thirteenth device must be rejected");
    assert.equal(await save(owner, 1), true, "existing devices can re-enroll at the limit");
    await assert.rejects(save(inactive, 20), /Active account required/);
    assert.equal(await save(other, 1, "d".repeat(22)), false, "endpoint knowledge alone cannot reassign a device");
    assert.equal(await save(other, 1), true, "the device's encryption credentials permit an account switch");
    const row = await db.query("select user_id from public.web_push_subscriptions where endpoint_hash=$1", [hash(1)]);
    assert.equal(row.rows[0].user_id, other);
    await db.query("insert into public.web_push_receipts(delivery_id,endpoint_hash) values ($1,$2) on conflict do nothing", [owner, hash(1)]);
    await db.query("insert into public.web_push_receipts(delivery_id,endpoint_hash) values ($1,$2) on conflict do nothing", [owner, hash(1)]);
    assert.equal((await db.query("select count(*) from public.web_push_receipts")).rows[0].count, 1);
    await db.query("delete from public.web_push_subscriptions where endpoint_hash=$1", [hash(1)]);
    assert.equal((await db.query("select count(*) from public.web_push_receipts")).rows[0].count, 0);
    await db.exec("reset role");
    await db.query("delete from public.app_users where id=$1", [owner]);
    assert.equal((await db.query("select count(*) from public.web_push_subscriptions")).rows[0].count, 0);
  } finally { await db.close(); }
});
