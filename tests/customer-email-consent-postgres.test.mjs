import assert from 'node:assert/strict';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let pg;
before(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table public.app_users(id uuid primary key,role text,account_state text,email text);
 create table public.customer_profiles(user_id uuid primary key,city text default 'Las Vegas',notification_settings jsonb default '{}');
 grant usage on schema public to anon,authenticated,service_role;
 grant select,insert,update on public.customer_profiles to authenticated;
 insert into auth.users(id,email,email_confirmed_at) values('${id(99)}','legacy@example.test',now());
 insert into customer_profiles(user_id,notification_settings) values('${id(99)}','{"emailEnabled":true,"pushEnabled":false}');`);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261022140405_customer_email_explicit_consent.sql',import.meta.url),'utf8'));
});
after(async()=>pg?.close());
beforeEach(()=>pg.exec('begin'));
afterEach(()=>pg.exec('rollback'));
async function customer(n=1,{verified=true,metadata={}}={}){
 await pg.query('insert into auth.users values($1,$2,$3,$4)',[id(n),`guest${n}@example.test`,verified?'2026-10-01':null,JSON.stringify(metadata)]);
 await pg.query("insert into app_users values($1,'customer','active',$2)",[id(n),`guest${n}@example.test`]);
 await pg.query('insert into customer_profiles(user_id) values($1)',[id(n)]);
}
async function set(enabled=true,n=1,version='customer-email-v1',source='account_preferences'){
 return (await pg.query('select set_customer_email_preference($1,$2,$3,$4) result',[id(n),enabled,source,version])).rows[0].result;
}
async function target(n=1){return (await pg.query('select customer_email_delivery_target($1) result',[id(n)])).rows[0].result;}
async function manage(token,stop=true){return (await pg.query('select manage_customer_email_preference($1,$2) result',[token,stop])).rows[0].result;}
async function rejects(fn){await pg.exec('savepoint expected_failure');await assert.rejects(fn);await pg.exec('rollback to savepoint expected_failure');}

test('migration turns old default-enabled accounts off without changing push or inventing consent',async()=>{
 const row=(await pg.query('select notification_settings from customer_profiles where user_id=$1',[id(99)])).rows[0];
 assert.deepEqual(row.notification_settings,{emailEnabled:false,pushEnabled:false});
 assert.equal(await target(99),null);
 const event=(await pg.query('select * from customer_email_consent_events where user_id=$1',[id(99)])).rows[0];
 assert.equal(event.source,'legacy_default_reset');assert.equal(event.enabled,false);assert.equal(event.consent_version,null);
});
test('new accounts stay off and explicit verified consent creates a versioned receipt and delivery token',async()=>{
 await customer();assert.equal(await target(),null);
 assert.equal((await pg.query('select notification_settings from customer_profiles')).rows.find(r=>r.notification_settings.emailEnabled===true),undefined);
 const profile=await set();assert.equal(profile.notificationSettings.emailEnabled,true);
 const delivery=await target();assert.equal(delivery.email,'guest1@example.test');assert.match(delivery.token,/^[a-f0-9]{64}$/);
 const event=(await pg.query('select * from customer_email_consent_events where user_id=$1',[id(1)])).rows[0];
 assert.equal(event.source,'account_preferences');assert.equal(event.consent_version,'customer-email-v1');assert.ok(event.recorded_at);assert.match(event.consent_text,/Optional; unsubscribe/);
});
test('unverified, wrong-role, inactive, invalid source and old consent wording cannot subscribe',async()=>{
 await customer(1,{verified:false});await rejects(()=>set());
 await customer(2);await pg.query("update app_users set role='dancer' where id=$1",[id(2)]);await rejects(()=>set(true,2));
 await customer(3);await rejects(()=>set(true,3,'old'));await rejects(()=>set(true,3,'customer-email-v1','forged'));
 await pg.query("update app_users set account_state='disabled' where id=$1",[id(3)]);await rejects(()=>set(true,3));
 assert.equal(await target(3),null);
});
test('public and authenticated roles cannot call privileged functions or forge profile email consent',async()=>{
 await customer();
 for(const role of ['anon','authenticated']){
  await pg.exec(`set local role ${role}`);await rejects(()=>set());
  await rejects(()=>pg.query('select * from customer_email_preferences'));await pg.exec('reset role');
 }
 await pg.exec('set local role authenticated');
 await rejects(()=>pg.query(`update customer_profiles set notification_settings='{"emailEnabled":true}' where user_id=$1`,[id(1)]));
 await pg.query(`update customer_profiles set notification_settings=notification_settings||'{"pushEnabled":false}' where user_id=$1`,[id(1)]);
 await pg.exec('reset role');assert.equal(await target(),null);
});
test('unsubscribe is anonymous, idempotent, preserves other choices and stops all future delivery',async()=>{
 await customer();await set();const {token}=await target();
 await pg.query(`update customer_profiles set notification_settings=notification_settings||'{"clubDeals":false,"pushEnabled":true}' where user_id=$1`,[id(1)]);
 assert.deepEqual(await manage(token,false),{active:true});assert.deepEqual(await manage(token),{active:false});assert.deepEqual(await manage(token),{active:false});
 assert.equal(await target(),null);
 const profile=(await pg.query('select notification_settings from customer_profiles where user_id=$1',[id(1)])).rows[0].notification_settings;
 assert.equal(profile.emailEnabled,false);assert.equal(profile.clubDeals,false);assert.equal(profile.pushEnabled,true);assert.equal(profile.workingTonight,true);
 assert.equal((await pg.query("select count(*)::int n from customer_email_consent_events where source='email_link'")).rows[0].n,1);
 await set();const again=await target();assert.notEqual(again.token,token);await rejects(()=>manage(token));
});
test('delivery fails closed after email changes, even when the old preference remains true',async()=>{
 await customer();await set();await pg.query("update auth.users set email='changed@example.test' where id=$1",[id(1)]);
 assert.equal(await target(),null);
});
test('signup records only a server-issued matching intent on a new identity and waits for email verification',async()=>{
 const token=(await pg.query("select prepare_customer_email_signup('guest1@example.test','customer-email-v1') token")).rows[0].token;
 await customer(1,{verified:false,metadata:{role:'customer',customer_email_intent:token}});
 assert.equal(await target(),null);
 await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[id(1)]);assert.ok(await target());
 const {token:link}=await target();await manage(link);
 await pg.query("update auth.users set raw_user_meta_data=raw_user_meta_data||'{\"customer_email_intent\":\""+token+"\"}' where id=$1",[id(1)]);
 assert.equal(await target(),null);
 await customer(2,{metadata:{role:'customer',customer_email_intent:token}});assert.equal(await target(2),null);
});
