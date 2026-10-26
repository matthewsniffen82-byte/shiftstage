import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync('supabase/migrations/20261026032859_durable_email_actions.sql', 'utf8');
const id = n => `98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,encrypted_password text check(encrypted_password <> 'rejected'));
    create table public.app_users(id uuid primary key, email text, role text, account_state text);
    create table public.venues(id uuid primary key, owner_user_id uuid);
    create table public.venue_team_members(id uuid primary key default gen_random_uuid(),venue_id uuid,user_id uuid,role text,status text,invited_by_user_id uuid,joined_at timestamptz,removed_at timestamptz,updated_at timestamptz,unique(venue_id,user_id));
    create table public.venue_team_invitations(id uuid primary key default gen_random_uuid(),expires_at timestamptz not null,accepted_at timestamptz,revoked_at timestamptz,venue_id uuid,email text,role text,invited_by_user_id uuid,accepted_by_user_id uuid,updated_at timestamptz);
    create table public.venue_vip_invitations(like public.venue_team_invitations including all);
    insert into public.venue_team_invitations(expires_at) values(now()-interval '30 days');
    insert into public.venue_vip_invitations(expires_at,revoked_at) values(now()-interval '30 days',now());`);
  await db.exec(migration);
  await db.query('insert into auth.users values($1,$2,$3)', [id(1),'guest@example.invalid','old-hash']);
  return db;
}
const rows = async db => (await db.query('select purpose,completed_at,revoked_at from public.account_email_actions order by purpose')).rows;
test('team invitation completion retries retain the same membership and cannot restore removed access', async () => {
  const db = await fixture();
  try {
    await db.query("insert into public.app_users values($1,'team@example.invalid','venue','active'),($2,'other@example.invalid','venue','active')",[id(2),id(3)]);
    await db.query("insert into public.venue_team_invitations(id,venue_id,email,role,invited_by_user_id) values($1,$2,'team@example.invalid','manager',$3)",[id(4),id(5),id(1)]);
    const first = (await db.query('select * from public.redeem_venue_team_invitation($1,$2)',[id(4),id(2)])).rows[0];
    const retry = (await db.query('select * from public.redeem_venue_team_invitation($1,$2)',[id(4),id(2)])).rows[0];
    assert.equal(retry.id,first.id);
    await assert.rejects(db.query('select * from public.redeem_venue_team_invitation($1,$2)',[id(4),id(3)]));
    await db.query("update public.venue_team_members set status='removed' where id=$1",[first.id]);
    await assert.rejects(db.query('select * from public.redeem_venue_team_invitation($1,$2)',[id(4),id(2)]));
  } finally { await db.close(); }
});
test('failed password writes leave recovery links available; a committed password change closes them atomically', async () => {
  const db = await fixture();
  try {
    for (const purpose of ['recovery','confirmation']) await db.query('insert into public.account_email_actions(user_id,purpose,email) values($1,$2,$3)', [id(1),purpose,'guest@example.invalid']);
    await assert.rejects(db.query('update auth.users set encrypted_password=$1 where id=$2', ['rejected',id(1)]));
    assert.ok((await rows(db)).every(row => !row.completed_at && !row.revoked_at));
    await db.query('update auth.users set encrypted_password=$1 where id=$2', ['new-hash',id(1)]);
    const result = await rows(db);
    assert.ok(result.find(row => row.purpose === 'recovery').completed_at);
    assert.ok(result.find(row => row.purpose === 'confirmation').revoked_at);
  } finally { await db.close(); }
});
test('successful email change closes the matching two-inbox request and revokes credentials tied to the old address', async () => {
  const db = await fixture();
  try {
    await db.query("insert into public.account_email_actions(user_id,purpose,email,new_email,current_confirmed_at,new_confirmed_at) values($1,'email_change','guest@example.invalid','new@example.invalid',now(),now())",[id(1)]);
    await db.query("insert into public.account_email_actions(user_id,purpose,email) values($1,'recovery','guest@example.invalid')",[id(1)]);
    await db.query("update auth.users set email='new@example.invalid' where id=$1",[id(1)]);
    const result = await rows(db);
    assert.ok(result.find(row => row.purpose === 'email_change').completed_at);
    assert.ok(result.find(row => row.purpose === 'recovery').revoked_at);
  } finally { await db.close(); }
});
test('pending invitations have no deadline, including older unaccepted links, while revoked invitations stay revoked', async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query('select expires_at from public.venue_team_invitations')).rows[0].expires_at,null);
    assert.ok((await db.query('select revoked_at from public.venue_vip_invitations')).rows[0].revoked_at);
    for (const table of ['venue_team_invitations','venue_vip_invitations']) {
      const added = await db.query(`insert into public.${table}(expires_at) values(now()+interval '7 days') returning expires_at`);
      assert.equal(added.rows[0].expires_at,null);
    }
  } finally { await db.close(); }
});
test('email-action records and trigger functions are inaccessible to public and signed-in browser roles', async () => {
  const db = await fixture();
  try {
    for (const role of ['anon','authenticated']) {
      const privileges = await db.query(`select has_table_privilege('${role}','public.account_email_actions','select') as can_read,
        has_table_privilege('${role}','public.account_email_actions','update') as can_write,
        has_function_privilege('${role}','private.close_account_email_actions_on_credentials()','execute') as can_execute`);
      assert.deepEqual(privileges.rows[0], { can_read:false,can_write:false,can_execute:false });
    }
  } finally { await db.close(); }
});
