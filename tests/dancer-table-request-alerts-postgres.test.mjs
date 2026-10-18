import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

let pg;
before(async () => {
  pg = await createInternalRosterDatabase();
  for (const name of ['20260928190000_internal_table_request_push.sql', '20261001190000_internal_alert_recovery.sql', '20261018043831_dancer_table_request_notifications.sql']) {
    await pg.exec(readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
  }
});
beforeEach(() => pg.exec('begin;set role service_role'));
afterEach(() => pg.exec('rollback;reset role'));
after(() => pg?.close());
async function request() {
  await pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5)', [id(30),id(1),id(50),'internal',{}]);
  await pg.query("insert into public.internal_roster_links(id,venue_id,kind,label,token) values($1,$2,'table','Table 12',$3)", [id(70),id(20),id(71)]);
  return (await pg.query('select public.internal_roster_request($1,$2,$3) result', [id(71),id(10),id(80)])).rows[0].result;
}
const claim = async (channels = ['email','push']) => (await pg.query('select * from public.claim_dancer_table_request_alerts(null,4,$1)', [channels])).rows;
const finish = async (job, outcome) => (await pg.query('select public.finish_dancer_table_request_alert($1,$2,$3) result', [job.id,job.lease_id,outcome])).rows[0].result;
const inbox = async () => (await pg.query("select * from public.notifications where payload->>'kind'='dancer_table_request'")).rows;

test('only the requested dancer gets one inbox item and independent email/push jobs, alongside staff', async () => {
  const r = await request();
  const jobs = await claim();
  assert.deepEqual(jobs.map(job => job.channel).sort(), ['email','push']);
  for (const job of jobs) {
    assert.equal(job.recipient_id,id(1)); assert.equal(job.table_label,'Table 12');
    assert.equal(job.venue_name,'Synthetic club');
  }
  const [notice] = await inbox();
  assert.equal(notice.recipient_id,id(1)); assert.match(notice.body,/Table 12 at Synthetic club requested you/);
  assert.equal(notice.payload.requestId,r.id);
  assert.doesNotMatch(JSON.stringify(notice),new RegExp(id(71)),'never expose table capability');
  assert.deepEqual((await pg.query('select recipient_id from public.internal_request_push_deliveries')).rows.map(row=>row.recipient_id),[id(2)]);
  assert.equal((await claim()).length,0);
  await pg.query('select public.internal_roster_request($1,$2,$3)',[id(71),id(10),id(80)]);
  assert.equal((await inbox()).length,1);
  assert.equal((await pg.query('select * from public.dancer_table_request_deliveries')).rows.length,2);
});
test('a successful email does not repeat when push needs retry; snapshots and delivery keys stay stable', async () => {
  await request();
  const [email] = await claim(['email']); assert.equal(email.channel,'email');
  assert.equal(await finish(email,'sent'),true);
  const [push] = await claim(['push']); assert.equal(await finish(push,'retry'),true);
  assert.equal((await claim()).length,0);
  await pg.exec("update public.dancer_table_request_deliveries set available_at=now();update public.internal_roster_links set label='Renamed table';update public.venues set name='Renamed club'");
  const [retry] = await claim(); assert.equal(retry.id,push.id); assert.equal(retry.table_label,'Table 12');
  assert.equal(retry.venue_name,'Synthetic club'); assert.equal(await finish(push,'sent'),false);
});
test('staff acknowledgement does not prevent the dancer from receiving the request', async () => {
  await request(); await pg.exec("update public.internal_roster_requests set status='acknowledged'");
  assert.equal((await claim()).length,2);
});
for (const [label, change] of [
  ['cancelled',"update public.internal_roster_requests set status='cancelled'"],
  ['completed',"update public.internal_roster_requests set status='completed'"],
  ['stale',"update public.internal_roster_requests set created_at=now()-interval '11 minutes'"],
  ['revoked table',"update public.internal_roster_links set active=false"],
  ['checked out',"update public.shifts set checked_out_at=now()"],
  ['inactive dancer',`update public.app_users set account_state='disabled' where id='${id(1)}'`],
  ['wrong recipient',`update public.dancer_table_request_deliveries set recipient_id='${id(5)}'`],
]) test(label+' prevents external delivery', async () => {
  await request(); await pg.exec(change); assert.equal((await claim()).length,0);
  assert.ok((await pg.query('select state from public.dancer_table_request_deliveries')).rows.every(row=>row.state==='skipped'));
  if (['cancelled','completed'].includes(label)) assert.equal((await inbox())[0].payload.status,label);
});
test('cleared inbox alerts are not resurrected on cancellation', async () => {
  await request(); await pg.exec("delete from public.notifications;update public.internal_roster_requests set status='cancelled'");
  assert.equal((await inbox()).length,0);
});
test('expired leases recover with bounded attempts and stale receipts cannot acknowledge', async () => {
  await request(); const [old] = await claim(['email']);
  await pg.exec("update public.dancer_table_request_deliveries set lease_until=now()-interval '1 second'");
  const [next] = await claim(['email']); assert.equal(next.id,old.id); assert.notEqual(next.lease_id,old.lease_id);
  assert.equal(await finish(old,'sent'),false); assert.equal(await finish(next,'retry'),true);
  await pg.exec("update public.dancer_table_request_deliveries set attempts=5,available_at=now()");
  assert.equal((await claim()).length,0);
  assert.ok((await pg.query('select state from public.dancer_table_request_deliveries')).rows.every(row=>row.state==='failed'));
});
test('request rollback also rolls back queue and inbox writes', async () => {
  await pg.exec('savepoint synthetic'); await request(); await pg.exec('rollback to synthetic');
  assert.equal((await inbox()).length,0); assert.equal((await claim()).length,0);
});
for (const role of ['anon','authenticated']) test(role+' cannot read or manipulate deliveries', async () => {
  await request(); await pg.exec('set role '+role);
  for (const sql of ['select * from public.dancer_table_request_deliveries','select * from public.claim_dancer_table_request_alerts()',`select public.finish_dancer_table_request_alert('${id(1)}','${id(2)}','sent')`]) {
    await pg.exec('savepoint forbidden'); await assert.rejects(pg.exec(sql),{code:'42501'}); await pg.exec('rollback to forbidden');
  }
});
