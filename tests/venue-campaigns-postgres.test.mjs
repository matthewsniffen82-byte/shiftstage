import assert from 'node:assert/strict';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let pg;
before(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table public.app_users(id uuid primary key,email text,role text,account_state text);
 create table public.customer_profiles(user_id uuid primary key,notification_settings jsonb);
 create table public.customer_email_preferences(user_id uuid primary key,enabled boolean,email text,manage_token text);
 create table public.venues(id uuid primary key,name text,address text,city text,state text,owner_user_id uuid,is_active boolean);
 create table public.venue_team_members(venue_id uuid,user_id uuid,status text,role text);
 create table public.venue_update_subscriptions(id uuid primary key,venue_id uuid,channel text,destination text,consented_at timestamptz default now(),withdrawn_at timestamptz);
 create table public.venue_follows(customer_id uuid,venue_id uuid,notifications_enabled boolean default true);
 create type public.notification_type as enum ('engagement');create type public.notification_channel as enum ('in_app','email','push');
 create table public.notifications(id uuid primary key,recipient_id uuid,notification_type public.notification_type,channel public.notification_channel,title text,body text,payload jsonb);
 create table public.web_push_subscriptions(user_id uuid);
 create function public.customer_email_channel_delivery_target(p_user_id uuid,p_channel text) returns jsonb language sql security definer as $$
 select jsonb_build_object('email',p.email,'token',p.manage_token) from public.customer_email_preferences p
 join public.app_users a on a.id=p.user_id join auth.users u on u.id=p.user_id
 join public.customer_profiles cp on cp.user_id=p.user_id
 where p.user_id=p_user_id and p.enabled and p_channel='marketing' and cp.notification_settings->'emailEnabled'='true'::jsonb
 and p.email=u.email and p.email=a.email and u.email_confirmed_at is not null and a.account_state='active'
 $$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 grant all on all tables in schema public to service_role;`);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261026064539_venue_update_campaigns.sql',import.meta.url),'utf8'));
});
after(async()=>pg?.close());
beforeEach(async()=>{
 await pg.exec('begin');
 for(const n of [1,2,3,4])await pg.query("insert into app_users values($1,$2,'venue','active')",[id(n),`owner${n}@example.test`]);
 await pg.query("insert into venues values($1,'Club A','1 Main St','Las Vegas','NV',$3,true),($2,'Club B','2 Main St','Las Vegas','NV',$4,true)",[id(10),id(20),id(1),id(2)]);
 await pg.query("insert into venue_team_members values($1,$2,'active','manager'),($1,$3,'active','staff')",[id(10),id(3),id(4)]);
 await customer(101);await customer(102);await customer(103);await customer(104);await customer(105);
 await pg.query('insert into venue_follows values($1,$2,true),($3,$2,false),($4,$5,true)',[id(101),id(10),id(104),id(103),id(20)]);
 await pg.query("insert into venue_update_subscriptions(id,venue_id,channel,destination) values($1,$2,'email',$3),($4,$2,'email','anonymous@example.test')",[id(300),id(10),'102@example.test',id(301)]);
});
afterEach(async()=>pg.exec('rollback'));
async function customer(n){
 await pg.query("insert into app_users values($1,$2,'customer','active')",[id(n),`${n}@example.test`]);
 await pg.query('insert into auth.users values($1,$2,now())',[id(n),`${n}@example.test`]);
 await pg.query(`insert into customer_profiles values($1,'{"followAlertsEnabled":true,"clubDeals":true,"pushEnabled":true,"emailEnabled":true}')`,[id(n)]);
 await pg.query('insert into customer_email_preferences values($1,true,$2,$3)',[id(n),`${n}@example.test`,'a'.repeat(64)]);
}
async function prepare(n=50,venue=10,actor=1,channel='in_app',body='Our event is tonight'){return (await pg.query('select prepare_venue_update_campaign($1,$2,$3,$4,$5,$6) id',[id(n),id(venue),id(actor),channel,'Tonight',body])).rows[0].id;}
async function state(action='send',n=50,venue=10,actor=1){return (await pg.query('select set_venue_update_campaign_state($1,$2,$3,$4) status',[id(n),id(venue),id(actor),action])).rows[0].status;}
async function due(){await pg.exec("update club_offer_digests set due_at=now()-interval '1 minute'");}
async function claim(){return (await pg.query('select * from claim_club_offer_digests(10)')).rows;}
async function target(job){return (await pg.query('select club_offer_digest_target($1,$2) value',[job.id,job.lease_id])).rows[0].value;}
async function reject(fn){await pg.exec('savepoint expected');await assert.rejects(fn);await pg.exec('rollback to savepoint expected');}

test('audience includes followers and verified club email subscribers, not arbitrary contacts',async()=>{
 const rows=(await pg.query('select * from venue_offer_audience($1) order by recipient_id',[id(10)])).rows;
 assert.deepEqual(rows.map(r=>r.recipient_id),[id(101),id(102)]);
 await pg.exec("update auth.users set email_confirmed_at=null where email='102@example.test'");
 assert.deepEqual((await pg.query('select * from venue_offer_audience($1)',[id(10)])).rows.map(r=>r.recipient_id),[id(101)]);
});
test('preview freezes its audience and publishes no notifications or emails',async()=>{
 await prepare();await pg.query('insert into venue_follows values($1,$2,true)',[id(105),id(10)]);
 assert.equal((await pg.query('select * from notifications')).rows.length,0);
 assert.equal((await pg.query('select * from club_offer_digests')).rows.length,0);
 await state();assert.equal((await pg.query('select * from notifications')).rows.length,2);
 assert.equal((await pg.query('select * from notifications where recipient_id=$1',[id(105)])).rows.length,0);
});
test('repeat preview/publish is idempotent and changed content cannot reuse an ID',async()=>{
 await prepare();await prepare();await reject(()=>prepare(50,10,1,'in_app','Changed'));
 assert.equal(await state(),'published');assert.equal(await state(),'published');
 const rows=(await pg.query('select * from notifications')).rows;
 assert.equal(rows.length,2);assert.equal(rows[0].body,'Our event is tonight');assert.equal(rows[0].payload.kind,'club_offer');
 assert.equal((await pg.query('select * from club_offer_digests')).rows.length,2);
 assert.equal((await claim()).length,0,'daily summaries cannot send immediately');
});
test('muting, unfollowing, unsubscribing and suspension before publish remove recipients',async()=>{
 await prepare();await pg.query('delete from venue_follows where customer_id=$1',[id(101)]);
 await pg.exec("update venue_update_subscriptions set withdrawn_at=now()");
 await state();assert.equal((await pg.query('select * from notifications')).rows.length,0);
});
test('club and master alert switches are honored without changing their choices',async()=>{
 await pg.query(`update customer_profiles set notification_settings=notification_settings||'{"clubDeals":false}' where user_id=$1`,[id(101)]);
 await pg.query(`update customer_profiles set notification_settings=notification_settings||'{"followAlertsEnabled":false}' where user_id=$1`,[id(102)]);
 assert.equal((await pg.query('select * from venue_offer_audience($1)',[id(10)])).rows.length,0);
});
test('staff, wrong clubs, removed managers and unpublished clubs cannot publish',async()=>{
 await reject(()=>prepare(50,10,4));await reject(()=>prepare(50,10,2));
 await prepare(50,10,3);await pg.exec("update venue_team_members set status='removed' where role='manager'");
 await reject(()=>state('send',50,10,3));
 await pg.exec('update venues set is_active=false');await reject(()=>prepare(51));
});
test('direct email and text channels are rejected; daily publish cap cannot be bypassed by withdrawal',async()=>{
 await reject(()=>prepare(50,10,1,'email'));await reject(()=>prepare(50,10,1,'text'));
 for(const n of [50,51,52]){await prepare(n);await state('send',n);}
 await state('cancel',50);await prepare(53);await reject(()=>state('send',53));
 assert.equal((await pg.query('select * from notifications')).rows.length,4);
});
test('emails are optional: an offer still appears with email and push disabled',async()=>{
 await pg.exec(`update customer_profiles set notification_settings=notification_settings||'{"emailEnabled":false,"pushEnabled":false}'`);
 await prepare();await state();
 assert.equal((await pg.query('select * from notifications')).rows.length,2);
 assert.equal((await pg.query('select * from club_offer_digests')).rows.length,0);
 const jobs=(await pg.query('select * from claim_venue_offer_push(10)')).rows;
 for(const job of jobs)assert.equal((await pg.query('select venue_offer_push_target($1,$2) value',[job.id,job.lease_id])).rows[0].value,null);
});
test('multiple offers across clubs become one daily digest for the same customer',async()=>{
 await pg.query('insert into venue_follows values($1,$2,true)',[id(101),id(20)]);
 await prepare();await state();await prepare(51);await state('send',51);await prepare(52,20,2);await state('send',52,20,2);
 const digests=(await pg.query('select * from club_offer_digests where recipient_id=$1',[id(101)])).rows;
 assert.equal(digests.length,1);
 await due();const jobs=await claim();const job=jobs.find(j=>j.recipient_id===id(101));
 assert.equal((await target(job)).items.length,3);
 assert.equal((await claim()).length,0,'leases prevent duplicate concurrent work');
});
test('withdrawn offers and preferences changed before digest creation are excluded',async()=>{
 await prepare();await state();await prepare(51);await state('send',51);await state('cancel',50);
 await pg.query('update customer_email_preferences set enabled=false where user_id=$1',[id(102)]);
 await due();const jobs=await claim();assert.equal(jobs.length,1);
 assert.equal((await target(jobs[0])).items.length,1);
});
test('email opt-out, club unsubscribe, lost club access and address changes fail closed after claiming',async()=>{
 await prepare();await state();await due();const jobs=await claim();
 const first=jobs.find(j=>j.recipient_id===id(101)),second=jobs.find(j=>j.recipient_id===id(102));
 assert.ok(await target(first));await pg.query('update customer_email_preferences set enabled=false where user_id=$1',[id(101)]);
 assert.equal(await target(first),null);
 await pg.exec("update venue_update_subscriptions set withdrawn_at=now()");
 assert.equal(await target(second),null);
});
test('an account email change cannot redirect an already prepared digest',async()=>{
 await prepare();await state();await due();const [job]=await claim();
 for(const table of ['app_users','auth.users'])await pg.query(`update ${table} set email='changed@example.test' where id=$1`,[job.recipient_id]);
 await pg.query("update customer_email_preferences set email='changed@example.test' where user_id=$1",[job.recipient_id]);
 assert.equal(await target(job),null);
});
test('withdrawal removes in-app offers and prevents optional delivery',async()=>{
 await pg.query('insert into web_push_subscriptions values($1)',[id(101)]);
 await prepare();await state();await due();const jobs=await claim();
 const [push]=(await pg.query('select * from claim_venue_offer_push(1)')).rows;
 await state('cancel');assert.equal((await pg.query('select * from notifications')).rows.length,0);
 for(const job of jobs)assert.equal(await target(job),null);
 assert.equal((await pg.query('select venue_offer_push_target($1,$2) value',[push.id,push.lease_id])).rows[0].value,null);
});
test('digest retry keeps payload and identity, and stale receipt leases cannot complete it',async()=>{
 await prepare();await state();await due();const [job]=await claim();const original=await target(job);
 assert.equal((await pg.query("select finish_club_offer_digest($1,$2,'accepted','ok','x') ok",[job.id,id(999)])).rows[0].ok,false);
 await pg.query("select finish_club_offer_digest($1,$2,'retry','timeout',null)",[job.id,job.lease_id]);
 await pg.exec("update club_offer_digests set next_attempt_at=now()-interval '1 minute'");
 const retry=(await claim()).find(j=>j.id===job.id);assert.ok(retry);assert.notEqual(retry.lease_id,job.lease_id);
 assert.deepEqual(await target(retry),original);
 await pg.query("select finish_club_offer_digest($1,$2,'accepted','ok','provider-id')",[retry.id,retry.lease_id]);
 assert.equal((await claim()).some(j=>j.id===job.id),false);
});
test('uncertain old retries expire and do not burst-send a backlog',async()=>{
 await prepare();await state();await due();await claim();
 await pg.exec("update club_offer_digests set first_attempt_at=now()-interval '21 hours',lease_until=now()-interval '1 minute'");
 assert.equal((await claim()).length,0);
 assert.ok((await pg.query('select status from club_offer_digests')).rows.every(r=>r.status==='failed'));
});
test('only one digest can reserve an email send per customer per UTC day',async()=>{
 await prepare();await state();await due();const [job]=await claim();
 await pg.query("select finish_club_offer_digest($1,$2,'accepted','ok','provider-id')",[job.id,job.lease_id]);
 await pg.query("insert into club_offer_digests(recipient_id,digest_day,due_at) values($1,current_date-1,now()-interval '2 minutes')",[job.recipient_id]);
 assert.equal((await claim()).some(j=>j.recipient_id===job.recipient_id),false);
});
test('push requires an opted-in device and current membership; retries use the same notification ID',async()=>{
 await pg.query('insert into web_push_subscriptions values($1)',[id(101)]);
 await prepare();await state();const jobs=(await pg.query('select * from claim_venue_offer_push(10)')).rows;
 const job=jobs.find(j=>j.recipient_id===id(101));
 const target=(await pg.query('select venue_offer_push_target($1,$2) value',[job.id,job.lease_id])).rows[0].value;
 assert.equal(target.userId,id(101));assert.equal(target.notificationId,job.notification_id);
 await pg.query('delete from venue_follows where customer_id=$1',[id(101)]);
 assert.equal((await pg.query('select venue_offer_push_target($1,$2) value',[job.id,job.lease_id])).rows[0].value,null);
});
test('browser roles cannot read private audiences, queues or invoke publishing functions',async()=>{
 for(const role of ['anon','authenticated']) {
  const r=(await pg.query("select has_table_privilege($1,'venue_update_campaigns','SELECT') readable,has_table_privilege($1,'club_offer_digests','UPDATE') writable,has_function_privilege($1,'set_venue_update_campaign_state(uuid,uuid,uuid,text)','EXECUTE') callable",[role])).rows[0];
  assert.deepEqual(r,{readable:false,writable:false,callable:false});
 }
 assert.equal((await pg.query("select count(*)::int n from pg_class where relname in ('venue_update_campaigns','venue_update_campaign_deliveries','club_offer_digests') and relrowsecurity")).rows[0].n,3);
 await pg.exec('set local role service_role');
 assert.equal((await pg.query('select * from venue_offer_audience($1)',[id(10)])).rows.length,2);
});

test('a rotated unsubscribe token cannot change the payload of an email retry',async()=>{
 await prepare();await state();await due();const job=(await claim())[0];
 assert.ok(await target(job));
 await pg.query('update customer_email_preferences set manage_token=$2 where user_id=$1',[job.recipient_id,'b'.repeat(64)]);
 assert.equal(await target(job),null);
});

test('worker matches verified subscribers without direct Auth access; the private helper is not a browser API',async()=>{
 const privileges=(await pg.query("select has_table_privilege('service_role','auth.users','select') auth, has_function_privilege('anon','private.club_offer_verified_email(uuid,text)','execute') anon, has_function_privilege('authenticated','private.club_offer_verified_email(uuid,text)','execute') signedin")).rows[0];
 assert.deepEqual(privileges,{auth:false,anon:false,signedin:false});
 await pg.exec('set local role service_role');
 assert.equal((await pg.query('select * from venue_offer_audience($1)',[id(10)])).rows.length,2);
 await prepare();await state();await due();assert.equal((await claim()).length,2);
 await pg.exec('reset role');
});
test('clearing an offer or allowing a lease to expire stops a stale worker sending it',async()=>{
 await prepare();await state();await due();const jobs=await claim();
 await pg.query('delete from notifications where recipient_id=$1',[jobs[0].recipient_id]);
 assert.equal(await target(jobs[0]),null);
 await pg.query("update club_offer_digests set lease_until=now()-interval '1 second' where id=$1",[jobs[1].id]);
 assert.equal(await target(jobs[1]),null);
});
