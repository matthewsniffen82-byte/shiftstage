import assert from 'node:assert/strict';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = name => readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const id=n=>`98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let pg;
before(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table public.app_users(id uuid primary key,role text,account_state text,email text);
 create table public.customer_profiles(user_id uuid primary key,city text default 'Las Vegas',notification_settings jsonb default '{}');
 create table public.venues(id uuid primary key,name text,is_active boolean);
 create table public.venue_follows(customer_id uuid references app_users(id),venue_id uuid references venues(id),primary key(customer_id,venue_id));
 create table public.venue_customer_shares(customer_id uuid,venue_id uuid,name text,email text,city text,consent_version text,consented_at timestamptz,primary key(customer_id,venue_id),foreign key(customer_id,venue_id) references venue_follows on delete cascade);
 grant usage on schema public to anon,authenticated,service_role;
 grant select,insert,update on public.customer_profiles to authenticated;
 insert into venues values('${id(50)}','Test Club',true),('${id(51)}','Closed Club',false);`);
 await pg.exec(read('20261022140405_customer_email_explicit_consent.sql'));
 for(const n of [90,91]){await customer(n);await pg.query("select set_customer_email_preference($1,true,'account_preferences','customer-email-v1')",[id(n)]);}
 await pg.query("select set_customer_email_preference($1,false,'account_preferences',null)",[id(91)]);
 await pg.exec(read('20261025060937_customer_signup_choices.sql'));
});
after(async()=>pg?.close());beforeEach(()=>pg.exec('begin'));afterEach(()=>pg.exec('rollback'));
async function customer(n=1,{verified=true,token=null}={}){
 await pg.query('insert into auth.users values($1,$2,$3,$4)',[id(n),`guest${n}@example.test`,verified?'2026-10-01':null,JSON.stringify({role:'customer',customer_email_intent:token})]);
 await pg.query("insert into app_users values($1,'customer','active',$2)",[id(n),`guest${n}@example.test`]);
 await pg.query('insert into customer_profiles(user_id) values($1)',[id(n)]);
}
async function target(channel,n=1){return (await pg.query('select customer_email_channel_delivery_target($1,$2) result',[id(n),channel])).rows[0].result;}
async function settings(n=1){return (await pg.query('select notification_settings from customer_profiles where user_id=$1',[id(n)])).rows[0].notification_settings;}
async function set(channel,enabled,n=1,version='customer-email-v2') {return (await pg.query("select set_customer_email_channel_preference($1,$2,$3,'account_preferences',$4) result",[id(n),channel,enabled,version])).rows[0].result;}
async function intent({n=1,follow=false,marketing=false,venue=null,name='Guest One',city='Las Vegas',clubName='Test Club'}={}){
 return (await pg.query("select prepare_customer_signup_choices($1,'customer-email-v2',$2,$3,$4,$5,$6,$7) token",[`guest${n}@example.test`,follow,marketing,venue,clubName,name,city])).rows[0].token;
}
async function rejects(fn){await pg.exec('savepoint expected_failure');await assert.rejects(fn);await pg.exec('rollback to savepoint expected_failure');}
test('migration preserves explicit v1 subscriptions and withdrawals, including their receipts',async()=>{
 for(const channel of ['follow','marketing']) {assert.ok(await target(channel,90));assert.equal(await target(channel,91),null);}
 const events=(await pg.query('select channel,consent_version from customer_email_consent_events where user_id=$1',[id(90)])).rows;
 assert.deepEqual(events,[{channel:'all',consent_version:'customer-email-v1'}]);
});
test('each signup email combination remains independent and waits for verification',async()=>{
 for(const [n,follow,marketing] of [[1,false,false],[2,true,false],[3,false,true],[4,true,true]]){
  const token=await intent({n,follow,marketing});await customer(n,{verified:false,token});
  for(const channel of ['follow','marketing'])assert.equal(await target(channel,n),null);
  await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[id(n)]);
  assert.equal(Boolean(await target('follow',n)),follow);assert.equal(Boolean(await target('marketing',n)),marketing);
  const s=await settings(n);assert.equal(s.followEmailEnabled,follow);assert.equal(s.emailEnabled,marketing);
  const events=(await pg.query('select channel,enabled,consent_text from customer_email_consent_events where user_id=$1 order by channel',[id(n)])).rows;
  assert.deepEqual(events,[{channel:'follow',enabled:follow,consent_text:'Email me updates from dancers and clubs I follow.'},{channel:'marketing',enabled:marketing,consent_text:'Email me MyDancr offers and newsletters.'}]);
 }
});
test('changing one preference leaves the other channel and in-app choices intact',async()=>{
 await customer();await set('follow',true);assert.ok(await target('follow'));assert.equal(await target('marketing'),null);
 await set('marketing',true);await set('follow',false);assert.ok(await target('marketing'));assert.equal(await target('follow'),null);
 await set('follow',true);await set('marketing',false);assert.ok(await target('follow'));assert.equal(await target('marketing'),null);
 assert.equal((await settings()).workingTonight,true);
});
test('old unsubscribe links stop both categories and metadata edits cannot resubscribe',async()=>{
 const token=await intent({follow:true,marketing:true});await customer(1,{token});
 const link=(await target('follow')).token;
 await pg.query('select manage_customer_email_preference($1,true)',[link]);
 await pg.query("update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('customer_email_intent',$1::text) where id=$2",[token,id(1)]);
 assert.equal(await target('follow'),null);assert.equal(await target('marketing'),null);
});
test('address changes fail closed and do not transfer the other preference',async()=>{
 await customer();await set('follow',true);await set('marketing',true);
 await pg.query("update auth.users set email='changed@example.test' where id=$1",[id(1)]);
 await pg.query("update app_users set email='changed@example.test' where id=$1",[id(1)]);
 assert.equal(await target('follow'),null);assert.equal(await target('marketing'),null);
 await set('follow',true);assert.ok(await target('follow'));assert.equal(await target('marketing'),null);
});
test('forged, expired and replayed intents cannot give another account consent',async()=>{
 const token=await intent({follow:true});await customer(2,{token});assert.equal(await target('follow',2),null);
 await pg.query('update customer_email_signup_intents set expires_at=now()-interval \'1 minute\' where token=$1',[token]);
 await customer(1,{token});assert.equal(await target('follow'),null);
 await rejects(()=>intent({venue:id(50),clubName:'Forged Club'}));await rejects(()=>intent({venue:id(51),clubName:'Closed Club'}));
 await rejects(()=>intent({venue:id(50),name:'x'}));
});
test('sharing exposes only the checked club after verification, with no email subscription',async()=>{
 const token=await intent({venue:id(50)});await customer(1,{verified:false,token});
 assert.equal((await pg.query('select * from venue_customer_shares')).rows.length,0);
 assert.equal((await pg.query('select * from venue_follows')).rows.length,0);
 await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[id(1)]);
 const share=(await pg.query('select * from venue_customer_shares')).rows;assert.equal(share.length,1);
 assert.equal(share[0].venue_id,id(50));assert.equal(share[0].email,'guest1@example.test');assert.equal(share[0].name,'Guest One');
 assert.equal(await target('follow'),null);assert.equal(await target('marketing'),null);
 await pg.query('delete from venue_customer_shares where customer_id=$1',[id(1)]);
 await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[id(1)]);
 assert.equal((await pg.query('select * from venue_customer_shares')).rows.length,0,'withdrawn share cannot reappear');
});
test('unverified, inactive and closed-club accounts cannot finalize a share',async()=>{
 const token=await intent({venue:id(50)});await customer(1,{verified:false,token});
 await pg.query("update app_users set account_state='disabled' where id=$1",[id(1)]);
 await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[id(1)]);
 assert.equal((await pg.query('select * from venue_customer_shares')).rows.length,0);
 await pg.query('update venues set is_active=false where id=$1',[id(50)]);
 await pg.query("update app_users set account_state='active' where id=$1",[id(1)]);
 assert.equal((await pg.query('select * from venue_customer_shares')).rows.length,0);
});
test('normal signup never creates club sharing; public roles cannot forge consent',async()=>{
 await customer();assert.equal((await pg.query('select * from venue_customer_shares')).rows.length,0);
 for(const role of ['anon','authenticated']){
  await pg.exec(`set local role ${role}`);await rejects(()=>set('follow',true));
  await rejects(()=>pg.query('select * from customer_signup_venue_shares'));await rejects(()=>intent({follow:true}));
  if(role==='authenticated')await rejects(()=>pg.query(`update customer_profiles set notification_settings=notification_settings||'{"followEmailEnabled":true}' where user_id=$1`,[id(1)]));
  await pg.exec('reset role');
 }
 await customer(2,{verified:false});await rejects(()=>set('follow',true,2));
 await rejects(()=>set('follow',true,1,'obsolete'));
});
