import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const id = n => `97000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = readFileSync(new URL("../supabase/migrations/20261007180000_private_venue_vip.sql", import.meta.url), "utf8");
const digest = "a".repeat(64);
async function fixture() {
  const db = new PGlite();
  try {
    // Dependency projections contain only columns used by the VIP boundary.
    // All VIP tables, constraints, grants and functions use the actual migration.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table public.app_users(id uuid primary key,role text,account_state text);
      create table public.venues(id uuid primary key,owner_user_id uuid,name text,is_active boolean,timezone text);
      create table public.venue_team_members(venue_id uuid,user_id uuid,role text,status text);
      create table public.dancer_profiles(id uuid primary key,user_id uuid,stage_name text,status text,verification_status text,disabled_at timestamptz);
      create table public.venue_dancer_affiliations(venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz,reentry_blocked boolean default false);
      create table public.shifts(dancer_id uuid,venue_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
      create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb,sent_at timestamptz);
      grant usage on schema public to anon,authenticated,service_role;`);
    await db.exec(migration);
    for (const [n, role] of [[1, "venue"], [2, "venue"], [3, "venue"], [4, "venue"], [5, "customer"], [6, "customer"], [7, "dancer"], [8, "dancer"], [9, "dancer"], [10, "customer"]]) {
      await db.query("insert into public.app_users values($1,$2,'active')", [id(n), role]);
      await db.query("insert into auth.users values($1,$2,now())", [id(n), `person${n}@example.test`]);
    }
    await db.query("insert into public.venues values($1,$2,'Private club',true,'America/Los_Angeles'),($3,$4,'Other club',true,'America/New_York')", [id(20), id(1), id(21), id(4)]);
    await db.query("insert into public.venue_team_members values($1,$2,'manager','active'),($1,$3,'staff','active')", [id(20), id(2), id(3)]);
    for (const n of [7, 8, 9]) {
      await db.query("insert into public.dancer_profiles values($1,$2,$3,'approved','approved',null)", [id(n + 30), id(n), `Dancer ${n}`]);
    }
    await db.query("insert into public.venue_dancer_affiliations(venue_id,dancer_id,status) values($1,$2,'active'),($3,$4,'active')", [id(20), id(37), id(21), id(39)]);
    await db.query("insert into public.shifts values($1,$2,'posted',now(),null,'club_confirmed',now()+interval '2 hours')", [id(38), id(20)]);
    await db.exec("set role service_role");
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function manage(db, action, data, actor = 1, venue = 20) {
  return (await db.query("select public.vip_manage($1,$2,$3,$4) result", [id(actor), id(venue), action, JSON.stringify(data)])).rows[0].result;
}
async function invite(db, email = "person5@example.test", token = digest) { return manage(db, "invite", { email, digest: token }); }
async function accept(db, actor = 5, token = digest) {
  return (await db.query("select public.vip_accept_invitation($1,$2,'Test VIP') venue", [id(actor), token])).rows[0].venue;
}
async function submit(db, { actor = 5, venue = 20, request = 90, dancers = [37, 38], local = "2099-01-01T20:30", notes = "Window table please" } = {}) {
  if (local === "2099-01-01T20:30") local = (await db.query("select to_char((now()+interval '2 days') at time zone 'America/Los_Angeles','YYYY-MM-DD') || 'T20:30' value")).rows[0].value;
  return (await db.query("select public.vip_submit_request($1,$2,$3,$4,$5,$6) result", [id(actor), id(venue), id(request), local, dancers.map(id), notes])).rows[0].result;
}
async function adminQuery(db, sql, params = []) {
  await db.exec("reset role");
  try { return await db.query(sql, params); } finally { await db.exec("set role service_role"); }
}
const denies = (promise, code) => assert.rejects(promise, error => error.code === code);

test("VIP tables and RPCs deny direct anonymous and authenticated access", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const table of ["venue_vip_invitations", "venue_vip_members", "venue_vip_requests"]) {
        await denies(db.query(`select * from public.${table}`), "42501");
        await denies(db.query(`delete from public.${table}`), "42501");
      }
      await denies(db.query("select public.vip_eligible_dancers($1)", [id(20)]), "42501");
      await denies(db.query("select public.vip_accept_invitation($1,$2,'VIP')", [id(5), digest]), "42501");
    }
    const tables = await adminQuery(db, "select relrowsecurity from pg_class where relname in ('venue_vip_invitations','venue_vip_members','venue_vip_requests')");
    assert.equal(tables.rows.length, 3); assert.ok(tables.rows.every(table => table.relrowsecurity));
  } finally { await db.close(); }
});

test("invitations enforce manager scope, confirmed email, expiry, one-time use and revocation", async () => {
  const db = await fixture();
  try {
    await denies(invite(db).then(async result => { await manage(db, "revoke_invitation", { id: result.id }, 3); }), "42501");
    await denies(manage(db, "invite", { email: "person5@example.test", digest }, 4), "42501");
    await denies(accept(db, 6), "P0002");
    await adminQuery(db, "update auth.users set email_confirmed_at=null where id=$1", [id(5)]);
    await denies(accept(db), "42501");
    await adminQuery(db, "update auth.users set email_confirmed_at=now() where id=$1", [id(5)]);
    assert.equal(await accept(db), id(20));
    assert.equal(await accept(db), id(20), "same-account acceptance retries are safe");
    const member = (await adminQuery(db, "select id from public.venue_vip_members")).rows[0];
    await manage(db, "revoke_member", { id: member.id });
    await denies(accept(db), "P0002");
    await invite(db, "person5@example.test", "b".repeat(64));
    await adminQuery(db, "update public.venue_vip_invitations set expires_at=now()-interval '1 minute' where token_digest=$1", ["b".repeat(64)]);
    await denies(accept(db, 5, "b".repeat(64)), "P0002");
    const newer = await invite(db, "person5@example.test", "c".repeat(64));
    await manage(db, "revoke_invitation", newer, 2);
    await denies(accept(db, 5, "c".repeat(64)), "P0002");
    await invite(db, "person1@example.test", "d".repeat(64));
    await denies(accept(db, 1, "d".repeat(64)), "42501");
  } finally { await db.close(); }
});

test("VIP roster includes off-shift affiliations and current workers, and submissions recheck eligibility", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    const roster = (await db.query("select * from public.vip_eligible_dancers($1)", [id(20)])).rows;
    assert.deepEqual(roster.map(row => [row.id, row.working_now]), [[id(37), false], [id(38), true]]);
    await denies(submit(db, { dancers: [39] }), "40001");
    await denies(submit(db, { actor: 6 }), "42501");
    await denies(submit(db, { venue: 21 }), "42501");
    await adminQuery(db, "update public.venue_dancer_affiliations set status='revoked',revoked_at=now() where dancer_id=$1", [id(37)]);
    await denies(submit(db), "40001");
    await adminQuery(db, "update public.shifts set location_verification_expires_at=now()-interval '1 second'");
    await denies(submit(db, { dancers: [38] }), "40001");
    assert.equal((await adminQuery(db, "select count(*) from public.venue_vip_requests")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("requests save venue time and dancer snapshots with exactly one notification per active admin", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    const result = await submit(db);
    assert.equal(result.request.status, "pending"); assert.equal(result.request.timezone, "America/Los_Angeles");
    assert.deepEqual(result.request.dancers.map(row => row.stageName), ["Dancer 7", "Dancer 8"]);
    assert.deepEqual(result.notifications.map(row => row.recipient_id).sort(), [id(1), id(2)]);
    for (const notification of result.notifications) {
      assert.match(notification.body, /Dancer 7, Dancer 8/); assert.match(notification.body, /20:30.*America\/Los_Angeles/);
      assert.equal(notification.payload.url, "/dashboard/venue#venue-vip");
    }
    const repeated = await submit(db);
    assert.equal(repeated.request.id, result.request.id); assert.equal(repeated.notifications.length, 0);
    assert.equal((await adminQuery(db, "select count(*) from public.notifications")).rows[0].count, 2);
    await adminQuery(db, "update public.dancer_profiles set stage_name='Changed' where id=$1", [id(37)]);
    assert.equal((await submit(db)).request.dancers[0].stageName, "Dancer 7");
  } finally { await db.close(); }
});

test("invalid and past times, DST gaps, duplicate dancers and oversized notes cannot create requests", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    for (const input of [{ local: "2020-01-01T20:30" }, { local: "2099-01-01T21:00" }, { local: "2030-02-30T21:00" }, { local: "2027-03-14T02:30" }, { dancers: [] }, { dancers: [37, 37] }, { notes: "x".repeat(1001) }]) {
      await assert.rejects(submit(db, input), error => ["22023", "22008"].includes(error.code));
    }
    assert.equal((await adminQuery(db, "select count(*) from public.venue_vip_requests")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("venue review is scoped, status transitions resist stale updates, and VIP gets a durable response", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db); await submit(db);
    const change = { id: id(90), expectedStatus: "pending", status: "confirmed", note: "See you then." };
    await denies(manage(db, "request_status", change, 4, 21), "P0002");
    await denies(manage(db, "request_status", change, 3), "42501");
    const result = await manage(db, "request_status", change, 2);
    assert.equal(result.request.status, "confirmed"); assert.equal(result.request.response_note, "See you then.");
    assert.equal(result.notifications[0].recipient_id, id(5)); assert.equal(result.notifications[0].payload.kind, "vip_request_status");
    await denies(manage(db, "request_status", change), "40001");
    await denies(manage(db, "request_status", { ...change, expectedStatus: "confirmed", status: "declined" }), "22023");
    assert.equal((await manage(db, "request_status", { ...change, expectedStatus: "confirmed", status: "cancelled" })).request.status, "cancelled");
  } finally { await db.close(); }
});

test("a notification failure rolls back the request; paused accounts and inactive venues are denied", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    await adminQuery(db, "alter table public.notifications add constraint synthetic_delivery_failure check(false)");
    await denies(submit(db), "23514");
    assert.equal((await adminQuery(db, "select count(*) from public.venue_vip_requests")).rows[0].count, 0);
    await adminQuery(db, "alter table public.notifications drop constraint synthetic_delivery_failure");
    await adminQuery(db, "update public.app_users set account_state='paused' where role='customer'");
    await denies(submit(db), "42501");
    await adminQuery(db, "update public.app_users set account_state='active'");
    await adminQuery(db, "update public.venues set is_active=false");
    await denies(submit(db), "P0002");
    await denies(invite(db), "42501");
  } finally { await db.close(); }
});
