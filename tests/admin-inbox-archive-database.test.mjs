import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111', support = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333', id2 = '44444444-4444-4444-8444-444444444444';
const version = '2026-10-26T01:00:00Z';
const migration = readFileSync('supabase/migrations/20261026185931_admin_inbox_archive.sql', 'utf8');
const tables = { support: 'support_threads', deal_request: 'venue_club_deal_requests', club_application: 'venue_signup_requests', page_change: 'venues' };

test('archive is reversible, atomic, staff-scoped, and new activity reopens every inbox category', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema private;
      create table app_users(id uuid primary key, role text, account_state text, admin_workspace_role text);
      create table admin_actions(id uuid default gen_random_uuid(),admin_id uuid references app_users(id),target_type text,target_id uuid,action text,notes text);
      create table support_threads(id uuid primary key,subject text,status text,created_at timestamptz default now(),updated_at timestamptz,last_message_at timestamptz);
      create table support_messages(id uuid primary key default gen_random_uuid(),thread_id uuid,body text,created_at timestamptz default now());
      create table venue_club_deal_requests(id uuid primary key,venue_id uuid,status text,offer_title text,request_notes text,created_at timestamptz default now(),updated_at timestamptz);
      create table venue_signup_requests(id uuid primary key,venue_name text,status text,message text,submitted_at timestamptz default now(),updated_at timestamptz);
      create table venues(id uuid primary key,name text,page_review_status text,page_review_notes text,page_reviewed_at timestamptz,updated_at timestamptz,is_active boolean default false);
      grant usage on schema public,private to service_role,authenticated;
      grant all on all tables in schema public to service_role;
      grant select,insert,update on support_threads to authenticated;
      insert into app_users values('${owner}','admin','active','owner'),('${support}','admin','active','support');
      insert into support_threads values('${id}','Help','open',now(),'${version}','${version}'),('${id2}','Second','open',now(),'${version}','${version}');
      insert into support_messages(thread_id,body) values('${id}','Original message');
      insert into venues(id,name,page_review_status,page_review_notes,page_reviewed_at,updated_at) values('${id}','Test club','changes_requested','Update hours','${version}','${version}');
      insert into venue_club_deal_requests(id,venue_id,status,offer_title,request_notes,updated_at) values('${id}','${id}','pending','Free admission','Test request','${version}');
      insert into venue_signup_requests(id,venue_name,status,message,updated_at) values('${id}','New club','pending','Please review','${version}');`);
    await db.exec(migration);
    const call = async (action, items, actor = owner) => (await db.query('select set_admin_inbox_archive($1,$2,$3::jsonb) result', [actor, action, JSON.stringify(items)])).rows[0].result;
    const item = (kind, itemId = id, v = version) => ({ kind, id: itemId, version: v });
    const row = async kind => (await db.query(`select * from ${tables[kind]} where id=$1`, [id])).rows[0];

    await t.test('only service callers can invoke the RPC or read the archive', async () => {
      await db.exec('set role authenticated');
      await assert.rejects(call('archive', [item('support')]), /permission denied/);
      await assert.rejects(db.query('select * from admin_inbox_archive'), /permission denied/);
      await assert.rejects(db.query("update support_threads set admin_archived_at=now() where id=$1", [id]), /Only staff/);
      await db.exec('reset role; set role service_role');
    });
    await t.test('support staff cannot archive other requests and mixed batches roll back', async () => {
      await assert.rejects(call('archive', [item('support'),item('deal_request')], support), /staff role/);
      assert.equal((await row('support')).admin_archived_at, null);
      await assert.rejects(call('archive', [item('support'),item('support',id2,'2020-01-01')]), /new activity/);
      assert.equal((await row('support')).admin_archived_at, null);
    });
    await t.test('archive preserves all decisions and original content and writes audit records', async () => {
      assert.equal((await call('archive',Object.keys(tables).map(kind => item(kind)))).changed,4);
      assert.equal((await db.query('select * from admin_inbox_archive')).rows.length,4);
      for(const kind of Object.keys(tables)) assert.ok((await row(kind)).admin_archived_at);
      assert.equal((await row('support')).status,'open');
      assert.equal((await row('deal_request')).status,'pending');
      assert.equal((await row('club_application')).status,'pending');
      assert.equal((await row('page_change')).page_review_status,'changes_requested');
      assert.equal((await row('page_change')).is_active,false);
      assert.equal((await row('support')).admin_archive_summary.detail,'Original message');
      assert.equal((await db.query('select * from admin_actions')).rows.length,4);
      assert.equal((await call('archive',[item('support')])).changed,0);
    });
    await t.test('restore returns archived records without changing business status', async () => {
      const record=await row('support');
      await assert.rejects(call('restore',[item('support')]), /archive changed/);
      assert.equal((await call('restore',[item('support',id,record.admin_archived_at.toISOString())],support)).changed,1);
      assert.equal((await row('support')).admin_archived_at,null);
      assert.equal((await row('support')).status,'open');
      assert.equal((await call('archive',[item('support')],support)).changed,1);
    });
    await t.test('routine updated_at changes do not reopen archives, incoming messages and resubmissions do', async () => {
      for(const kind of Object.keys(tables)) {
        await db.query(`update ${tables[kind]} set updated_at=now() where id=$1`,[id]);
        assert.ok((await row(kind)).admin_archived_at);
      }
      await db.query("update support_threads set last_message_at=now(),status='open' where id=$1",[id]);
      await db.query("update venue_club_deal_requests set request_notes='New details' where id=$1",[id]);
      await db.query("update venue_signup_requests set message='New details' where id=$1",[id]);
      await db.query("update venues set page_review_notes='New details',page_reviewed_at=now() where id=$1",[id]);
      for(const kind of Object.keys(tables)) { assert.equal((await row(kind)).admin_archived_at,null); assert.equal((await row(kind)).admin_archive_summary,null); }
    });
    await t.test('invalid actors, oversized and duplicate batches are rejected', async () => {
      await assert.rejects(call('archive',[item('support')],id2),/Admin access/);
      await assert.rejects(call('archive',[item('support'),item('support')]),/only once/);
      await assert.rejects(call('archive',[]),/between 1 and 100/);
      await assert.rejects(call('archive',Array.from({length:101},()=>item('support'))),/between 1 and 100/);
    });
  } finally { await db.close(); }
});
