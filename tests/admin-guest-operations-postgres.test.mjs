import assert from 'node:assert/strict';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key,owner_user_id uuid,name text,is_active boolean,timezone text);
    create table venue_team_members(venue_id uuid,user_id uuid,role text,status text);
    create table dancer_profiles(id uuid primary key,user_id uuid,stage_name text,status text,verification_status text,disabled_at timestamptz);
    create table venue_dancer_affiliations(venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz,reentry_blocked boolean default false);
    create table shifts(dancer_id uuid,venue_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
    create type notification_type as enum ('support_message'); create type notification_channel as enum ('in_app','email','push');
    create table notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type notification_type,channel notification_channel,title text,body text,payload jsonb,sent_at timestamptz);
    create table venue_update_subscriptions(id uuid primary key,venue_id uuid,channel text,destination text,consented_at timestamptz default now(),withdrawn_at timestamptz);
    create table admin_actions(id uuid primary key default gen_random_uuid(),admin_id uuid,target_type text,target_id uuid,action text,notes text);
    grant usage on schema public to anon,authenticated,service_role; grant all on all tables in schema public to service_role;`);
  for (const name of ['20261007180000_private_venue_vip', '20261008070000_venue_vip_nicknames', '20261010093155_vip_shared_nicknames', '20261011201618_vip_dancer_status_notifications', '20261012020935_admin_guest_operations']) await db.exec(migration(name));
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('begin');
  for (const [n, role, state] of [[1, 'admin', 'active'], [2, 'venue', 'active'], [3, 'customer', 'active'], [4, 'admin', 'suspended'], [6, 'dancer', 'active']])
    await db.query('insert into app_users values($1,$2,$3)', [id(n), role, state]);
  await db.query("insert into venues values($1,$3,'Club A',true,'UTC'),($2,$3,'Club B',true,'UTC')", [id(10), id(20), id(2)]);
  await db.query("insert into dancer_profiles values($1,$2,'Dancer','approved','approved',null)", [id(50), id(6)]);
  await db.query("insert into venue_vip_members(id,venue_id,user_id,display_name,nickname) values($1,$2,$3,'Guest','Private label')", [id(30), id(10), id(3)]);
  await db.query("insert into venue_vip_requests(id,venue_id,user_id,guest_name,starts_at,timezone,dancers) values($1,$2,$3,'Guest',now()+interval '1 day','UTC',$4)", [id(40), id(10), id(3), JSON.stringify([{ id: id(50), name: 'Dancer' }])]);
  await db.query("insert into venue_update_subscriptions(id,venue_id,channel,destination) values($1,$3,'email','guest@example.test'),($2,$3,'text','+17025550123')", [id(60), id(61), id(10)]);
  await db.exec('set local role service_role');
});
afterEach(async () => db.exec('rollback'));
async function run(action, data, actor = 1, venue = 10) {
  return (await db.query('select admin_guest_operation($1,$2,$3,$4) value', [id(actor), id(venue), action, JSON.stringify(data)])).rows[0].value;
}
async function rejected(operation, code) {
  await db.exec('savepoint rejected'); await assert.rejects(operation, error => !code || error.code === code); await db.exec('rollback to savepoint rejected');
}
async function review(status = 'confirmed') {
  const r = (await db.query('select status,updated_at::text from venue_vip_requests where id=$1', [id(40)])).rows[0];
  return { id: id(40), status, expectedStatus: r.status, expectedUpdatedAt: r.updated_at, note: 'Welcome' };
}

test('guest controls require an active admin even through the server role; browsers cannot execute them', async () => {
  for (const actor of [2, 3, 4]) await rejected(() => run('revoke_member', { id: id(30) }, actor), '42501');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set local role ${role}`);
    await rejected(() => run('revoke_member', { id: id(30) }), '42501');
    await db.exec('set local role service_role');
  }
  assert.equal((await db.query('select active from venue_vip_members')).rows[0].active, true);
});
test('admin visit decisions preserve the existing transition and anonymous notification workflow', async () => {
  const result = await run('request_status', await review());
  assert.equal(result.request.status, 'confirmed');
  assert.equal(result.request.reviewed_by, id(1));
  assert.deepEqual(result.notifications.map(row => row.recipient_id).sort(), [id(3), id(6)].sort());
  const dancer = result.notifications.find(row => row.recipient_id === id(6));
  assert.doesNotMatch(JSON.stringify(dancer), /Private label|Guest|Welcome/);
  const audit = (await db.query('select * from admin_actions')).rows[0];
  assert.equal(audit.admin_id, id(1)); assert.equal(audit.action, 'guest_operations:request_status');
});
test('stale and cross-club visit decisions are rejected without a write or audit event', async () => {
  const data = await review();
  await rejected(() => run('request_status', data, 1, 20), 'P0002');
  await rejected(() => run('request_status', { ...data, expectedUpdatedAt: '2000-01-01T00:00:00Z' }), '40001');
  await rejected(() => run('request_status', { ...data, status: 'cancelled' }), '22023');
  assert.equal((await db.query('select count(*)::int n from admin_actions')).rows[0].n, 0);
});
test('a failed audit write rolls back the visit decision and notification rows', async () => {
  await db.exec(`reset role; create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_FAILED'; end $$;
    create trigger test_audit before insert on admin_actions for each row execute function fail_audit(); set local role service_role;`);
  const data = await review();
  await rejected(() => run('request_status', data), 'P0001');
  assert.equal((await db.query('select status from venue_vip_requests')).rows[0].status, 'pending');
  assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n, 0);
});
test('private nickname edits compare the previous label and never alter guest identity', async () => {
  await rejected(() => run('set_nickname', { id: id(30), nickname: 'New', expectedNickname: 'Old' }), '40001');
  await run('set_nickname', { id: id(30), nickname: 'New', expectedNickname: 'Private label' });
  assert.deepEqual((await db.query('select nickname,display_name from venue_vip_members')).rows[0], { nickname: 'New', display_name: 'Guest' });
});
test('unsubscribe affects only the chosen channel and rejects newer consent or another club', async () => {
  const consent = (await db.query('select consented_at::text from venue_update_subscriptions where id=$1', [id(60)])).rows[0].consented_at;
  await rejected(() => run('unsubscribe', { id: id(60), expectedConsentedAt: consent }, 1, 20), 'P0002');
  await rejected(() => run('unsubscribe', { id: id(60), expectedConsentedAt: '2000-01-01' }), '40001');
  await run('unsubscribe', { id: id(60), expectedConsentedAt: consent });
  const rows = (await db.query('select channel,withdrawn_at from venue_update_subscriptions order by channel')).rows;
  assert.ok(rows[0].withdrawn_at); assert.equal(rows[1].withdrawn_at, null);
  await rejected(() => run('subscribe', { id: id(60) }), '22023');
});
test('VIP invitations and revocations are club-scoped and audited', async () => {
  const invitation = await run('invite', { email: 'guest@example.test', nickname: '', digest: 'a'.repeat(64) });
  await rejected(() => run('revoke_invitation', { id: invitation.id }, 1, 20), '40001');
  await run('revoke_invitation', { id: invitation.id });
  await run('revoke_member', { id: id(30) });
  assert.equal((await db.query('select active from venue_vip_members')).rows[0].active, false);
  assert.equal((await db.query('select count(*)::int n from admin_actions')).rows[0].n, 3);
});
