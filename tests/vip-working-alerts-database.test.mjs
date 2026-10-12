import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const id = n => `96000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table public.app_users(id uuid primary key,role text,account_state text);
      create table public.venues(id uuid primary key,owner_user_id uuid,name text,is_active boolean,timezone text);
      create table public.venue_team_members(venue_id uuid,user_id uuid,role text,status text);
      create table public.dancer_profiles(id uuid primary key,user_id uuid,stage_name text,status text,verification_status text,disabled_at timestamptz,is_public boolean);
      create table public.venue_dancer_affiliations(venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz,reentry_blocked boolean default false);
      create table public.shifts(id uuid primary key,dancer_id uuid,venue_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
      create table public.customer_profiles(user_id uuid primary key,notification_settings jsonb);
      create type public.notification_type as enum ('support_message','shift_updated');
      create type public.notification_channel as enum ('in_app','email','push');
      create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type public.notification_type,channel public.notification_channel,title text,body text,payload jsonb,sent_at timestamptz);
      grant usage on schema public to anon,authenticated,service_role;`);
    for (const name of ['20261007180000_private_venue_vip.sql','20261012001400_vip_working_alerts.sql']) {
      await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.exec('grant select on app_users,venues,dancer_profiles,customer_profiles to service_role; grant select,update on shifts to service_role; grant select,insert on notifications to service_role;');
    for (const [n, role] of [[1,'venue'],[2,'customer'],[3,'customer'],[4,'dancer']]) await db.query("insert into app_users values($1,$2,'active')",[id(n),role]);
    await db.query("insert into venues values($1,$3,'Club A',true,'UTC'),($2,$3,'Club B',true,'UTC')",[id(10),id(11),id(1)]);
    await db.query("insert into dancer_profiles values($1,$2,'Aria','approved','approved',null,true)",[id(20),id(4)]);
    await db.query("insert into venue_dancer_affiliations(venue_id,dancer_id,status) values($1,$3,'active'),($2,$3,'active')",[id(10),id(11),id(20)]);
    await db.query("insert into venue_vip_members(venue_id,user_id,display_name) values($1,$3,'VIP A'),($2,$3,'VIP A'),($1,$4,'VIP B')",[id(10),id(11),id(2),id(3)]);
    await db.exec('set role service_role');
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function admin(db, sql, params=[]) { await db.exec('reset role'); try { return await db.query(sql,params); } finally { await db.exec('set role service_role'); } }
async function enable(db, {actor=2,venue=10,dancer=20,enabled=true}={}) { return (await db.query('select vip_set_working_alert($1,$2,$3,$4) value',[id(actor),id(venue),id(dancer),enabled])).rows[0].value; }
async function checkIn(db, venue=10, shift=30) { await admin(db,"insert into shifts values($1,$2,$3,'posted',now(),null,'club_confirmed',now()+interval '6 hours')",[id(shift),id(20),id(venue)]); }
async function emit(db, shift=30) { return (await db.query('select vip_emit_working_alerts($1) value',[id(shift)])).rows[0].value; }
const denied = (promise,code) => assert.rejects(promise,error=>error.code===code);

test('working alerts are explicit, club-specific, replay-safe, and independent of favorites or public follows',async()=>{
  const db=await fixture(); try {
    assert.equal(await enable(db),true); assert.equal(await enable(db),true);
    await checkIn(db); const first=await emit(db);
    assert.equal(first.notifications.length,1); assert.deepEqual(first.recipientIds,[id(2)]);
    assert.equal(first.notifications[0].payload.kind,'vip_dancer_working_now');
    assert.equal(first.notifications[0].payload.venueId,id(10));
    assert.match(first.notifications[0].body,/Aria checked in at Club A/);
    assert.equal((await emit(db)).notifications.length,0);
    await admin(db,'delete from notifications');
    assert.equal(await enable(db,{enabled:false}),false); await enable(db);
    assert.equal((await emit(db)).notifications.length,0,'clearing inbox or toggling cannot duplicate the event');
    await checkIn(db,11,31); assert.equal((await emit(db,31)).notifications.length,0);
    await enable(db,{venue:11}); assert.equal((await emit(db,31)).notifications.length,0,'opting in does not replay an existing shift');
    await checkIn(db,11,32); assert.equal((await emit(db,32)).notifications.length,1);
  } finally {await db.close();}
});

test('server-only preferences validate membership, active accounts, eligible public dancers, and allow muting unavailable dancers',async()=>{
  const db=await fixture();try {
    await denied(enable(db,{actor:1}),'42501'); await denied(enable(db,{venue:99}),'42501');
    await denied(enable(db,{dancer:99}),'40001'); await denied(enable(db,{enabled:null}),'22023');
    await enable(db);
    await admin(db,'update dancer_profiles set is_public=false');
    await denied(enable(db),'40001'); assert.equal(await enable(db,{enabled:false}),false);
    await admin(db,"update app_users set account_state='paused' where id=$1",[id(2)]);
    await denied(enable(db),'42501');
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await denied(enable(db),'42501'); await denied(emit(db),'42501');
      await denied(db.query('select * from venue_vip_working_alerts'),'42501');
      await denied(db.query('select * from venue_vip_working_alert_receipts'),'42501');
    }
    await db.exec('reset role');
    const rls=await db.query("select relrowsecurity from pg_class where relname in ('venue_vip_working_alerts','venue_vip_working_alert_receipts')");
    assert.ok(rls.rows.every(r=>r.relrowsecurity));
  } finally {await db.close();}
});

test('fanout rechecks current presence, privacy, membership, venue owners, and global mutes',async()=>{
  const db=await fixture(); try {
    await enable(db); await enable(db,{actor:3}); await checkIn(db);
    const cases=[
      ["update shifts set checked_out_at=now()","update shifts set checked_out_at=null"],
      ["update shifts set status='cancelled'","update shifts set status='posted'"],
      ["update shifts set location_status='self_reported'","update shifts set location_status='club_confirmed'"],
      ["update shifts set location_verification_expires_at=now()-interval '1 minute'","update shifts set location_verification_expires_at=now()+interval '1 hour'"],
      ["update dancer_profiles set is_public=false","update dancer_profiles set is_public=true"],
      ["update dancer_profiles set disabled_at=now()","update dancer_profiles set disabled_at=null"],
      ["update venue_dancer_affiliations set reentry_blocked=true","update venue_dancer_affiliations set reentry_blocked=false"],
      ["update venues set is_active=false","update venues set is_active=true"],
      ["update app_users set account_state='paused'","update app_users set account_state='active'"],
      ["update venue_vip_members set active=false","update venue_vip_members set active=true"],
    ];
    for(const [change,restore] of cases){await admin(db,change);assert.equal((await emit(db)).notifications.length,0,change);await admin(db,restore);}
    await admin(db,"insert into customer_profiles values($1,'{\"followAlertsEnabled\":false}'),($2,'{\"workingNow\":false}')",[id(2),id(3)]);
    assert.equal((await emit(db)).notifications.length,0);
    await admin(db,"update customer_profiles set notification_settings='{}' where user_id=$1",[id(2)]);
    assert.deepEqual((await emit(db)).recipientIds,[id(2)]);
    await admin(db,"update customer_profiles set notification_settings='{}'");
    assert.deepEqual((await emit(db)).notifications.map(n=>n.recipient_id),[id(3)]);
  } finally {await db.close();}
});
