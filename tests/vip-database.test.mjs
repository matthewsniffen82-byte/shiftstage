import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
// These fixtures exercise October 8 migrations and their immutable receipts.
// The October 30 release has a separate legal-consent-database suite.
import * as accessTerms from "../src/lib/dancr/access-terms-2026-10-08.ts";
const userTerms = { USER_TERMS_VERSION: "2026-10-08-v3", VIP_USER_TERMS_CONSENT: "I’m 18 or older and agree to the User Terms and VIP & Table Access Terms." };

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
      create type public.dancer_status as enum ('draft','pending_review','approved','rejected','disabled');
      create type public.review_status as enum ('pending','approved','rejected');
      create table public.dancer_channel_preferences(dancer_id uuid primary key,visibility text);
      create table public.dancer_shift_channels(shift_id uuid,dancer_id uuid,venue_id uuid,visibility text,selected_at timestamptz default now());
      create table public.dancer_age_verifications(user_id uuid,provider text,status text);
      create function public.is_internal_demo_shift(uuid) returns boolean language sql as 'select false';
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create table public.app_users(id uuid primary key,role text,account_state text);
      create table public.venues(id uuid primary key,owner_user_id uuid,name text,is_active boolean,timezone text);
      create table public.venue_team_members(venue_id uuid,user_id uuid,role text,status text);
      create table public.dancer_profiles(id uuid primary key,user_id uuid,stage_name text,status public.dancer_status,verification_status public.review_status,disabled_at timestamptz,is_public boolean default true,avatar_storage_path text,approved_at timestamptz default now(),venue_approved_at timestamptz default now(),admin_disabled_at timestamptz,updated_at timestamptz,venue_approved_by_user_id uuid,venue_approved_venue_id uuid);
      create table public.venue_dancer_affiliations(venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz,reentry_blocked boolean default false);
      create table public.shifts(id uuid default gen_random_uuid(),dancer_id uuid,venue_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
      create type public.notification_type as enum ('support_message');
      create type public.notification_channel as enum ('in_app','email','push');
      create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type public.notification_type,channel public.notification_channel,title text,body text,payload jsonb,sent_at timestamptz);
      grant usage on schema public to anon,authenticated,service_role;`);
    await db.exec(migration);
    await db.exec(readFileSync(new URL("../supabase/migrations/20261008070000_venue_vip_nicknames.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261008190000_vip_access_terms_acceptance.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261008210000_user_terms_acceptance.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261010093155_vip_shared_nicknames.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261010192345_vip_guest_withdrawal.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261010200606_vip_anonymous_dancer_requests.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261011084450_vip_pending_request_edits.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261011201618_vip_dancer_status_notifications.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261012012535_vip_venue_private_nicknames.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261020223646_vip_working_now_requests.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261022135605_dancer_incognito_vip_visibility.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../supabase/migrations/20261031025309_vip_request_received_alert.sql", import.meta.url), "utf8"));
    await db.exec("create trigger guard_dancer_channel_publication before insert or update on dancer_profiles for each row execute function guard_dancer_channel_publication(); grant update on dancer_profiles to service_role");
    // Match production grants for server-only SECURITY INVOKER request writes.
    await db.exec("grant select on public.app_users,public.venues,public.venue_team_members,public.dancer_profiles to service_role; grant select,insert on public.notifications to service_role");
    for (const [n, role] of [[1, "venue"], [2, "venue"], [3, "venue"], [4, "venue"], [5, "customer"], [6, "customer"], [7, "dancer"], [8, "dancer"], [9, "dancer"], [10, "customer"]]) {
      await db.query("insert into public.app_users values($1,$2,'active')", [id(n), role]);
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id(n), `person${n}@example.test`]);
    }
    await db.query("insert into public.venues values($1,$2,'Private club',true,'America/Los_Angeles'),($3,$4,'Other club',true,'America/New_York')", [id(20), id(1), id(21), id(4)]);
    await db.query("insert into public.venue_team_members values($1,$2,'manager','active'),($1,$3,'staff','active')", [id(20), id(2), id(3)]);
    for (const n of [7, 8, 9]) {
      await db.query("insert into public.dancer_profiles(id,user_id,stage_name,status,verification_status,disabled_at) values($1,$2,$3,'approved','approved',null)", [id(n + 30), id(n), `Dancer ${n}`]);
    }
    await db.query("insert into public.venue_dancer_affiliations(venue_id,dancer_id,status) values($1,$2,'active'),($3,$4,'active')", [id(20), id(37), id(21), id(39)]);
    await db.query("insert into public.shifts(dancer_id,venue_id,status,checked_in_at,checked_out_at,location_status,location_verification_expires_at) values($1,$2,'posted',now(),null,'club_confirmed',now()+interval '2 hours')", [id(38), id(20)]);
    await db.query("insert into public.shifts(dancer_id,venue_id,status,checked_in_at,checked_out_at,location_status,location_verification_expires_at) values($1,$2,'posted',now(),null,'club_confirmed',now()+interval '2 hours')", [id(37), id(20)]);
    await db.exec("set role service_role");
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function manage(db, action, data, actor = 1, venue = 20) {
  if (action === "request_status" && data.expectedUpdatedAt === undefined) {
    const row = (await db.query("select updated_at::text from public.venue_vip_requests where id=$1", [data.id])).rows[0];
    data = { ...data, expectedUpdatedAt: row?.updated_at };
  }
  return (await db.query("select public.vip_manage($1,$2,$3,$4) result", [id(actor), id(venue), action, JSON.stringify(data)])).rows[0].result;
}
async function invite(db, email = "person5@example.test", token = digest) { return manage(db, "invite", { email, digest: token }); }
async function accept(db, actor = 5, token = digest) {
  return (await db.query("select public.vip_accept_invitation_with_terms($1,$2,'Test VIP',$3,true) venue", [id(actor), token, accessTerms.ACCESS_TERMS_VERSION])).rows[0].venue;
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

async function edit(db, request, { actor = 5, venue = 20, local, dancers = [37], version = request.updated_at } = {}) {
  if (!local) local = (await db.query("select to_char((now()+interval '3 days') at time zone 'America/Los_Angeles','YYYY-MM-DD') || 'T21:00' value")).rows[0].value;
  return (await db.query("select public.vip_edit_request($1,$2,$3,$4,$5,$6) result", [id(actor),id(venue),request.id,version,local,dancers.map(id)])).rows[0].result;
}

test("pending edits preserve request identity, notify the venue and affected dancers anonymously, and retry without duplicate alerts", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db); const original = (await submit(db)).request;
    const result = await edit(db, original);
    assert.equal(result.changed, true); assert.equal(result.request.id, original.id); assert.equal(result.request.status, 'pending');
    assert.equal(result.request.created_at, original.created_at); assert.notEqual(result.request.updated_at, original.updated_at);
    assert.equal(result.request.notes, original.notes); assert.deepEqual(result.request.dancers.map(d => d.id), [id(37)]);
    const venue = result.notifications.filter(n => n.payload.kind === 'vip_request_updated');
    assert.deepEqual(venue.map(n => n.recipient_id).sort(), [id(1),id(2)]);
    assert.ok(venue.every(n => n.body.includes('Previously:') && n.body.includes('Now:')));
    const dancer = result.notifications.filter(n => n.payload.kind === 'vip_dancer_request');
    assert.deepEqual(dancer.map(n => n.recipient_id).sort(), [id(7),id(8)]);
    assert.match(dancer.find(n => n.recipient_id === id(8)).body, /no longer includes you/);
    for (const n of dancer) {
      assert.doesNotMatch(JSON.stringify(n), /Test VIP|Window table|guest_name|nickname|requestId|Dancer 7|Dancer 8/);
      assert.equal(n.payload.url, '/dashboard/dancer#dancer-account');
    }
    const retry = await edit(db, original);
    assert.equal(retry.changed, false); assert.equal(retry.notifications.length, 0);
    assert.equal((await db.query('select count(*)::int n from venue_vip_requests')).rows[0].n, 1);
    const added = await edit(db, result.request, { dancers: [37,38] });
    assert.deepEqual(added.notifications.filter(n => n.payload.kind === 'vip_dancer_request').map(n => n.recipient_id), [id(8)]);
  } finally { await db.close(); }
});

test("edits reject nonowners, stale saves and reviews, reviewed requests, invalid times and ineligible dancers", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db); const original = (await submit(db)).request;
    await denies(edit(db, original, { actor: 6 }), '42501');
    await db.query("insert into venue_vip_members(venue_id,user_id,display_name) values($1,$2,'Other VIP')", [id(20),id(6)]);
    await denies(edit(db, original, { actor: 6 }), 'P0002');
    await denies(edit(db, original, { venue: 21 }), '42501');
    for (const local of ['2000-01-01T20:00','2099-01-01T20:00','bad']) await denies(edit(db, original, { local }), '22023');
    for (const dancers of [[],[37,37],Array(11).fill(37)]) await denies(edit(db, original, { dancers }), '22023');
    await denies(edit(db, original, { dancers: [39] }), '40001');
    await denies(edit(db, original, { version: null }), '22023');
    const changed = (await edit(db, original)).request;
    await denies(edit(db, original, { dancers: [38] }), '40001');
    await denies(manage(db, 'request_status', { id: original.id, expectedStatus: 'pending', expectedUpdatedAt: original.updated_at, status: 'confirmed' }), '40001');
    await denies(manage(db, 'request_status', { id: original.id, expectedStatus: 'pending', expectedUpdatedAt: null, status: 'confirmed' }), '40001');
    await manage(db, 'request_status', { id: original.id, expectedStatus: 'pending', status: 'confirmed' });
    await denies(edit(db, changed), '40001');
    for (const role of ['anon','authenticated']) { await db.exec(`set role ${role}`); await denies(edit(db, original, { local: '2027-01-01T21:00' }), '42501'); }
  } finally { await db.close(); }
});

test("edits and alerts roll back together, and revoked or inactive memberships cannot edit", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db); const original = (await submit(db)).request;
    await adminQuery(db, "alter table notifications add constraint edit_delivery_failure check(title <> 'VIP request updated')");
    await denies(edit(db, original), '23514');
    const current = (await db.query('select to_jsonb(r) value from venue_vip_requests r where id=$1',[original.id])).rows[0].value;
    assert.deepEqual(current, original);
    await adminQuery(db, 'alter table notifications drop constraint edit_delivery_failure');
    await db.query('update venue_vip_members set active=false'); await denies(edit(db, original), '42501');
    await db.query('update venue_vip_members set active=true');
    await adminQuery(db, "update app_users set account_state='paused' where id=$1", [id(5)]); await denies(edit(db, original), '42501');
    await adminQuery(db, "update app_users set account_state='active' where id=$1", [id(5)]);
    await adminQuery(db, 'update venues set is_active=false where id=$1', [id(20)]); await denies(edit(db, original), 'P0002');
  } finally { await db.close(); }
});

test("guest withdrawal is owner-only, pending-only, idempotent and not callable by browser roles", async () => {
  const db = await fixture();
  const withdraw = (actor = 5, venue = 20, request = 90) => db.query("select public.vip_withdraw_request($1,$2,$3) result", [id(actor), id(venue), id(request)]);
  try {
    await invite(db); await accept(db); await submit(db);
    await denies(withdraw(6), "42501"); await denies(withdraw(5, 21), "42501");
    await db.query("insert into venue_vip_members(venue_id,user_id,display_name) values($1,$2,'Other VIP')", [id(20), id(6)]);
    await denies(withdraw(6), "P0002");
    const result = (await withdraw()).rows[0].result;
    assert.equal(result.request.status, "cancelled"); assert.equal(result.request.reviewed_by, id(5));
    assert.deepEqual(result.notifications.map(row => row.recipient_id).sort(), [id(1), id(2)]);
    assert.ok(result.notifications.every(row => row.payload.kind === "vip_request_withdrawn"));
    assert.equal((await withdraw()).rows[0].result.notifications.length, 0);
    await denies(manage(db, "request_status", { id: id(90), expectedStatus: "pending", status: "confirmed" }), "40001");
    await submit(db, { request: 91 });
    await manage(db, "request_status", { id: id(91), expectedStatus: "pending", status: "confirmed" });
    await denies(withdraw(5, 20, 91), "40001");
    for (const role of ["anon", "authenticated"]) { await db.exec(`set role ${role}`); await denies(withdraw(), "42501"); }
  } finally { await db.close(); }
});

test("guest withdrawal rolls back when venue alerts fail and denies revoked or inactive access", async () => {
  const db = await fixture();
  const withdraw = () => db.query("select public.vip_withdraw_request($1,$2,$3)", [id(5), id(20), id(90)]);
  try {
    await invite(db); await accept(db); await submit(db);
    await adminQuery(db, "alter table public.notifications add constraint withdrawal_delivery_failure check(title <> 'VIP request withdrawn')");
    await denies(withdraw(), "23514");
    assert.equal((await db.query("select status from venue_vip_requests where id=$1", [id(90)])).rows[0].status, "pending");
    await adminQuery(db, "alter table public.notifications drop constraint withdrawal_delivery_failure");
    await db.query("update venue_vip_members set active=false"); await denies(withdraw(), "42501");
    await db.query("update venue_vip_members set active=true");
    await adminQuery(db, "update app_users set account_state='paused' where id=$1", [id(5)]); await denies(withdraw(), "42501");
    await adminQuery(db, "update app_users set account_state='active' where id=$1", [id(5)]);
    await adminQuery(db, "update venues set is_active=false where id=$1", [id(20)]); await denies(withdraw(), "P0002");
  } finally { await db.close(); }
});

test("full User Terms and feature assent are atomic with VIP activation and retries preserve receipts", async () => {
  const db=await fixture();
  const activate=(version=userTerms.USER_TERMS_VERSION, accepted=true, actor=5)=>db.query(
    "select public.vip_accept_invitation_with_user_terms($1,$2,'Jordan',$3,true,$4,$5)",
    [id(actor),digest,accessTerms.ACCESS_TERMS_VERSION,version,accepted]);
  try {
    await invite(db);
    for(const [version,accepted] of [[userTerms.USER_TERMS_VERSION,false],[userTerms.USER_TERMS_VERSION,null],["old",true]])
      await denies(activate(version,accepted),"22023");
    await assert.rejects(activate(userTerms.USER_TERMS_VERSION,true,6));
    assert.equal((await adminQuery(db,"select count(*)::int n from public.venue_vip_members")).rows[0].n,0);
    await db.exec("reset role;create function public.fail_terms_receipt() returns trigger language plpgsql as $$begin raise exception 'receipt unavailable';end$$;create trigger fail_terms_receipt before insert on public.user_terms_acceptances for each row execute function public.fail_terms_receipt();set role service_role");
    await assert.rejects(activate(),/receipt unavailable/);
    assert.equal((await adminQuery(db,"select count(*)::int n from public.venue_vip_members")).rows[0].n,0);
    await db.exec("reset role;drop trigger fail_terms_receipt on public.user_terms_acceptances;drop function public.fail_terms_receipt();set role service_role");
    await activate();
    const receipts=(await db.query("select * from public.user_terms_acceptances")).rows;
    assert.equal(receipts.length,1);assert.equal(receipts[0].consent_text,userTerms.VIP_USER_TERMS_CONSENT);
    assert.equal(receipts[0].user_id,id(5));assert.equal(receipts[0].version,userTerms.USER_TERMS_VERSION);
    assert.equal((await db.query("select consent_text from public.vip_access_acceptances")).rows[0].consent_text,userTerms.VIP_USER_TERMS_CONSENT);
    await activate();assert.deepEqual((await db.query("select * from public.user_terms_acceptances")).rows,receipts);
  } finally { await db.close(); }
});

test("VIP acceptance snapshots match the displayed terms, notice and affirmative text", async () => {
  const db = await fixture();
  try {
    const snapshot = (await db.query("select * from public.vip_access_terms_versions")).rows[0];
    assert.equal(snapshot.version, accessTerms.ACCESS_TERMS_VERSION);
    assert.equal(snapshot.terms_href, accessTerms.ACCESS_TERMS_HREF);
    assert.equal(snapshot.title, accessTerms.ACCESS_TERMS_TITLE);
    assert.equal(snapshot.document_text.replace(/\r\n/g, "\n"), accessTerms.ACCESS_TERMS_PARAGRAPHS.join("\n\n"));
    assert.equal(snapshot.notice_text, accessTerms.VIP_ACCESS_NOTICE);
    assert.equal(snapshot.consent_text, accessTerms.VIP_ACCESS_CONSENT);
    assert.equal(snapshot.privacy_href, "/privacy");
    await invite(db);
    for (const [version, accepted] of [[accessTerms.ACCESS_TERMS_VERSION, false], [accessTerms.ACCESS_TERMS_VERSION, null], ["old", true], [null, true]]) {
      await denies(db.query("select public.vip_accept_invitation_with_terms($1,$2,'VIP',$3,$4)", [id(5), digest, version, accepted]), "22023");
    }
    assert.equal((await db.query("select count(*)::int n from public.venue_vip_members")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from public.vip_access_acceptances")).rows[0].n, 0);
    await accept(db);
    const receipt = (await db.query("select * from public.vip_access_acceptances")).rows[0];
    assert.equal(receipt.user_id, id(5)); assert.equal(receipt.venue_id, id(20));
    assert.equal(receipt.acceptance_source, "vip_activation_checkbox"); assert.ok(receipt.accepted_at);
    await accept(db);
    const retried = (await db.query("select * from public.vip_access_acceptances")).rows;
    assert.equal(retried.length, 1); assert.deepEqual(retried[0], receipt);
    await denies(db.query("delete from public.vip_access_acceptances"), "42501");
    await denies(db.query("update public.vip_access_terms_versions set consent_text='changed'"), "42501");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const table of ["vip_access_terms_versions", "vip_access_acceptances"]) await denies(db.query(`select * from public.${table}`), "42501");
      await denies(db.query("select public.vip_accept_invitation_with_terms($1,$2,'VIP',$3,true)", [id(5), digest, accessTerms.ACCESS_TERMS_VERSION]), "42501");
    }
  } finally { await db.close(); }
});

test("VIP activation rolls back if its acceptance cannot be saved", async () => {
  const db = await fixture();
  try {
    await invite(db);
    await adminQuery(db, "delete from public.vip_access_terms_versions");
    await denies(accept(db), "23503");
    assert.equal((await db.query("select count(*)::int n from public.venue_vip_members")).rows[0].n, 0);
    assert.equal((await db.query("select accepted_at from public.venue_vip_invitations")).rows[0].accepted_at, null);
  } finally { await db.close(); }
});

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
      await denies(submit(db, { local: "2027-01-15T20:30" }), "42501");
      await denies(db.query("select public.vip_accept_invitation($1,$2,'VIP')", [id(5), digest]), "42501");
      await denies(db.query("select public.vip_set_member_nickname($1,$2,$3,'Nick')", [id(1), id(20), id(50)]), "42501");
      await denies(db.query("select public.vip_search_members($1,$2,'',0)", [id(1), id(20)]), "42501");
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
    await adminQuery(db, "update shifts set checked_out_at=now() where dancer_id=$1", [id(37)]);
    const roster = (await db.query("select * from public.vip_eligible_dancers($1)", [id(20)])).rows;
    assert.deepEqual(roster.map(row => [row.id, row.working_now]), [[id(37), false], [id(38), true]]);
    await denies(submit(db, { dancers: [37] }), "40001");
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

test("new and edited VIP selections require a current verified check-in at the selected club", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    const original = (await submit(db)).request;
    const notices = (await db.query("select count(*)::int n from notifications")).rows[0].n;
    for (const change of [
      "checked_out_at=now()",
      "location_verification_expires_at=now()-interval '1 second'",
      "checked_in_at=null",
      "location_status='pending'",
      "status='cancelled'",
      `venue_id='${id(21)}'`,
    ]) {
      await adminQuery(db, `update shifts set ${change} where dancer_id=$1`, [id(37)]);
      await denies(submit(db, { request: 91 }), "40001");
      await denies(edit(db, original), "40001");
      assert.equal((await db.query("select count(*)::int n from venue_vip_requests")).rows[0].n, 1);
      assert.equal((await db.query("select count(*)::int n from notifications")).rows[0].n, notices);
      assert.deepEqual((await db.query("select to_jsonb(r) value from venue_vip_requests r where id=$1", [original.id])).rows[0].value, original);
      // Retrying an already-saved request does not create a new selection or alert.
      assert.equal((await submit(db)).notifications.length, 0);
      await adminQuery(db, "update shifts set checked_out_at=null,checked_in_at=now(),location_verification_expires_at=now()+interval '2 hours',location_status='club_confirmed',status='posted',venue_id=$1 where dancer_id=$2", [id(20), id(37)]);
    }
    assert.equal((await edit(db, original)).changed, true);
    assert.equal((await submit(db, { request: 91 })).request.id, id(91));
  } finally { await db.close(); }
});

test("requests acknowledge the guest, notify managers and anonymous dancers once per request", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    await db.query("update venue_vip_members set nickname='Friday regular'");
    const result = await submit(db);
    assert.equal(result.request.status, "pending"); assert.equal(result.request.timezone, "America/Los_Angeles");
    assert.deepEqual(result.request.dancers.map(row => row.stageName), ["Dancer 7", "Dancer 8"]);
    assert.deepEqual(result.notifications.map(row => row.recipient_id).sort(), [id(1), id(2), id(5), id(7), id(8)]);
    const receipt = result.notifications.find(row => row.recipient_id === id(5));
    assert.equal(receipt.title, "VIP request received");
    assert.match(receipt.body, /Private club received your request.*20:30.*America\/Los_Angeles.*Dancer 7, Dancer 8.*Awaiting club confirmation/);
    assert.doesNotMatch(JSON.stringify(receipt), /Friday regular/);
    assert.equal(receipt.payload.kind, "vip_request_status");
    assert.equal(receipt.payload.status, "pending");
    assert.equal(receipt.payload.requestId, result.request.id);
    assert.equal(receipt.payload.url, "/vip");
    const managers = result.notifications.filter(row => row.payload.kind === "vip_request");
    assert.equal(managers.length, 2);
    for (const notification of managers) {
      assert.match(notification.body, /^Friday regular requested/); assert.doesNotMatch(notification.body, /Test VIP/);
      assert.match(notification.body, /Dancer 7, Dancer 8/); assert.match(notification.body, /20:30.*America\/Los_Angeles/);
      assert.equal(notification.payload.url, "/dashboard/venue#venue-vip");
    }
    const dancers = result.notifications.filter(row => row.payload.kind === "vip_dancer_request");
    assert.equal(dancers.length, 2);
    for (const notification of dancers) {
      assert.match(notification.body, /^A VIP requested you at Private club on/);
      assert.match(notification.body, /20:30.*America\/Los_Angeles/);
      assert.match(notification.body, /Awaiting venue confirmation/);
      assert.deepEqual(Object.keys(notification.payload).sort(), ["kind", "startsAt", "timezone", "url", "venueId", "venueName"]);
      assert.equal(notification.payload.startsAt, result.request.starts_at);
      assert.equal(notification.payload.timezone, result.request.timezone);
      assert.equal(notification.payload.url, "/dashboard/dancer#dancer-account");
      for (const privateValue of ["Test VIP", "Friday regular", "person5@example.test", "Window table please", id(5), id(90), "Dancer 7", "Dancer 8"]) {
        assert.ok(!JSON.stringify(notification).includes(privateValue), privateValue);
      }
    }
    const repeated = await submit(db);
    assert.equal(repeated.request.id, result.request.id); assert.equal(repeated.notifications.length, 0);
    assert.equal((await adminQuery(db, "select count(*) from public.notifications")).rows[0].count, 5);
    await adminQuery(db, "update public.dancer_profiles set stage_name='Changed' where id=$1", [id(37)]);
    assert.equal((await submit(db)).request.dancers[0].stageName, "Dancer 7");
  } finally { await db.close(); }
});

test("unselected dancers and inactive managers receive no request alert", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    await adminQuery(db, "update app_users set account_state='paused' where id=$1", [id(2)]);
    const result = await submit(db, { dancers: [37] });
    assert.deepEqual(result.notifications.map(row => row.recipient_id).sort(), [id(1), id(5), id(7)]);
    assert.match(result.notifications.find(row => row.recipient_id === id(1)).body, /^Test VIP requested/);
    await adminQuery(db, "update app_users set account_state='paused' where id=$1", [id(7)]);
    await denies(submit(db, { request: 91, dancers: [37] }), "40001");
    assert.equal((await adminQuery(db, "select count(*)::int n from notifications")).rows[0].n, 3);
  } finally { await db.close(); }
});

test("a receipt failure rolls back the request and every audience's alerts", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    await adminQuery(db, "alter table notifications add constraint guest_receipt_failure check(title <> 'VIP request received')");
    await denies(submit(db), "23514");
    assert.equal((await db.query("select count(*)::int n from venue_vip_requests")).rows[0].n, 0);
    assert.equal((await adminQuery(db, "select count(*)::int n from notifications")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("a dancer alert failure rolls back the request and its manager alerts", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    await adminQuery(db, "alter table notifications add constraint dancer_alert_failure check(payload->>'kind'<>'vip_dancer_request')");
    await denies(submit(db), "23514");
    assert.equal((await db.query("select count(*)::int n from venue_vip_requests")).rows[0].n, 0);
    assert.equal((await adminQuery(db, "select count(*)::int n from notifications")).rows[0].n, 0);
    await adminQuery(db, "alter table notifications drop constraint dancer_alert_failure");
    assert.equal((await submit(db)).notifications.length, 5);
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

test("venue confirmation and cancellation notify selected dancers anonymously, including off-shift dancers, exactly once", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    await db.query("update venue_vip_members set nickname='Friday regular'");
    const original = (await submit(db)).request;
    const schedule = (await db.query("select to_char(starts_at at time zone timezone,'Mon DD, YYYY HH24:MI') value from venue_vip_requests where id=$1", [original.id])).rows[0].value;
    for (const [expectedStatus, status] of [["pending", "confirmed"], ["confirmed", "cancelled"]]) {
      if (status === "cancelled") {
        await adminQuery(db, "update shifts set checked_out_at=now()");
        await adminQuery(db, "update venue_dancer_affiliations set status='revoked',revoked_at=now()");
      }
      const change = { id: original.id, expectedStatus, status, note: "Private reply to the VIP" };
      const result = await manage(db, "request_status", change, 2);
      assert.deepEqual(result.notifications.map(n => n.recipient_id).sort(), [id(5), id(7), id(8)]);
      const dancers = result.notifications.filter(n => n.payload.kind === "vip_dancer_request");
      assert.equal(dancers.length, 2);
      for (const notification of dancers) {
        assert.equal(notification.title, "VIP visit " + status);
        assert.equal(notification.channel, "in_app"); assert.ok(notification.sent_at);
        assert.ok(notification.body.includes("Private club on " + schedule + " (America/Los_Angeles)"));
        assert.ok(notification.body.includes("has been " + status + " by the venue."));
        assert.deepEqual(notification.payload, {
          kind: "vip_dancer_request", status, venueId: id(20), venueName: "Private club",
          startsAt: result.request.starts_at, timezone: "America/Los_Angeles", url: "/dashboard/dancer#dancer-account",
        });
        assert.doesNotMatch(JSON.stringify(notification), /Test VIP|Friday regular|Window table|Private reply|guest_name|nickname|requestId|Dancer 7|Dancer 8/);
        assert.ok(!JSON.stringify(notification).includes(id(5)));
        assert.ok(!JSON.stringify(notification).includes(original.id));
        const saved = (await db.query("select to_jsonb(n) value from notifications n where id=$1", [notification.id])).rows[0].value;
        assert.deepEqual(saved, notification);
      }
      const count = (await db.query("select count(*)::int n from notifications")).rows[0].n;
      await denies(manage(db, "request_status", change, 2), "40001");
      assert.equal((await db.query("select count(*)::int n from notifications")).rows[0].n, count);
    }
  } finally { await db.close(); }
});

test("status notices follow the latest dancer selection and skip inactive accounts; declines still notify the VIP", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    const original = (await submit(db)).request;
    const edited = (await edit(db, original, { dancers: [37] })).request;
    const confirmed = await manage(db, "request_status", { id: original.id, expectedStatus: "pending", status: "confirmed" });
    assert.deepEqual(confirmed.notifications.map(n => n.recipient_id).sort(), [id(5), id(7)]);
    assert.equal(confirmed.notifications.find(n => n.recipient_id === id(7)).payload.startsAt, edited.starts_at);
    await adminQuery(db, "update app_users set account_state='paused' where id=$1", [id(7)]);
    const cancelled = await manage(db, "request_status", { id: original.id, expectedStatus: "confirmed", status: "cancelled" });
    assert.deepEqual(cancelled.notifications.map(n => n.recipient_id), [id(5)]);
    await submit(db, { request: 91, dancers: [38] });
    const declined = await manage(db, "request_status", { id: id(91), expectedStatus: "pending", status: "declined" });
    assert.deepEqual(declined.notifications.map(n => n.recipient_id), [id(5)]);
    assert.equal(declined.notifications[0].payload.kind, "vip_request_status");
  } finally { await db.close(); }
});

test("status updates and both audiences' notifications roll back together; browser roles cannot invoke reviews", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db); await submit(db);
    await adminQuery(db, "alter table notifications add constraint status_delivery_failure check(payload->>'kind'<>'vip_dancer_request' or not (payload ? 'status'))");
    for (const [expectedStatus, status] of [["pending", "confirmed"], ["confirmed", "cancelled"]]) {
      const change = { id: id(90), expectedStatus, status };
      const before = (await db.query("select to_jsonb(r) value from venue_vip_requests r where id=$1", [id(90)])).rows[0].value;
      const count = (await db.query("select count(*)::int n from notifications")).rows[0].n;
      await denies(manage(db, "request_status", change), "23514");
      assert.deepEqual((await db.query("select to_jsonb(r) value from venue_vip_requests r where id=$1", [id(90)])).rows[0].value, before);
      assert.equal((await db.query("select count(*)::int n from notifications")).rows[0].n, count);
      if (status === "confirmed") {
        await adminQuery(db, "alter table notifications drop constraint status_delivery_failure");
        await manage(db, "request_status", change);
        await adminQuery(db, "alter table notifications add constraint status_delivery_failure check(payload->>'kind'<>'vip_dancer_request' or not (payload ? 'status')) not valid");
      }
    }
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set role " + role);
      await denies(db.query("select public.vip_manage($1,$2,'request_status',$3)", [id(1), id(20), JSON.stringify({ id: id(90), expectedStatus: "confirmed", status: "cancelled" })]), "42501");
    }
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

test("venue nicknames are editable, clearable and scoped without changing guest identities", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    const member = (await db.query("select id from venue_vip_members where venue_id=$1", [id(20)])).rows[0];
    const save = (nickname, actor = 1, venue = 20) => db.query("select vip_set_member_nickname($1,$2,$3,$4) result", [id(actor), id(venue), member.id, nickname]);
    await save("  Friday regular  ", 2);
    const saved = (await db.query("select display_name,nickname from venue_vip_members where id=$1", [member.id])).rows[0];
    assert.deepEqual(saved, { display_name: "Test VIP", nickname: "Friday regular" });
    await denies(save("Other club", 4, 21), "P0002");
    for (const actor of [3, 4, 5]) await denies(save("Denied", actor), "42501");
    for (const nickname of [null, "x".repeat(81), "two\nlines"]) await denies(save(nickname), "22023");
    await save(" ");
    assert.equal((await db.query("select nickname from venue_vip_members where id=$1", [member.id])).rows[0].nickname, "");
    await adminQuery(db, "update app_users set account_state='disabled' where id=$1", [id(2)]);
    await denies(save("Inactive manager", 2), "42501");
    await manage(db, "revoke_member", { id: member.id });
    await denies(save("Revoked guest"), "P0002");
  } finally { await db.close(); }
});

test("VIP search matches literal nicknames and names across all pages, only within the managed venue", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    await db.query("update venue_vip_members set nickname='Friday 100%_VIP' where venue_id=$1", [id(20)]);
    await db.query("insert into venue_vip_members(venue_id,user_id,display_name,nickname) values($1,$2,'Other club identity','Friday elsewhere'),($3,$4,'Revoked VIP','Friday revoked')", [id(21), id(5), id(20), id(6)]);
    await db.query("update venue_vip_members set active=false where user_id=$1", [id(6)]);
    const search = async (text = "", offset = 0, actor = 1, venue = 20) => (await db.query("select vip_search_members($1,$2,$3,$4) result", [id(actor), id(venue), text, offset])).rows[0].result;
    for (const text of [" friday ", "TEST vip", "100%_", "%", "_"]) {
      const result = await search(text); assert.equal(result.memberCount, 1); assert.equal(result.members[0].display_name, "Test VIP");
    }
    assert.equal((await search("elsewhere")).memberCount, 0);
    assert.equal((await search("revoked")).memberCount, 0);
    assert.equal((await search("Friday", 0, 4, 21)).members[0].nickname, "Friday elsewhere");
    for (const actor of [3, 4, 5]) await denies(search("", 0, actor), "42501");
    for (const [query, offset] of [["x".repeat(81), 0], ["", -1], ["", 50001], ["\n", 0]]) await denies(search(query, offset), "22023");
    await adminQuery(db, `insert into app_users(id,role,account_state) select ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'customer','active' from generate_series(100,159) n`);
    await adminQuery(db, `insert into venue_vip_members(venue_id,user_id,display_name,nickname) select $1,id,'Guest '||id,'Regular '||id from app_users where id>= $2`, [id(20), id(100)]);
    const first = await search("Regular"), second = await search("Regular", 50);
    assert.equal(first.memberCount, 60); assert.equal(first.members.length, 50); assert.equal(first.membersHasMore, true);
    assert.equal(second.members.length, 10); assert.equal(second.membersHasMore, false);
    assert.equal(new Set([...first.members, ...second.members].map(member => member.id)).size, 60);
    assert.equal((await search("159")).memberCount, 1, "search reaches a nickname beyond the first page");
  } finally { await db.close(); }
});

test("invitation nicknames survive activation and retries preserve the latest member nickname", async () => {
  const db = await fixture();
  try {
    for (const nickname of [null, 42, "x".repeat(81), "two\nlines"]) {
      await denies(manage(db, "invite", { email: "person5@example.test", digest, nickname }), "22023");
    }
    await manage(db, "invite", { email: "person5@example.test", digest, nickname: "  Friday regular  " });
    await accept(db);
    assert.equal((await db.query("select nickname from venue_vip_members")).rows[0].nickname, "Friday regular");
    const result = (await submit(db)).notifications;
    assert.ok(result.filter(row => row.payload.kind === "vip_request").every(row => row.body.startsWith("Friday regular requested")));
    await db.query("select vip_set_member_nickname($1,$2,(select id from venue_vip_members where user_id=$3 and venue_id=$2),'Jordan')", [id(1),id(20),id(5)]);
    await accept(db);
    await manage(db,"invite",{ email:"person5@example.test",digest:"b".repeat(64),nickname:"Stale invitation label" });
    await accept(db,5,"b".repeat(64));
    const member=(await db.query("select display_name,nickname from venue_vip_members")).rows[0];
    assert.deepEqual(member,{display_name:"Test VIP",nickname:"Jordan"});
  } finally { await db.close(); }
});

test("venue-private nicknames cannot be read or changed by guests or the retired server RPC", async () => {
  const db = await fixture();
  try {
    await manage(db, "invite", { email: "person5@example.test", digest, nickname: "Private venue label" });
    await accept(db);
    const member = (await db.query("select id from public.venue_vip_members")).rows[0];
    await db.query("select public.vip_set_member_nickname($1,$2,$3,'Updated private label')", [id(1), id(20), member.id]);
    assert.equal((await adminQuery(db, "select count(*)::int n from public.notifications")).rows[0].n, 0, "venue edits do not notify the VIP");
    for (const role of ["service_role", "anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await denies(db.query("select public.vip_update_own_nickname($1,$2,'Guest overwrite')", [id(5), id(20)]), "42501");
      if (role !== "service_role") {
        await denies(db.query("select nickname from public.venue_vip_members where user_id=$1", [id(5)]), "42501");
        await denies(db.query("update public.venue_vip_members set nickname='Guest overwrite' where user_id=$1", [id(5)]), "42501");
        await denies(db.query("select nickname from public.venue_vip_invitations"), "42501");
      }
    }
    await db.exec("reset role");
    await denies(db.query("select public.vip_update_own_nickname($1,$2,'Owner of function')", [id(5), id(20)]), "42501");
    await db.exec("set role service_role");
    assert.deepEqual((await db.query("select display_name,nickname from public.venue_vip_members")).rows[0],
      { display_name: "Test VIP", nickname: "Updated private label" });
    const submitted = await submit(db);
    assert.doesNotMatch(JSON.stringify(submitted.request), /nickname|Updated private label/);
    const reviewed = await manage(db, "request_status", { id: submitted.request.id, expectedStatus: "pending", status: "confirmed", note: "" });
    assert.doesNotMatch(JSON.stringify(reviewed.request), /nickname|Updated private label/);
    assert.ok(reviewed.notifications.some(notification => notification.recipient_id === id(5)));
    assert.doesNotMatch(JSON.stringify(reviewed.notifications), /nickname|Updated private label/);
  } finally { await db.close(); }
});


test("Incognito blocks VIP lists and stale new/edited requests; restore preserves Internal-only discovery consent", async () => {
  const db = await fixture();
  try {
    await invite(db); await accept(db);
    await adminQuery(db, "insert into dancer_channel_preferences values($1,'internal')", [id(37)]);
    await adminQuery(db, "update dancer_profiles set is_public=false where id=$1", [id(37)]);
    await adminQuery(db, "insert into dancer_shift_channels(shift_id,dancer_id,venue_id,visibility) values($1,$2,$3,'internal')", [id(80),id(37),id(20)]);
    await adminQuery(db, "insert into venue_dancer_affiliations(venue_id,dancer_id,status) values($1,$2,'active')", [id(21),id(37)]);
    const original = (await submit(db, { dancers: [37] })).request;
    const toggle = async transition => (await db.query("select transition_dancer_publication_safely($1,$2,$3) state", [id(37),transition,id(7)])).rows[0].state;
    assert.equal((await toggle('set_private')).is_incognito, true);
    assert.ok(!(await db.query("select * from vip_eligible_dancers($1)",[id(20)])).rows.some(d => d.id === id(37)));
    await denies(submit(db, {request:91,dancers:[37]}), '40001');
    await denies(edit(db, original, {dancers:[37]}), '40001');
    // Background publication and account reactivation cannot undo Incognito.
    await adminQuery(db, 'update dancer_profiles set is_public=true where id=$1', [id(37)]);
    assert.equal((await toggle('reactivate')).is_public, false);
    const restored = await toggle('restore_visibility');
    assert.equal(restored.is_incognito, false); assert.equal(restored.is_public, false);
    assert.equal(restored.channel_visibility, 'internal');
    assert.ok((await db.query("select * from vip_eligible_dancers($1)",[id(20)])).rows.some(d => d.id === id(37)));
    assert.ok(!(await db.query("select * from vip_eligible_dancers($1)",[id(21)])).rows.some(d => d.id === id(37)));
    assert.ok((await submit(db, {request:92,dancers:[37]})).request);
    await denies(db.query("select transition_dancer_publication_safely($1,'set_private',$2)",[id(37),id(8)]),'42501');
  } finally { await db.close(); }
});
