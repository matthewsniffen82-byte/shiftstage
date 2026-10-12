import assert from 'node:assert/strict';
import test, {before,after,beforeEach,afterEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key,name text);
    create table qr_redemptions(id uuid primary key,venue_id uuid,customer_id uuid);
    create table venue_customer_shares(customer_id uuid,venue_id uuid,name text,email text,city text,consented_at timestamptz default now(),primary key(customer_id,venue_id));
    create table venue_update_subscriptions(id uuid primary key,venue_id uuid,channel text,destination text,consented_at timestamptz default now(),withdrawn_at timestamptz,manage_token text);
    create table venue_update_consent_events(subscription_id uuid,source text,source_id uuid);
    grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012030023_customer_club_privacy_links.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
  await db.exec('begin');
  await db.query("insert into app_users values($1,'customer','active'),($2,'customer','active'),($3,'venue','active')",[id(1),id(2),id(3)]);
  await db.query("insert into venues values($1,'Club A'),($2,'Club B')",[id(10),id(11)]);
  await db.query("insert into venue_update_subscriptions(id,venue_id,channel,destination,manage_token) values($1,$4,'email','guest@example.test','email-token'),($2,$4,'text','+17025550123','text-token'),($3,$5,'email','other@example.test','other-token')",[id(20),id(21),id(22),id(10),id(11)]);
});
afterEach(async()=>db.exec('rollback'));
const list=async(user=1,email=null,phone=null,offset=0)=>(await db.query('select * from get_customer_club_privacy($1,$2,$3,$4)',[id(user),email,phone,offset])).rows;
const stop=async(sub,user=1,email=null,phone=null)=>(await db.query('select stop_customer_club_update($1,$2,$3,$4) result',[id(user),email,phone,id(sub)])).rows[0].result;

test('a verified email reveals only its channel and never exposes private management tokens',async()=>{
  const rows=await list(1,'GUEST@example.test');
  assert.equal(rows.length,1);assert.equal(rows[0].subscriptions.length,1);assert.equal(rows[0].subscriptions[0].channel,'email');
  assert.doesNotMatch(JSON.stringify(rows),/text-token|email-token|manage_token|other@example|1702555/);
  assert.equal((await list()).length,0);
});
test('verified phone and explicit private-link ownership independently grant access',async()=>{
  assert.equal((await list(1,null,'+17025550123'))[0].subscriptions[0].channel,'text');
  await db.query('insert into customer_update_links(customer_id,subscription_id) values($1,$2)',[id(1),id(21)]);
  assert.equal((await list())[0].subscriptions[0].id,id(21));
  assert.equal((await list(2)).length,0);
  assert.equal((await db.query('select count(*) n from venue_update_subscriptions where withdrawn_at is null')).rows[0].n,3);
});
test('owned guest-list receipts permit management but another guest or mismatched venue does not',async()=>{
  await db.query('insert into qr_redemptions values($1,$2,$3)',[id(30),id(10),id(1)]);
  await db.query("insert into venue_update_consent_events values($1,'guest_list',$2),($3,'guest_list',$2)",[id(21),id(30),id(22)]);
  assert.equal((await list())[0].subscriptions[0].id,id(21));
  assert.equal((await list()).length,1);assert.equal((await list(2)).length,0);
});
test('unsubscribe authorizes each channel and preserves consent and visit records',async()=>{
  assert.equal(await stop(21,1,'guest@example.test'),false);
  assert.equal(await stop(22,1,'guest@example.test'),false);
  const before=(await db.query('select consented_at from venue_update_subscriptions where id=$1',[id(20)])).rows[0].consented_at;
  assert.equal(await stop(20,1,'guest@example.test'),true);assert.equal(await stop(20,1,'guest@example.test'),true);
  const row=(await list(1,'guest@example.test'))[0].subscriptions[0];assert.ok(row.withdrawnAt);
  assert.equal(Date.parse(row.consentedAt),new Date(before).getTime());
  assert.equal((await db.query('select withdrawn_at from venue_update_subscriptions where id=$1',[id(21)])).rows[0].withdrawn_at,null);
});
test('shared follower details appear without creating or inferring subscriptions',async()=>{
  await db.query("insert into venue_customer_shares(customer_id,venue_id,name,email,city) values($1,$2,'Guest','guest@example.test','Miami')",[id(1),id(11)]);
  const rows=await list();assert.equal(rows.length,1);assert.equal(rows[0].share.city,'Miami');assert.deepEqual(rows[0].subscriptions,[]);
  assert.equal((await list(2)).length,0);
});
test('inactive accounts and venue accounts cannot list or change customer preferences',async()=>{
  assert.equal((await list(3,'guest@example.test')).length,0);assert.equal(await stop(20,3,'guest@example.test'),false);
  await db.query("update app_users set account_state='disabled' where id=$1",[id(1)]);
  assert.equal((await list(1,'guest@example.test')).length,0);assert.equal(await stop(20,1,'guest@example.test'),false);
});
test('club pagination is stable, includes a lookahead, and neither duplicates nor drops the last page',async()=>{
  for(let n=100;n<124;n++){
    await db.query('insert into venues values($1,$2)',[id(n),`Club ${n}`]);
    await db.query("insert into venue_customer_shares(customer_id,venue_id,name,email,city) values($1,$2,'Guest','guest@example.test','')",[id(1),id(n)]);
  }
  const first=await list(),last=await list(1,null,null,20);
  assert.equal(first.length,21);assert.equal(last.length,4);
  assert.equal(new Set([...first.slice(0,20),...last].map(r=>r.venue_id)).size,24);
});
test('browser roles cannot inspect links or call privileged preference functions; service role can',async()=>{
  for(const role of ['anon','authenticated']) {
    const grants=(await db.query(`select has_table_privilege($1,'customer_update_links','SELECT') can_read,
      has_function_privilege($1,'get_customer_club_privacy(uuid,text,text,integer)','EXECUTE') can_list,
      has_function_privilege($1,'stop_customer_club_update(uuid,text,text,uuid)','EXECUTE') can_stop`,[role])).rows[0];
    assert.deepEqual(grants,{can_read:false,can_list:false,can_stop:false});
  }
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='customer_update_links'::regclass")).rows[0].relrowsecurity,true);
  await db.exec('set local role service_role');assert.equal((await list(1,'guest@example.test')).length,1);
});
