import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const folder = 'supabase/migrations/';
const base = readFileSync(folder + '20261029030601_admin_review_email_alerts.sql', 'utf8');
const cases = readFileSync(folder + '20261031020951_internal_case_operations.sql', 'utf8');
const aliases = readFileSync(folder + readdirSync(folder).find(name => name.endsWith('_email_alias_routing.sql')), 'utf8');
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
    create table public.content_reports(id uuid primary key,target_label text,status text default 'open',case_kind text);
    create table public.dmca_cases(id uuid primary key,status text default 'received');
    create table public.dmca_counter_notices(id uuid primary key,case_id uuid);
    create table public.dancer_profiles(id uuid primary key,user_id uuid,stage_name text);
    create table public.image_moderation_records(id uuid primary key,user_id uuid,decision text,upload_context text,club_reviewed_at timestamptz);
    create table public.mydancr_tv_videos(id uuid primary key,dancer_id uuid,status text,upload_validation_pending boolean,moderation_details jsonb,club_reviewed_at timestamptz);
    grant select on public.app_users,public.content_reports to service_role;`);
  await db.exec(base);
  await db.exec(cases.slice(cases.indexOf('alter table public.admin_review_email_deliveries alter column'), cases.indexOf('create function public.enqueue_case_alerts()')));
  await db.exec(aliases);
  return db;
}
async function event(db, key, kind, source = id(80)) {
  await db.query("insert into public.admin_review_email_events(event_key,kind,source_id,title,body) values($1,$2,$3,'Review','Open private queue') on conflict do nothing", [key, kind, source]);
}
async function target(db, key, mailbox) {
  const job = (await db.query("update public.admin_review_email_deliveries set status='sending',lease_id=gen_random_uuid(),lease_until=now()+interval '1 minute' where event_key=$1 and mailbox=$2 returning id,lease_id", [key, mailbox])).rows[0];
  return (await db.query('select public.admin_review_email_target($1,$2) as target', [job.id, job.lease_id])).rows[0].target;
}

test('new review events get exactly one shared copy and each category resolves to its allowed alias', async () => {
  const db = await fixture();
  try {
    for (const kind of ['club_application', 'deal_request', 'page_changes', 'media_approval', 'copyright_case']) {
      await event(db, kind, kind); await event(db, kind, kind);
      const mailbox = kind === 'copyright_case' ? 'dmca@mydancr.com' : 'approvals@mydancr.com';
      assert.equal((await target(db, kind, mailbox)).email, mailbox);
    }
    assert.equal((await db.query('select count(*)::int as n from public.admin_review_email_deliveries')).rows[0].n, 5);
    await event(db, 'compliance:new', 'content_report');
    assert.equal((await db.query("select count(*)::int as n from public.admin_review_email_deliveries where event_key='compliance:new'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('wrong-category aliases, changed destinations and closed safety cases cannot be sent', async () => {
  const db = await fixture();
  try {
    await event(db, 'review', 'media_approval');
    await db.query("insert into public.admin_review_email_deliveries(event_key,mailbox) values('review','dmca@mydancr.com')");
    assert.equal(await target(db, 'review', 'dmca@mydancr.com'), null);
    await db.query("update public.admin_review_email_deliveries set destination='old@example.invalid' where event_key='review' and mailbox='approvals@mydancr.com'");
    assert.equal(await target(db, 'review', 'approvals@mydancr.com'), null);
    await assert.rejects(db.query("insert into public.admin_review_email_deliveries(event_key,mailbox) values('review','arbitrary@example.invalid')"));
    await assert.rejects(db.query("insert into public.admin_review_email_deliveries(event_key) values('review')"));
    await db.query("insert into public.content_reports(id,case_kind) values($1,'safety')", [id(80)]);
    await event(db, 'compliance:case', 'content_report');
    await db.query("insert into public.admin_review_email_deliveries(event_key,mailbox) values('compliance:case','safety@mydancr.com')");
    const open = await target(db, 'compliance:case', 'safety@mydancr.com');
    assert.equal(open.kind, 'compliance_case');
    assert.equal(open.email, 'safety@mydancr.com');
    await db.query("update public.content_reports set status='resolved' where id=$1", [id(80)]);
    assert.equal(await target(db, 'compliance:case', 'safety@mydancr.com'), null);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.admin_review_email_deliveries'));
      await assert.rejects(db.query('select public.admin_review_email_target($1,$2)', [id(1), id(2)]));
      await assert.rejects(db.query('select private.queue_admin_review_alias()'));
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
