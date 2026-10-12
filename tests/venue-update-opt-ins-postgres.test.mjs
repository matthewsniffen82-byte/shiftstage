import assert from 'node:assert/strict';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token=n=>String(n).padStart(43,'x');
let pg;
before(async()=>{
  pg=new PGlite();
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table venues(id uuid primary key,name text);
    create table qr_redemptions(id uuid primary key,venue_id uuid,redemption_token text);
    create table venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,guest_name text,email text,phone text);
    create table club_shuttle_requests(id uuid primary key,venue_id uuid,notification_rows jsonb);
    grant usage on schema public to anon,authenticated,service_role;
    grant all on all tables in schema public to service_role;
    create function issue_guest_list_admission_pass(text,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,text,text,boolean) returns jsonb language plpgsql as $$
    begin
      insert into public.qr_redemptions values($3,$2,$1);
      insert into public.venue_guest_list_entries values($3,$2,$10,$12,$11);
      return jsonb_build_object('token',$1,'guestListJoined',true);
    end $$;`);
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261012012829_venue_guest_update_opt_ins.sql',import.meta.url),'utf8'));
});
after(async()=>pg?.close());
beforeEach(async()=>{await pg.exec('begin');await pg.query("insert into venues values($1,'Club A'),($2,'Club B')",[id(1),id(2)]);});
afterEach(async()=>pg.exec('rollback'));
async function guest(n=10,venue=1,email='Guest@Example.test'){
  await pg.query('insert into qr_redemptions values($1,$2,$3)',[id(n),id(venue),token(n)]);
  await pg.query("insert into venue_guest_list_entries values($1,$2,'Guest',$3,'+17025550123')",[id(n),id(venue),email]);
}
async function record(n=10,email=true,text=false,version='venue-updates-v1',source='guest_list'){
  return (await pg.query('select record_venue_update_opt_ins($1,$2,$3,$4,$5,$6,$7) value',[source,source==='ride'?id(n):token(n),email,text,version,token(n+100),token(n+200)])).rows[0].value;
}
async function rejected(fn){await pg.exec('savepoint expected_error');await assert.rejects(fn);await pg.exec('rollback to savepoint expected_error');}

test('visit details create no subscriptions until separate explicit channel choices are recorded',async()=>{
  await guest();assert.equal((await pg.query('select * from venue_update_subscriptions')).rows.length,0);
  assert.deepEqual(await record(10,false,false),[]);
  const result=await record(10,true,false);assert.equal(result.length,1);assert.equal(result[0].channel,'email');
  const rows=(await pg.query('select * from venue_update_subscriptions')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].destination,'guest@example.test');assert.equal(rows[0].venue_id,id(1));
  const event=(await pg.query('select * from venue_update_consent_events')).rows[0];
  assert.equal(event.sender_name,'Club A');assert.equal(event.consent_version,'venue-updates-v1');assert.ok(event.consented_at);
});

test('email and text opt-ins are independent, deduplicated within the club and retained separately from visit receipts',async()=>{
  await guest();await guest(11);await guest(12,2);
  await record(10,true,true);await record(11,true,true);await record(12,true,false);
  assert.equal((await pg.query('select * from venue_update_subscriptions')).rows.length,3);
  assert.equal((await pg.query('select * from venue_update_consent_events')).rows.length,5);
  await pg.exec('delete from venue_guest_list_entries;delete from qr_redemptions');
  assert.equal((await pg.query('select * from venue_update_subscriptions where withdrawn_at is null')).rows.length,3);
});

test('old retries never undo an unsubscribe; only a new explicit choice can resubscribe that channel',async()=>{
  await guest();await guest(11);const first=await record(10,true,true);
  await pg.query("update venue_update_subscriptions set withdrawn_at=now() where venue_id=$1 and channel='email'",[id(1)]);
  const replay=await record(10,true,true);assert.equal(replay[0].active,false);assert.equal(replay[1].active,true);assert.equal(replay[0].token,first[0].token);
  await record(11,false,false);assert.equal((await record(10,true,false))[0].active,false);
  assert.equal((await record(11,true,false))[0].active,true);
  assert.equal((await pg.query('select * from venue_update_consent_events')).rows.length,3);
});

test('invalid versions, missing email and missing receipts fail without creating opt-ins',async()=>{
  await guest(10,1,null);
  await rejected(()=>record(10,true,false));await rejected(()=>record(10,false,true,'old'));await rejected(()=>record(90));
  assert.equal((await pg.query('select * from venue_update_subscriptions')).rows.length,0);
  assert.equal((await record(10,false,true))[0].channel,'text');
});

test('ride opt-ins use the saved venue and guest contact; retries retain one audit event per channel',async()=>{
  const payload={kind:'club_shuttle_request',requestId:id(20),venueId:id(2),name:'Ride Guest',email:'ride@example.test',phone:'+447700900123'};
  await pg.query('insert into club_shuttle_requests values($1,$2,$3)',[id(20),id(2),JSON.stringify([{payload},{payload}])]);
  await record(20,true,true,'venue-updates-v1','ride');await record(20,true,true,'venue-updates-v1','ride');
  const rows=(await pg.query('select * from venue_update_subscriptions')).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.venue_id===id(2)&&r.name==='Ride Guest'));
  assert.equal((await pg.query('select * from venue_update_consent_events')).rows.length,2);
});

test('guest pass, contact entry and opt-ins commit atomically',async()=>{
  const issue=version=>pg.query('select issue_guest_list_admission_pass_with_updates($1,$2,$3,null,$4,null,null,$5,null,$6,$7,$8,true,true,false,$9,$10,$11) receipt',
    [token(50),id(1),id(50),'club_page','guest_list','Guest','+17025550123','guest@example.test',version,token(150),token(250)]);
  await rejected(()=>issue('old'));
  assert.equal((await pg.query('select * from qr_redemptions')).rows.length,0);
  const result=await issue('venue-updates-v1');assert.equal(result.rows[0].receipt.guestListJoined,true);assert.equal(result.rows[0].receipt.updates.length,1);
});

test('raw subscription data and registration RPCs are inaccessible to anon and signed-in clients',async()=>{
  await guest();
  for(const role of ['anon','authenticated']){
    await pg.exec('savepoint denied');await pg.exec(`set local role ${role}`);
    await assert.rejects(pg.query('select * from venue_update_subscriptions'),e=>e.code==='42501');await pg.exec('rollback to savepoint denied');
    await pg.exec(`set local role ${role}`);await assert.rejects(record(),e=>e.code==='42501');await pg.exec('rollback to savepoint denied');
  }
  await pg.exec('set local role service_role');assert.equal((await record()).length,1);
  const tables=(await pg.query("select relrowsecurity from pg_class where relname in ('venue_update_subscriptions','venue_update_consent_events')")).rows;
  assert.ok(tables.every(row=>row.relrowsecurity));
});
