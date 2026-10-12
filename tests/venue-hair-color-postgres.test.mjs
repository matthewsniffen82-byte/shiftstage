import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const existingPhotosMigration = readFileSync(new URL('../supabase/migrations/20261012231311_existing_main_photo_hair_colors.sql', import.meta.url), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table dancer_profiles(id uuid primary key,disabled_at timestamptz);
    create table dancer_photos(id uuid primary key,dancer_id uuid references dancer_profiles(id) on delete cascade,storage_path text,is_primary boolean,sort_order int,review_status text);
    create table dancer_internal_main_photos(dancer_id uuid primary key references dancer_profiles(id) on delete cascade,photo_id uuid references dancer_photos(id) on delete cascade);
    create table internal_roster_requests(venue_id uuid,dancer_id uuid,created_at timestamptz,status text);
    create table venue_interactions(venue_id uuid,dancer_id uuid,occurred_at timestamptz,event_type text);
    create table shifts(id uuid primary key,venue_id uuid,dancer_id uuid);
    create table going_signals(shift_id uuid,created_at timestamptz);
    create table qr_redemptions(venue_id uuid,dancer_id uuid,admission_pass_version int,status text,generated_at timestamptz,redeemed_at timestamptz);
    grant usage on schema public to service_role; grant all on all tables in schema public to service_role;`);
  await db.query('insert into dancer_profiles(id) values($1),($2)', [id(1),id(2)]);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012225032_venue_hair_color_analytics.sql', import.meta.url), 'utf8'));
  await db.exec(existingPhotosMigration);
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback; reset role'));
async function photo(n, primary = true, status = 'approved', dancer = 1) {
  await db.query('insert into dancer_photos values($1,$2,$3,$4,$5,$6)', [id(n),id(dancer),`${dancer}/${n}.jpg`,primary,n,status]);
}
async function current(channel = 'external') {
  return (await db.query('select h.*,a.photo_id,a.storage_path,a.color from dancer_hair_color_periods h left join dancer_photo_hair_analysis a on a.id=h.analysis_id where h.dancer_id=$1 and h.channel=$2 and h.ended_at is null',[id(1),channel])).rows[0];
}
async function report(venue = 10) {
  return (await db.query("select get_venue_hair_color_analytics($1,'2026-10-01','2026-11-01') report",[id(venue)])).rows[0].report;
}

test('approved main choices enqueue once; pending media is never analyzed', async () => {
  await photo(100, true, 'pending');
  assert.equal((await db.query('select count(*)::int n from dancer_photo_hair_analysis')).rows[0].n,0);
  await db.query("update dancer_photos set review_status='approved' where id=$1",[id(100)]);
  assert.equal((await current()).photo_id,id(100));
  assert.equal((await current('internal')).analysis_id,(await current()).analysis_id);
  await db.query('update dancer_photos set is_primary=true where id=$1',[id(100)]);
  assert.equal((await db.query('select count(*)::int n from dancer_photo_hair_analysis')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from dancer_hair_color_periods where analysis_id is not null')).rows[0].n,2);
});

test('internal selection is independent and removing public main stays empty', async () => {
  await photo(100); await photo(101,false);
  await db.query('insert into dancer_internal_main_photos values($1,$2)',[id(1),id(101)]);
  assert.equal((await current('internal')).photo_id,id(101));
  assert.equal((await current()).photo_id,id(100));
  await db.query('update dancer_photos set is_primary=false where id=$1',[id(100)]);
  assert.equal((await current()).analysis_id,null);
  assert.equal((await current('internal')).photo_id,id(101));
});

test('replacing or cropping the same photo creates a new version and preserves the old estimate', async () => {
  await photo(100);
  const original = await current();
  await db.query("update dancer_photo_hair_analysis set status='complete',color='blonde',confidence=.94 where id=$1",[original.analysis_id]);
  await db.query("update dancer_photos set storage_path='1/new-crop.jpg' where id=$1",[id(100)]);
  const changed = await current();
  assert.notEqual(changed.analysis_id,original.analysis_id);
  assert.equal(changed.color,'unknown');
  const old = (await db.query('select h.ended_at,a.color from dancer_hair_color_periods h join dancer_photo_hair_analysis a on a.id=h.analysis_id where h.id=$1',[original.id])).rows[0];
  assert.equal(old.color,'blonde'); assert.ok(old.ended_at);
});

test('deletion retains completed historical metrics but prevents queued scans of removed media', async () => {
  await photo(100); const original = await current();
  await db.query("update dancer_photo_hair_analysis set status='complete',color='brown',confidence=.9 where id=$1",[original.analysis_id]);
  await db.query('delete from dancer_photos where id=$1',[id(100)]);
  assert.equal((await current()).analysis_id,null);
  const saved = (await db.query('select photo_id,color from dancer_photo_hair_analysis where id=$1',[original.analysis_id])).rows[0];
  assert.equal(saved.photo_id,null); assert.equal(saved.color,'brown');
  await photo(101); await db.query('delete from dancer_photos where id=$1',[id(101)]);
  assert.equal((await db.query('select * from claim_dancer_hair_color_jobs(4)')).rows.length,0);
  assert.equal((await db.query("select status from dancer_photo_hair_analysis where status='unavailable'")).rows.length,1);
});

test('job leases prevent duplicate claims, recover stale work and stop at three attempts', async () => {
  await photo(100);
  await db.exec('set role service_role');
  const first = (await db.query('select * from claim_dancer_hair_color_jobs(4)')).rows[0];
  assert.equal(first.attempts,1); assert.ok(first.lease_token);
  assert.equal((await db.query('select * from claim_dancer_hair_color_jobs(4)')).rows.length,0);
  await db.query("update dancer_photo_hair_analysis set locked_until=now()-interval '1 minute' where id=$1",[first.id]);
  const second = (await db.query('select * from claim_dancer_hair_color_jobs(4)')).rows[0];
  assert.equal(second.attempts,2); assert.notEqual(second.lease_token,first.lease_token);
  await db.query("update dancer_photo_hair_analysis set attempts=3,locked_until=now()-interval '1 minute' where id=$1",[first.id]);
  assert.equal((await db.query('select * from claim_dancer_hair_color_jobs(4)')).rows.length,0);
  assert.equal((await db.query('select status from dancer_photo_hair_analysis where id=$1',[first.id])).rows[0].status,'failed');
});

test('historical groups respect channel, venue, photo-change boundary and claim-time admission attribution', async () => {
  await photo(100); await photo(101,false);
  await db.query('insert into dancer_internal_main_photos values($1,$2)',[id(1),id(101)]);
  const a = (await db.query('select id from dancer_photo_hair_analysis where photo_id=$1',[id(100)])).rows[0].id;
  const b = (await current('internal')).analysis_id;
  await db.query("update dancer_photo_hair_analysis set status='complete',color=case when id=$1 then 'blonde' else 'black' end,confidence=.95",[a]);
  await db.exec('delete from dancer_hair_color_periods');
  await db.query(`insert into dancer_hair_color_periods(dancer_id,channel,analysis_id,started_at,ended_at) values
    ($1,'external',$2,'2026-10-02','2026-10-10'),($1,'external',$3,'2026-10-10',null),($1,'internal',$3,'2026-10-02',null)`,[id(1),a,b]);
  await db.query("insert into venue_interactions values($1,$2,'2026-10-01','dancer_profile'),($1,$2,'2026-10-03','dancer_profile'),($1,$2,'2026-10-10','directions'),($3,$2,'2026-10-03','dancer_profile'),($1,null,'2026-10-03','dancer_profile')",[id(10),id(1),id(11)]);
  await db.query("insert into internal_roster_requests values($1,$2,'2026-10-03','completed')",[id(10),id(1)]);
  await db.query("insert into qr_redemptions values($1,$2,1,'redeemed','2026-10-03','2026-10-11')",[id(10),id(1)]);
  const r = await report();
  assert.equal(r.internal[0].color,'black'); assert.equal(r.internal[0].metrics.completed,1);
  const groups = Object.fromEntries(r.external.map(row => [row.color,row]));
  assert.deepEqual(groups.blonde.metrics,{ dancer_profile:1,claims:1,admissions:1 });
  assert.deepEqual(groups.black.metrics,{ directions:1 });
  assert.deepEqual(groups.unknown.metrics,{ dancer_profile:1 });
  assert.equal(groups.blonde.dancers,1);
  assert.equal((await report(11)).external[0].metrics.dancer_profile,1);
  assert.ok(!JSON.stringify(r).includes('storage_path'));
});

test('unclassified activity is preserved without API row limits', async () => {
  await db.query("insert into internal_roster_requests select $1,$2,'2026-10-04','pending' from generate_series(1,1005)",[id(10),id(1)]);
  const r = await report();
  assert.equal(r.internal[0].color,'unknown'); assert.equal(r.internal[0].metrics.requests,1005);
  assert.equal((await report(12)).internal.length,0);
});

test('existing main photos are queued once, with recent venue activity first and no invented past colors', async () => {
  await db.exec('alter table dancer_photos disable trigger capture_dancer_photo_hair_color');
  await photo(100); await photo(200,true,'approved',2);
  await db.exec('alter table dancer_photos enable trigger capture_dancer_photo_hair_color');
  await db.query("insert into internal_roster_requests values($1,$2,now()-interval '1 hour','completed')",[id(10),id(2)]);
  const setup = existingPhotosMigration.replace(/^begin;/,'').replace(/commit;\s*$/,'');
  await db.exec(setup);
  const jobs = (await db.query('select * from dancer_photo_hair_analysis order by next_attempt_at,created_at')).rows;
  assert.equal(jobs.length,2); assert.equal(jobs[0].dancer_id,id(2));
  assert.equal((await db.query('select count(*)::int n from dancer_hair_color_periods')).rows[0].n,4);
  await db.exec(setup);
  assert.equal((await db.query('select count(*)::int n from dancer_photo_hair_analysis')).rows[0].n,2);
  await db.exec("update dancer_photo_hair_analysis set status='complete',color='blonde',confidence=.95");
  const r = (await db.query("select get_venue_hair_color_analytics($1,now()-interval '1 day',now()) report",[id(10)])).rows[0].report;
  assert.equal(r.internal[0].color,'unknown'); assert.equal(r.internal[0].metrics.completed,1);
  assert.deepEqual(r.currentPhotos.internal,[{color:'blonde',state:'ready',dancers:1}]);
  assert.deepEqual(r.currentPhotos.external,[]);
});

test('current photo colors distinguish scanning, failure, unclear color and missing photos by channel and venue', async () => {
  await photo(100); await photo(101,false);
  await db.query('insert into dancer_internal_main_photos values($1,$2)',[id(1),id(101)]);
  await db.query("insert into internal_roster_requests values($1,$2,'2026-10-03','pending'),($1,$3,'2026-10-03','pending')",[id(10),id(1),id(2)]);
  await db.query("insert into venue_interactions values($1,$2,'2026-10-03','dancer_profile')",[id(10),id(1)]);
  await db.query("update dancer_photo_hair_analysis set status='complete',color='brown',confidence=.92 where photo_id=$1",[id(100)]);
  let r=await report();
  assert.deepEqual(r.currentPhotos.external,[{color:'brown',state:'ready',dancers:1}]);
  assert.deepEqual(r.currentPhotos.internal.map(row=>row.state).sort(),['no_photo','scanning']);
  await db.query("update dancer_photo_hair_analysis set status='failed' where photo_id=$1",[id(101)]);
  r=await report();assert.ok(r.currentPhotos.internal.some(row=>row.state==='unavailable'));
  await db.query("update dancer_photo_hair_analysis set status='complete',color='unknown',confidence=.5 where photo_id=$1",[id(101)]);
  r=await report();assert.ok(r.currentPhotos.internal.some(row=>row.state==='ready'&&row.color==='unknown'));
  assert.deepEqual((await report(11)).currentPhotos,{internal:[],external:[]});
});

test('private analysis, history and aggregate functions deny public roles; input ranges are bounded', async () => {
  for (const role of ['anon','authenticated']) {
    for (const sql of ['select * from dancer_photo_hair_analysis','select * from dancer_hair_color_periods','select * from claim_dancer_hair_color_jobs(4)',`select get_venue_hair_color_analytics('${id(10)}','2026-10-01','2026-11-01')`]) {
      await db.exec(`savepoint permission_check; set role ${role}`);
      await assert.rejects(db.query(sql),/permission denied/);
      await db.exec('rollback to permission_check; reset role');
    }
  }
  for (const [since,until] of [['2026-11-01','2026-10-01'],['2025-01-01','2026-11-01'],['-infinity','2026-11-01']]) {
    await db.exec('savepoint invalid');
    await assert.rejects(db.query('select get_venue_hair_color_analytics($1,$2,$3)',[id(10),since,until]),/Invalid report period/);
    await db.exec('rollback to invalid');
  }
});
