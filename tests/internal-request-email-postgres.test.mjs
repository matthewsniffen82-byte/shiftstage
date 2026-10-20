import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

let pg;
before(async () => {
  pg = await createInternalRosterDatabase();
  for (const name of ['20260928190000_internal_table_request_push.sql', '20261001190000_internal_alert_recovery.sql', '20261020033002_venue_internal_request_emails.sql']) {
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
const claim = async (event = null) => (await pg.query('select * from public.claim_internal_request_emails(null,4,$1)', [event])).rows;
const finish = async (job, outcome) => (await pg.query('select public.finish_internal_request_email($1,$2,$3) result', [job.id,job.lease_id,outcome])).rows[0].result;

test('new request queues one email for each authorized venue recipient, independently of push', async () => {
  await pg.query("insert into public.venue_team_members(venue_id,user_id,status,role) values($1,$2,'active','manager')", [id(20),id(6)]);
  await request(); const jobs = await claim();
  assert.deepEqual(jobs.map(job => job.recipient_id).sort(), [id(2),id(6)].sort());
  for (const job of jobs) {
    assert.equal(job.table_label, 'Table 12'); assert.equal(job.stage_name, 'Synthetic dancer');
    assert.equal(job.venue_name, 'Synthetic club'); assert.equal(job.event_kind, 'requested');
    assert.doesNotMatch(JSON.stringify(job), new RegExp(id(71)), 'email never exposes the table capability');
    assert.equal(await finish(job, 'sent'), true);
  }
  assert.equal((await claim()).length, 0);
  assert.equal((await pg.query('select * from public.claim_internal_request_alerts()')).rows.length, 2, 'email receipts never consume push delivery');
  await pg.query('select public.internal_roster_request($1,$2,$3)', [id(71),id(10),id(80)]);
  assert.equal((await pg.query('select * from public.internal_request_email_deliveries')).rows.length, 2, 'replays cannot duplicate email');
});
test('cancellation skips the queued request email and creates a distinct cancellation email', async () => {
  const req = await request();
  await pg.query('select public.cancel_internal_roster_request($1,$2,$3,$4)', [id(20),id(70),id(10),req.id]);
  assert.equal((await claim('requested')).length, 0);
  const [job] = await claim('cancelled'); assert.equal(job.event_kind, 'cancelled');
  assert.equal(await finish(job, 'sent'), true);
  await pg.query('select public.cancel_internal_roster_request($1,$2,$3,$4)', [id(20),id(70),id(10),req.id]);
  assert.equal((await claim()).length, 0);
  assert.equal((await pg.query('select * from public.internal_request_email_deliveries')).rows.length, 2);
});
test('staff acknowledgement still allows the email receipt', async () => {
  await request(); await pg.exec("update public.internal_roster_requests set status='acknowledged'");
  assert.equal((await claim()).length, 1);
});
test('retries retain stable content and identifiers, recover expired leases and stop after five attempts', async () => {
  await request(); const [old] = await claim();
  await pg.exec("update public.internal_request_email_deliveries set lease_until=now()-interval '1 second';update public.internal_roster_links set label='Renamed table';update public.dancer_profiles set stage_name='Renamed dancer';update public.venues set name='Renamed club'");
  const [next] = await claim(); assert.equal(next.id, old.id); assert.notEqual(next.lease_id, old.lease_id);
  assert.equal(next.table_label, old.table_label); assert.equal(next.stage_name, old.stage_name); assert.equal(next.venue_name, old.venue_name);
  assert.equal(await finish(old, 'sent'), false); assert.equal(await finish(next, 'retry'), true);
  assert.equal((await claim()).length, 0);
  await pg.exec("update public.internal_request_email_deliveries set attempts=5,available_at=now()");
  assert.equal((await claim()).length, 0);
  assert.equal((await pg.query('select state from public.internal_request_email_deliveries')).rows[0].state, 'failed');
});
for (const [label, change] of [
  ['completed', "update public.internal_roster_requests set status='completed'"],
  ['expired', "update public.internal_roster_requests set created_at=now()-interval '11 minutes'"],
  ['revoked table', "update public.internal_roster_links set active=false"],
  ['closed club', "update public.venues set is_active=false"],
  ['disabled recipient', `update public.app_users set account_state='disabled' where id='${id(2)}'`],
  ['checked out', "update public.shifts set checked_out_at=now()"],
]) test(label + ' suppresses stale or unauthorized email', async () => {
  await request(); await pg.exec(change); assert.equal((await claim()).length, 0);
  assert.equal((await pg.query('select state from public.internal_request_email_deliveries')).rows[0].state, 'skipped');
});
test('removed staff cannot receive queued email', async () => {
  await pg.query("insert into public.venue_team_members(venue_id,user_id,status,role) values($1,$2,'active','manager')", [id(20),id(6)]);
  await request(); await pg.query("update public.venue_team_members set status='removed' where user_id=$1", [id(6)]);
  assert.deepEqual((await claim()).map(job => job.recipient_id), [id(2)]);
});
test('request rollback leaves neither email nor push jobs', async () => {
  await pg.exec('savepoint synthetic'); await request(); await pg.exec('rollback to synthetic');
  assert.equal((await claim()).length, 0);
  assert.equal((await pg.query('select * from public.internal_request_push_deliveries')).rows.length, 0);
});
for (const role of ['anon','authenticated']) test(role + ' cannot read, enqueue, claim or acknowledge venue email', async () => {
  await request(); await pg.exec('set role ' + role);
  for (const sql of ['select * from public.internal_request_email_deliveries', 'select public.queue_internal_request_email()', 'select * from public.claim_internal_request_emails()', `select public.finish_internal_request_email('${id(1)}','${id(2)}','sent')`]) {
    await pg.exec('savepoint forbidden'); await assert.rejects(pg.exec(sql), { code: '42501' }); await pg.exec('rollback to forbidden');
  }
});
