import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const sql = readFileSync('supabase/migrations/20261029030601_admin_review_email_alerts.sql', 'utf8');
const id = n => `ac000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; grant usage on schema private to service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    create table public.app_users(id uuid primary key,email text,role text,admin_workspace_role text default 'owner',account_state text default 'active');
    create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb,sent_at timestamptz);
    create table public.venue_signup_requests(id uuid primary key,venue_name text,status text);
    create table public.venues(id uuid primary key,name text,page_review_status text,page_review_notes text,page_reviewed_at timestamptz,updated_at timestamptz default now());
    create table public.venue_club_deal_requests(id uuid primary key,venue_id uuid,offer_title text,request_type text,status text default 'pending');
    create table public.content_reports(id uuid primary key,target_label text,status text default 'open');
    create table public.dmca_cases(id uuid primary key,status text default 'received');
    create table public.dmca_counter_notices(id uuid primary key,case_id uuid);
    create table public.dancer_profiles(id uuid primary key,user_id uuid,stage_name text);
    create table public.image_moderation_records(id uuid primary key,user_id uuid,decision text,upload_context text,club_reviewed_at timestamptz);
    create table public.mydancr_tv_videos(id uuid primary key,dancer_id uuid,status text,upload_validation_pending boolean,moderation_details jsonb,club_reviewed_at timestamptz);
    grant select on public.app_users to service_role;`);
  await db.exec(sql);
  for (const [n, role, staff] of [[1, 'admin', 'owner'], [2, 'admin', 'reviewer'], [3, 'admin', 'support'], [4, 'customer', 'owner']]) {
    await db.query('insert into public.app_users(id,email,role,admin_workspace_role) values($1,$2,$3,$4)', [id(n), `user${n}@example.invalid`, role, staff]);
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id(n), `user${n}@example.invalid`]);
  }
  await db.query("insert into public.venues(id,name,page_review_status) values($1,'Test Club','pending_review')", [id(10)]);
  await db.query("insert into public.dancer_profiles values($1,$2,'Test dancer')", [id(20), id(21)]);
  return db;
}
const count = async (db, table) => Number((await db.query(`select count(*) from public.${table}`)).rows[0].count);
const claim = async db => (await db.query('select * from public.claim_admin_review_emails(1)')).rows[0];
const target = async (db, job) => (await db.query('select public.admin_review_email_target($1,$2) as target', [job.id, job.lease_id])).rows[0].target;
const finish = async (db, job, status) => (await db.query('select public.finish_admin_review_email($1,$2,$3,$4) as saved', [job.id, job.lease_id, status, 'test-outcome'])).rows[0].saved;

test('verified club applications and every requested review category keep both dashboard alerts and email jobs', async () => {
  const db = await fixture(); try {
    await db.query("insert into public.venue_signup_requests values($1,'Test Club','awaiting_email_confirmation')", [id(30)]);
    assert.equal(await count(db, 'notifications'), 0);
    await db.query("update public.venue_signup_requests set status='pending' where id=$1", [id(30)]);
    await db.query("update public.venue_signup_requests set status='pending' where id=$1", [id(30)]);
    await db.query("insert into public.venue_club_deal_requests(id,venue_id,offer_title,request_type) values($1,$2,'Free entry','add'),($3,$2,'Free entry','remove')", [id(31), id(10), id(32)]);
    await db.query("update public.venues set page_review_status='changes_requested',page_review_notes='Correct the address',page_reviewed_at=now() where id=$1", [id(10)]);
    await db.query("update public.venues set page_review_notes='Correct the address',updated_at=now() where id=$1", [id(10)]);
    await db.query("insert into public.content_reports(id,target_label) values($1,'Test content')", [id(33)]);
    await db.query('insert into public.dmca_cases(id) values($1)', [id(34)]);
    await db.query('insert into public.dmca_counter_notices values($1,$2)', [id(35), id(34)]);
    assert.equal(await count(db, 'admin_review_email_events'), 7);
    assert.equal(await count(db, 'admin_review_email_deliveries'), 7);
    assert.equal(await count(db, 'notifications'), 7);
    assert.ok((await db.query('select recipient_id,channel,payload from public.notifications')).rows.every(row => row.recipient_id === id(1) && row.channel === 'in_app' && row.payload.kind === 'admin_review'));
    await db.query("update public.venue_signup_requests set status='approved' where id=$1", [id(30)]);
    await db.query("update public.content_reports set status='resolved' where id=$1", [id(33)]);
    assert.equal(await count(db, 'admin_review_email_events'), 7);
    await db.query("update public.venues set page_review_notes='Change the hours',page_reviewed_at=now() where id=$1", [id(10)]);
    assert.equal(await count(db, 'admin_review_email_events'), 8);
  } finally { await db.close(); }
});

test('media alerts wait for the exact staff queue gates and reach owners plus reviewers only once', async () => {
  const db = await fixture(); try {
    await db.query("insert into public.image_moderation_records values($1,$2,'review','profile_main',null)", [id(40), id(21)]);
    await db.query("insert into public.mydancr_tv_videos values($1,$2,'submitted',true,'{}',null)", [id(41), id(20)]);
    assert.equal(await count(db, 'notifications'), 0);
    await db.query('update public.image_moderation_records set club_reviewed_at=now() where id=$1', [id(40)]);
    assert.equal(await count(db, 'notifications'), 2);
    await db.query("update public.image_moderation_records set decision='review' where id=$1", [id(40)]);
    await db.query('update public.mydancr_tv_videos set club_reviewed_at=now() where id=$1', [id(41)]);
    await db.query('update public.mydancr_tv_videos set upload_validation_pending=false where id=$1', [id(41)]);
    assert.equal(await count(db, 'notifications'), 2);
    await db.query('update public.mydancr_tv_videos set moderation_details=$1 where id=$2', [{ fileChecksPassed: true }, id(41)]);
    assert.equal(await count(db, 'notifications'), 4);
    await db.query("update public.mydancr_tv_videos set status='approved' where id=$1", [id(41)]);
    assert.equal(await count(db, 'notifications'), 4);
    const recipients = (await db.query('select distinct recipient_id from public.notifications')).rows.map(row => row.recipient_id).sort();
    assert.deepEqual(recipients, [id(1), id(2)]);
  } finally { await db.close(); }
});

test('claim leases, retry receipts and immutable destinations prevent duplicate or stale sends', async () => {
  const db = await fixture(); try {
    await db.query("insert into public.content_reports(id,target_label) values($1,'Test')", [id(50)]);
    const first = await claim(db); assert.ok(first); assert.equal(await claim(db), undefined);
    const initial = await target(db, first); assert.equal(initial.email, 'user1@example.invalid');
    assert.equal(await finish(db, { ...first, lease_id: id(99) }, 'accepted'), false);
    assert.equal(await finish(db, first, 'retry'), true); assert.equal(await claim(db), undefined);
    await db.exec("update public.admin_review_email_deliveries set next_attempt_at=now()-interval '1 minute'");
    const retry = await claim(db); assert.equal(retry.id, first.id); assert.notEqual(retry.lease_id, first.lease_id);
    assert.equal(await target(db, first), null);
    await db.query("update auth.users set email='changed@example.invalid' where id=$1", [id(1)]);
    await db.query("update public.app_users set email='changed@example.invalid' where id=$1", [id(1)]);
    assert.equal(await target(db, retry), null); assert.equal(await finish(db, retry, 'skipped'), true);
    assert.equal(await count(db, 'notifications'), 1); // Email outcome never deletes the dashboard alert.
  } finally { await db.close(); }
});

test('sending uses current verified admin access and browser roles cannot access delivery data or RPCs', async () => {
  const db = await fixture(); try {
    await db.query("insert into public.content_reports(id,target_label) values($1,'Test')", [id(60)]);
    const job = await claim(db);
    await db.query('update auth.users set email_confirmed_at=null where id=$1', [id(1)]);
    assert.equal(await target(db, job), null);
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [id(1)]);
    await db.query("update public.app_users set admin_workspace_role='reviewer' where id=$1", [id(1)]);
    assert.equal(await target(db, job), null);
    await db.query("update public.app_users set admin_workspace_role='owner',account_state='disabled' where id=$1", [id(1)]);
    assert.equal(await target(db, job), null);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.admin_review_email_deliveries'));
      await assert.rejects(db.query('select * from public.claim_admin_review_emails(1)'));
      await assert.rejects(db.query('select private.admin_review_email_account($1,$2)', [id(1), 'content_report']));
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await db.query('select count(*) from public.admin_review_email_deliveries')).rows[0].count, 1);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('expired retries are not sent after the idempotency window and rollbacks leave no orphan alerts', async () => {
  const db = await fixture(); try {
    await db.exec('begin');
    await db.query("insert into public.content_reports(id,target_label) values($1,'Rolled back')", [id(70)]);
    await db.exec('rollback'); assert.equal(await count(db, 'notifications'), 0);
    await db.query("insert into public.content_reports(id,target_label) values($1,'Test')", [id(71)]);
    await db.exec("update public.admin_review_email_deliveries set created_at=now()-interval '21 hours'");
    assert.equal(await claim(db), undefined);
    assert.equal((await db.query('select status,outcome from public.admin_review_email_deliveries')).rows[0].outcome, 'retry_expired');
    assert.equal(await count(db, 'notifications'), 1);
  } finally { await db.close(); }
});
