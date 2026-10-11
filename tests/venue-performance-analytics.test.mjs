import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;
    create table venues(id uuid primary key);
    create table dancer_profiles(id uuid primary key,stage_name text);
    create table shifts(id uuid primary key,venue_id uuid,dancer_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
    create table going_signals(shift_id uuid,created_at timestamptz);
    create table venue_follows(venue_id uuid,created_at timestamptz);
    create table venue_page_events(venue_id uuid,event_type text,session_id text,occurred_at timestamptz);
    create table club_shuttle_requests(id uuid,venue_id uuid,created_at timestamptz,notification_rows jsonb);
    create table pickup_requests(venue_id uuid,party_size int,requested_at timestamptz);
    create table qr_redemptions(id uuid primary key,venue_id uuid,dancer_id uuid,admission_pass_version int,status text,generated_at timestamptz,redeemed_at timestamptz,redemption_token text,expires_at timestamptz);
    create table mydancr_tv_videos(id uuid primary key,venue_id uuid,dancer_id uuid,caption text,venue_tag_status text,published_at timestamptz,expires_at timestamptz,status text);
    create table mydancr_tv_events(id uuid default gen_random_uuid(),video_id uuid,event_type text,occurred_at timestamptz);
    create table venue_vip_requests(id uuid primary key,venue_id uuid,user_id uuid,dancers jsonb,status text,starts_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table internal_roster_requests(id uuid primary key,venue_id uuid,dancer_id uuid,status text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,created_at timestamptz);
    grant usage on schema public to service_role; grant select,insert,update,delete on all tables in schema public to service_role;`);
  await db.query('insert into venues values($1),($2)', [id(1), id(2)]);
  await db.query("insert into dancer_profiles values($1,'Aria'),($2,'Bella'),($3,'Celeste')", [id(10), id(11), id(12)]);
  await db.query("insert into venue_vip_requests(id,venue_id,user_id,dancers,status,created_at) values($1,$2,$3,$4,'confirmed','2026-09-01')", [id(900), id(1), id(50), JSON.stringify([{ id: id(10) }])]);
  await db.query("insert into internal_roster_requests(id,venue_id,dancer_id,status,created_at) values($1,$2,$3,'completed','2026-09-01')", [id(901), id(1), id(10)]);
  await db.query("insert into shifts values($1,$2,$3,'posted',now()-interval '4 hours',null,'club_confirmed',now()+interval '2 hours')", [id(700), id(1), id(10)]);
  for (const migration of ['20260916190000_venue_subscription_analytics.sql', '20260916190100_report_current_pickup_receipts.sql', '20261011232707_venue_performance_channels.sql']) await db.exec(read(migration));
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback; reset role'));

async function report(venue = 1, since = '2026-10-01', until = '2026-10-08') {
  return (await db.query("select get_venue_performance_analytics($1,$2,$3,'2026-10-07','2026-10-08') result", [id(venue), since, until])).rows[0].result;
}
async function vip(n, { venue = 1, user = 50, dancers = [10], status = 'pending', created = '2026-10-02', starts = '2026-10-07T20:00Z' } = {}) {
  await db.query('insert into venue_vip_requests(id,venue_id,user_id,dancers,status,created_at,starts_at) values($1,$2,$3,$4,$5,$6,$7)',
    [id(n), id(venue), id(user), JSON.stringify(dancers.map(d => ({ id: id(d) }))), status, created, starts]);
}
async function table(n, { venue = 1, dancer = 10, status = 'pending', created = '2026-10-02' } = {}) {
  await db.query('insert into internal_roster_requests(id,venue_id,dancer_id,status,created_at) values($1,$2,$3,$4,$5)', [id(n), id(venue), id(dancer), status, created]);
}

test('multi-dancer VIP requests count once for the venue and once per distinct selected dancer', async () => {
  await vip(100, { dancers: [10, 10, 11], status: 'confirmed' });
  await vip(101, { dancers: [11], status: 'cancelled' });
  await vip(102, { dancers: [10], venue: 2, status: 'confirmed' });
  const r = (await report()).performance;
  assert.equal(r.current.vipRequests, 2);
  assert.equal(r.current.vipConfirmed, 1);
  assert.equal(r.current.vipCancelled, 1);
  assert.equal(r.dancers.find(d => d.id === id(10)).vip.requests, 1);
  assert.equal(r.dancers.find(d => d.id === id(11)).vip.requests, 2);
  assert.equal(JSON.stringify(r).includes(id(50)), false, 'no VIP account identities in analytics');
});

test('repeat requesters are distinct VIP accounts with an earlier same-venue, same-dancer request', async () => {
  await vip(100, { dancers: [10, 11] }); // Prior fixture is for dancer 10 only.
  await vip(101, { dancers: [10], created: '2026-10-03', status: 'declined' });
  await vip(102, { venue: 2, user: 51, dancers: [11], created: '2026-09-15' });
  await vip(103, { user: 51, dancers: [11], created: '2026-10-04' });
  const rows = (await report()).performance.dancers;
  assert.equal(rows.find(d => d.id === id(10)).vip.repeatRequesters, 1);
  assert.equal(rows.find(d => d.id === id(11)).vip.repeatRequesters, 0);
});

test('channel outcomes and equal-length prior periods stay venue-scoped without API row limits', async () => {
  await table(200, { status: 'acknowledged' }); await table(201, { status: 'completed' }); await table(202, { status: 'cancelled' });
  await table(203, { venue: 2, status: 'completed' }); await table(204, { created: '2026-09-25' });
  await db.query("insert into internal_roster_requests(id,venue_id,dancer_id,status,created_at) select gen_random_uuid(),$1,$2,'pending','2026-10-02' from generate_series(1,1001)", [id(1), id(11)]);
  await db.query("insert into venue_interactions(id,venue_id,dancer_id,event_type,source,session_id,occurred_at) values($1,$2,$3,'directions','dancer_profile','private-browser','2026-10-02'),($4,$5,$3,'directions','dancer_profile','private-browser','2026-10-02')", [id(300), id(1), id(10), id(301), id(2)]);
  const r = await report();
  assert.equal(r.performance.current.tableRequests, 1004); assert.equal(r.performance.previous.tableRequests, 1);
  assert.equal(r.performance.current.tableCompleted, 1); assert.equal(r.performance.current.tableCancelled, 1);
  assert.equal(r.performance.dancers.find(d => d.id === id(10)).external.directions, 1);
  assert.equal(r.performance.dancers.find(d => d.id === id(11)).internal.requests, 1001);
  assert.equal(JSON.stringify(r).includes('private-browser'), false);
});

test('guest-list signups overlap claims; admissions use redemption time, not claim time', async () => {
  await db.query("insert into qr_redemptions values($1,$2,$3,1,'redeemed','2026-09-26','2026-10-02','old','2026-10-09'),($4,$2,$3,1,'generated','2026-10-03',null,'new','2026-10-09')", [id(400), id(1), id(10), id(401)]);
  await db.query("insert into venue_guest_list_entries values($1,$2,'2026-09-26'),($3,$2,'2026-10-03')", [id(400), id(1), id(401)]);
  const r = await report();
  assert.equal(r.current.claims, 1); assert.equal(r.current.admissions, 1); assert.equal(r.performance.current.guestList, 1);
  assert.equal(r.performance.previous.guestList, 1); assert.equal(r.performance.tonight.guestListExpected, 1);
  assert.equal(r.performance.dancers.find(d => d.id === id(10)).external.admissions, 1);
});

test('Tonight uses scheduled VIP dates and the live six-hour table queue, not receipt-period totals', async () => {
  await vip(100, { created: '2026-09-10', status: 'confirmed' });
  await vip(101, { starts: '2026-10-09', status: 'confirmed' });
  await vip(102, { status: 'pending' });
  await table(200, { created: '2026-10-07T20:00Z' });
  await table(201, { created: '2026-10-07T21:00Z', status: 'acknowledged' });
  await table(202, { created: '2026-10-07T10:00Z' });
  const r = (await report()).performance;
  assert.equal(r.tonight.vipConfirmed, 1); assert.equal(r.tonight.vipPending, 1);
  assert.equal(r.tonight.tablePending, 1); assert.equal(r.tonight.tableAcknowledged, 1);
  assert.equal(r.current.vipRequests, 2); assert.equal(r.current.tableRequests, 3);
});

test('status timestamps leave old history unknown and survive note edits, retries and cancellation', async () => {
  const old = (await db.query('select first_responded_at,confirmed_at from venue_vip_requests where id=$1', [id(900)])).rows[0];
  assert.equal(old.first_responded_at, null); assert.equal(old.confirmed_at, null);
  assert.equal((await db.query('select completed_at from internal_roster_requests where id=$1', [id(901)])).rows[0].completed_at, null);
  await vip(100);
  await db.query("update venue_vip_requests set updated_at=clock_timestamp(),confirmed_at=now() where id=$1", [id(100)]);
  assert.equal((await db.query('select confirmed_at from venue_vip_requests where id=$1', [id(100)])).rows[0].confirmed_at, null);
  await db.query("update venue_vip_requests set status='confirmed' where id=$1", [id(100)]);
  const first = (await db.query('select first_responded_at,confirmed_at from venue_vip_requests where id=$1', [id(100)])).rows[0];
  assert.ok(first.first_responded_at); assert.equal(first.confirmed_at.getTime(), first.first_responded_at.getTime());
  await db.query("update venue_vip_requests set status='confirmed',updated_at=clock_timestamp(),first_responded_at=null where id=$1", [id(100)]);
  await db.query("update venue_vip_requests set status='cancelled' where id=$1", [id(100)]);
  const cancelled = (await db.query('select * from venue_vip_requests where id=$1', [id(100)])).rows[0];
  assert.equal(cancelled.first_responded_at.getTime(), first.first_responded_at.getTime()); assert.ok(cancelled.cancelled_at);
  await table(200);
  await db.query("update internal_roster_requests set status='acknowledged' where id=$1", [id(200)]);
  await db.query("update internal_roster_requests set status='completed' where id=$1", [id(200)]);
  const complete = (await db.query('select * from internal_roster_requests where id=$1', [id(200)])).rows[0];
  assert.ok(complete.acknowledged_at); assert.ok(complete.completed_at >= complete.acknowledged_at);
  const r = (await report()).performance;
  assert.equal(r.current.tableCompletionSamples, 1); assert.equal(r.current.vipResponseSamples, 1);
});

test('medians expose coverage and do not fabricate timing for pre-tracking requests', async () => {
  const empty = (await report()).performance.current;
  assert.equal(empty.vipResponseMinutes, null); assert.equal(empty.tableResponseMinutes, null);
  assert.equal(empty.tableCompletionMinutes, null); assert.equal(empty.tableResponseSamples, 0);
  // Simulate two genuine first acknowledgements at 10 and 30 minutes plus an old completed request without history.
  await db.exec('alter table internal_roster_requests disable trigger capture_internal_request_times');
  await db.query("insert into internal_roster_requests(id,venue_id,dancer_id,status,created_at,acknowledged_at) values($1,$2,$3,'completed','2026-10-02 10:00Z','2026-10-02 10:10Z'),($4,$2,$3,'acknowledged','2026-10-02 10:00Z','2026-10-02 10:30Z'),($5,$2,$3,'completed','2026-10-02',null)", [id(200), id(1), id(10), id(201), id(202)]);
  await db.exec('alter table internal_roster_requests enable trigger capture_internal_request_times');
  const r = (await report()).performance.current;
  assert.equal(r.tableResponseMinutes, 20); assert.equal(r.tableResponseSamples, 2); assert.equal(r.tableCompletionMinutes, null);
});

test('observed hours clip to period, merge overlaps and exclude requests outside verified presence', async () => {
  await db.query("insert into venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at,closed_at) values($1,$2,$3,'2026-09-30 23:00Z','2026-10-01 02:00Z',null),($4,$2,$3,'2026-10-01 01:00Z','2026-10-01 05:00Z','2026-10-01 03:00Z'),($5,$6,$3,'2026-10-01','2026-10-02',null)", [id(710), id(1), id(10), id(711), id(712), id(2)]);
  await table(200, { created: '2026-10-01T01:30Z' }); await table(201, { created: '2026-10-01T02:30Z' });
  await table(202, { created: '2026-10-01T03:00Z' }); // Exclusive end.
  await table(203, { created: '2026-10-01T04:00Z' });
  const r = (await report()).performance.dancers.find(d => d.id === id(10)).internal;
  assert.equal(r.requests, 4); assert.equal(r.checkedInHours, 3); assert.equal(r.requestsDuringHours, 2);
  assert.ok(Math.abs(r.requestsPerHour - 2 / 3) < 1e-10);
});

test('presence ledger seeds only deployment-forward hours and survives check-out and shift deletion', async () => {
  const seeded = (await db.query('select started_at,expires_at from venue_dancer_work_sessions where shift_id=$1', [id(700)])).rows[0];
  const started = (await db.query('select started_at from venue_performance_tracking')).rows[0].started_at;
  assert.equal(seeded.started_at.getTime(), started.getTime());
  await db.query("update shifts set location_verification_expires_at=now()+interval '3 hours' where id=$1", [id(700)]);
  assert.equal((await db.query('select count(*)::int n from venue_dancer_work_sessions where shift_id=$1', [id(700)])).rows[0].n, 1);
  await db.query('update shifts set checked_out_at=clock_timestamp() where id=$1', [id(700)]);
  assert.ok((await db.query('select closed_at from venue_dancer_work_sessions where shift_id=$1', [id(700)])).rows[0].closed_at);
  await db.query("update shifts set checked_out_at=null,checked_in_at=clock_timestamp() where id=$1", [id(700)]);
  await db.query('delete from shifts where id=$1', [id(700)]);
  const rows = (await db.query('select closed_at from venue_dancer_work_sessions where shift_id=$1', [id(700)])).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.closed_at));
});

test('private analytics and ledgers deny public roles and validate finite bounded periods', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`savepoint permission_check; set role ${role}`);
    await assert.rejects(report(), /permission denied/);
    await db.exec('rollback to permission_check; reset role');
    await db.exec(`savepoint ledger_check; set role ${role}`);
    await assert.rejects(db.query('select * from venue_dancer_work_sessions'), /permission denied/);
    await db.exec('rollback to ledger_check; reset role');
  }
  await db.exec('set role service_role'); assert.equal((await report()).performance.current.vipRequests, 0); await db.exec('reset role');
  await db.exec('savepoint invalid_range');
  await assert.rejects(report(1, '2026-01-01', '2026-10-08'), /31 days/);
  await db.exec('rollback to invalid_range');
  await assert.rejects(db.query("select get_venue_performance_analytics($1,'2026-10-01','2026-10-08','2026-10-01','infinity')", [id(1)]), /tonight window/);
});
