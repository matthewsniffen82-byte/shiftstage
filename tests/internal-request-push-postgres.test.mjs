import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

let pg;
before(async () => {
  pg = await createInternalRosterDatabase();
  await pg.exec(readFileSync(new URL('../supabase/migrations/20260928190000_internal_table_request_push.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => pg.exec('begin;set role service_role'));
afterEach(async () => pg.exec('rollback;reset role'));
after(async () => pg?.close());
async function request() {
  await pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5)', [id(30),id(1),id(50),'internal',{}]);
  await pg.query("insert into public.internal_roster_links(id,venue_id,kind,label,token) values($1,$2,'table','Table 12',$3)", [id(70),id(20),id(71)]);
  return (await pg.query('select public.internal_roster_request($1,$2,$3) result',[id(71),id(10),id(80)])).rows[0].result;
}
const claim = async requestId => (await pg.query('select * from public.claim_internal_request_push($1,12)', [requestId || null])).rows;
const finish = async(job,outcome) => (await pg.query('select public.finish_internal_request_push($1,$2,$3) result',[job.id,job.lease_id,outcome])).rows[0].result;

test('new request atomically queues the owner and active club staff, but no dancer/customer/other club', async () => {
  await pg.query("insert into public.venue_team_members(venue_id,user_id,status,role) values($1,$2,'active','staff')",[id(20),id(6)]);
  const r = await request(); const rows = await claim(r.id);
  assert.deepEqual(rows.map(r=>r.recipient_id).sort(),[id(2),id(6)].sort());
  for(const row of rows) { assert.equal(row.table_label,'Table 12'); assert.equal(row.stage_name,'Synthetic dancer'); }
  assert.equal((await claim(r.id)).length,0,'leased rows cannot be claimed twice');
});
test('replaying a request produces no duplicate jobs or delivered alerts', async () => {
  const r = await request(); const [job] = await claim(r.id); assert.equal(await finish(job,'sent'),true);
  await pg.query('select public.internal_roster_request($1,$2,$3)',[id(71),id(10),id(80)]);
  assert.equal((await pg.query('select * from public.internal_request_push_deliveries')).rows.length,1);
  assert.equal((await claim()).length,0);
});
test('rollback leaves no partial request or push queue', async () => {
  await pg.exec('savepoint synthetic_request'); await request(); await pg.exec('rollback to synthetic_request');
  assert.equal((await pg.query('select * from public.internal_request_push_deliveries')).rows.length,0);
});
for(const [name,change] of [
  ['seen',"update public.internal_roster_requests set status='acknowledged'"],
  ['expired',"update public.internal_roster_requests set created_at=now()-interval '11 minutes'"],
  ['revoked table',"update public.internal_roster_links set active=false"],
  ['inactive manager',"update public.app_users set account_state='disabled' where id='"+id(2)+"'"],
  ['dancer checked out',"update public.shifts set checked_out_at=now()"],
]) test(name+' suppresses queued alerts', async()=>{
  await request(); await pg.exec(change); assert.equal((await claim()).length,0);
  assert.equal((await pg.query('select state from public.internal_request_push_deliveries')).rows[0].state,'skipped');
});
test('removed staff cannot receive an alert queued while they had access',async()=>{
  await pg.query("insert into public.venue_team_members(venue_id,user_id,status,role) values($1,$2,'active','staff')",[id(20),id(6)]);
  await request(); await pg.query("update public.venue_team_members set status='removed' where user_id=$1",[id(6)]);
  assert.deepEqual((await claim()).map(row=>row.recipient_id),[id(2)]);
});
test('expired lease can retry with the same delivery UUID, but the old lease cannot finish it',async()=>{
  await request();const [old]=await claim();
  await pg.exec("update public.internal_request_push_deliveries set lease_until=now()-interval '1 second'");
  const [next]=await claim();assert.equal(next.id,old.id);assert.notEqual(next.lease_id,old.lease_id);
  assert.equal(await finish(old,'sent'),false); assert.equal(await finish(next,'retry'),true);
  assert.equal((await claim()).length,0,'retry backs off');
  await pg.exec("update public.internal_request_push_deliveries set available_at=now(),attempts=5");
  assert.equal((await claim()).length,0);
  assert.equal((await pg.query('select state from public.internal_request_push_deliveries')).rows[0].state,'failed');
});
for(const role of ['anon','authenticated']) test(role+' cannot inspect, claim, or finish staff delivery jobs',async()=>{
  await pg.exec('set role '+role);
  for(const sql of ['select * from public.internal_request_push_deliveries','select * from public.claim_internal_request_push()',`select public.finish_internal_request_push('${id(1)}','${id(2)}','sent')`]){
    await pg.exec('savepoint forbidden');await assert.rejects(pg.exec(sql),{code:'42501'});await pg.exec('rollback to forbidden');
  }
});
