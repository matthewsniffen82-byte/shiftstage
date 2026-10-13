import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key,owner_user_id uuid,is_active boolean default true);
    create table venue_team_members(venue_id uuid,user_id uuid,status text,role text);
    create table venue_dancer_affiliations(venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz);
    create table dancer_profiles(id uuid primary key,stage_name text);
    create table shifts(id uuid primary key,venue_id uuid,dancer_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
    create table going_signals(shift_id uuid,created_at timestamptz);
    create table venue_follows(venue_id uuid,created_at timestamptz);
    create table venue_page_events(venue_id uuid,event_type text,session_id text,occurred_at timestamptz);
    create table club_shuttle_requests(id uuid,venue_id uuid,created_at timestamptz,notification_rows jsonb);
    create table pickup_requests(venue_id uuid,party_size int,requested_at timestamptz);
    create table qr_redemptions(id uuid primary key,venue_id uuid,dancer_id uuid,admission_pass_version int,status text,generated_at timestamptz,redeemed_at timestamptz,redemption_token text,expires_at timestamptz,source_type text,voided_at timestamptz);
    create table mydancr_tv_videos(id uuid primary key,venue_id uuid,dancer_id uuid,caption text,venue_tag_status text,published_at timestamptz,expires_at timestamptz,status text);
    create table mydancr_tv_events(id uuid default gen_random_uuid(),video_id uuid,event_type text,occurred_at timestamptz);
    create table venue_vip_requests(id uuid primary key,venue_id uuid,user_id uuid,reviewed_by uuid,dancers jsonb,status text,starts_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table internal_roster_requests(id uuid primary key,venue_id uuid,dancer_id uuid,status text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,created_at timestamptz);
    grant usage on schema public to service_role; grant select,insert,update,delete on all tables in schema public to service_role;`);
  const roster = read('20260928090100_mydancr_internal_roster.sql');
  await db.exec(roster.slice(roster.indexOf('create function public.internal_roster_access('), roster.indexOf('create function public.internal_roster_request(')));
  for (const migration of ['20260916190000_venue_subscription_analytics.sql', '20260916190100_report_current_pickup_receipts.sql', '20261011232707_venue_performance_channels.sql', '20261012225142_venue_dancer_results.sql', '20261013000159_venue_all_time_analytics.sql', '20261013011729_automatic_dancer_score_inputs.sql']) await db.exec(read(migration));
  await db.exec("alter table venues add column timezone text default 'America/Los_Angeles'; alter table shifts add column shift_source text default 'scheduled', add column nfc_tag_id uuid, add column ended_reason text;");
  await db.exec(read('20261013024002_dancer_roster_accuracy_scores.sql'));
  await db.exec(`create table dancer_channel_preferences(dancer_id uuid primary key,visibility text);
    create table dancer_shift_channels(shift_id uuid primary key references shifts(id) on delete cascade,dancer_id uuid,venue_id uuid,visibility text);`);
  await db.exec(read('20261013031912_dancer_both_roster_score_weight.sql'));
  await db.exec(`alter table internal_roster_requests add column link_id uuid;
    create table internal_roster_links(id uuid primary key,venue_id uuid,label text);
    grant select on dancer_channel_preferences,dancer_shift_channels,internal_roster_links to service_role;`);
  await db.exec(read('20261013040600_venue_automatic_results.sql'));
  await db.query("insert into app_users values($1,'venue','active'),($2,'venue','active'),($3,'venue','active'),($4,'customer','active')", [id(50),id(51),id(52),id(53)]);
  await db.query('insert into venues(id,owner_user_id) values($1,$2),($3,$4)', [id(1),id(50),id(2),id(52)]);
  await db.query("insert into venue_team_members values($1,$2,'active','staff')", [id(1),id(51)]);
  await db.query("insert into dancer_profiles values($1,'Aria'),($2,'Bella')", [id(10),id(11)]);
  await db.query("insert into venue_dancer_affiliations values($1,$2,'active',null),($1,$3,'active',null)", [id(1),id(10),id(11)]);
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback; reset role'));
async function report() { return (await db.query("select get_venue_performance_analytics($1,now()-interval '7 days',now()+interval '1 second',now()-interval '12 hours',now()+interval '12 hours') result", [id(1)])).rows[0].result.performance; }
async function request(n,status='acknowledged') { await db.query('insert into internal_roster_requests(id,venue_id,dancer_id,status,created_at) values($1,$2,$3,$4,now()-interval \'1 hour\')',[id(n),id(1),id(10),status]); }
async function attendance(n,value,actor=51,venue=1,status='acknowledged') { return db.query('select record_internal_request_attendance($1,$2,$3,$4,$5)',[id(actor),id(venue),id(n),status,value]); }
async function rejected(work, pattern) { await db.exec('savepoint expected_error'); await assert.rejects(work,pattern); await db.exec('rollback to expected_error'); }
async function pass(n,{venue=1,dancer=10,source='dancer_profile',status='generated',redeemed=false}={}) {
  await db.query("insert into qr_redemptions(id,venue_id,dancer_id,admission_pass_version,status,generated_at,redeemed_at,redemption_token,expires_at,source_type) values($1,$2,$3,1,$4,now()-interval '2 days',case when $5 then now()-interval '1 day' end,$6,now()+interval '1 day',$7)",[id(n),id(venue),id(dancer),status,redeemed,`pass-${n}`,source]);
}

async function session(n, { start = '2026-10-10T20:00Z', end = '2026-10-11T02:00Z', day = '2026-10-10', kind = 'dancer', venue = 1, dancer = 10, tracked = true, closed = true, bothPeriods = '{}' } = {}) {
  await db.query(`insert into venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at,closed_at,dancer_check_in_at,check_in_day,dancer_check_out_at,closure_reason,both_roster_periods)
    values($1,$2,$3,$4,$5,case when $8 then $5::timestamptz end,case when $9 then $4::timestamptz end,$6,case when $7='dancer' then $5::timestamptz end,case when $8 then $7 end,$10)`,
    [id(n),id(venue),id(dancer),start,end,day,kind,closed,tracked,bothPeriods]);
}
async function accuracy(since='2026-10-10T00:00Z', until='2026-10-12T00:00Z') {
  const r = await db.query("select get_venue_performance_analytics($1,$2,$3,$3::timestamptz-interval '12 hours',$3) result",[id(1),since,until]);
  return r.rows[0].result.performance.dancers.find(d => d.id === id(10))?.internal;
}

async function automatic(since='2026-10-10T00:00Z',until='2026-10-12T00:00Z',venue=1) {
  return (await db.query("select get_venue_performance_analytics($1,$2,$3,$3::timestamptz-interval '12 hours',$3) result",[id(venue),since,until])).rows[0].result.automatic;
}

test('automatic VIP demand counts venue requests once, excludes withdrawals from customer demand and uses local requested time',async()=>{
  for(const [n,user,venue,created,withdrawn,choices] of [
    [8000,50,1,'2026-10-09',false,[10]], [8001,50,1,'2026-10-10',false,[10,10,11]],
    [8002,51,1,'2026-10-11',false,[11]], [8003,50,1,'2026-10-11',true,[10]], [8004,51,2,'2026-10-11',false,[10]],
  ]) await db.query("insert into venue_vip_requests(id,venue_id,user_id,dancers,created_at,starts_at,status,reviewed_by) values($1,$2,$3,$4,$5,'2026-10-11T04:00Z',$6,$7)",
    [id(n),id(venue),id(user),JSON.stringify(choices.map(n=>({id:id(n)}))),created,withdrawn?'cancelled':'pending',withdrawn?id(user):null]);
  const r=await automatic();
  assert.equal(r.current.vipRequests,3); assert.equal(r.current.vipCustomers,2); assert.equal(r.current.vipSelections,3);
  assert.equal(r.current.vipWithdrawals,1); assert.equal(r.current.vipRepeatCustomers,1); assert.equal(r.previous.vipRequests,1);
  assert.deepEqual(r.current.vipHours,[{label:'21:00',total:2}]); assert.deepEqual(r.current.vipDates,[{label:'2026-10-10',total:2}]);
  assert.ok(!JSON.stringify(r).includes(id(50)),'requester identities never leave the aggregate');
  await db.query("update venue_vip_requests set status='confirmed',reviewed_by=$2 where id=$1",[id(8001),id(51)]);
  assert.deepEqual((await automatic()).current,r.current,'manager approval does not alter automatic demand');
});

test('venue conversion uses a nonvoided claim cohort and excludes future redemptions from both comparison periods',async()=>{
  for(const [n,generated,redeemed,voided] of [[8100,'2026-10-09','2026-10-10',false],[8101,'2026-10-10','2026-10-11',false],
    [8102,'2026-10-11','2026-10-13',false],[8103,'2026-10-10','2026-10-11',true],[8104,'2026-10-11',null,false]]) {
    await db.query("insert into qr_redemptions(id,venue_id,dancer_id,admission_pass_version,status,generated_at,redeemed_at,voided_at,redemption_token,expires_at) values($1,$2,$3,1,$4,$5,$6,case when $7 then $6::timestamptz end,$8,'2026-10-14')",
      [id(n),id(1),id(10),redeemed?'redeemed':'generated',generated,redeemed,voided,`auto-${n}`]);
  }
  const r=await automatic(); assert.equal(r.current.claims,3); assert.equal(r.current.admissions,2); assert.equal(r.current.cohortAdmissions,1);
  assert.equal(r.previous.claims,1); assert.equal(r.previous.cohortAdmissions,0);
  const all=await automatic('1970-01-01T00:00Z','2026-10-14'); assert.equal(all.previous,null); assert.equal(all.current.claims,4); assert.equal(all.current.admissions,3);
});

test('automatic roster and table totals merge hours, retain checkout evidence and ignore staff arrival states',async()=>{
  await session(8200,{bothPeriods:'{[2026-10-10T22:00Z,2026-10-11T00:00Z)}'}); await session(8201,{kind:'expired'});
  await db.query("insert into internal_roster_links values($1,$2,'Table A')",[id(8299),id(1)]);
  for(const [n,venue,stamp] of [[8202,1,'2026-10-10T20:30Z'],[8203,1,'2026-10-10T22:30Z'],[8204,1,'2026-10-11T03:00Z'],[8205,2,'2026-10-10T22:30Z']])
    await db.query("insert into internal_roster_requests(id,venue_id,dancer_id,link_id,status,created_at) values($1,$2,$3,$4,'pending',$5)",[id(n),id(venue),id(10),id(8299),stamp]);
  const r=(await automatic()).current;
  assert.equal(r.dancersCheckedIn,1); assert.equal(r.checkedInHours,6); assert.equal(r.bothRosterHours,2);
  assert.equal(r.checkIns,2); assert.equal(r.dancerCheckouts,1); assert.equal(r.expiredCheckins,1);
  assert.equal(r.checkoutEligibleDays,1); assert.equal(r.dancerCheckoutDays,0);
  assert.equal(r.tableRequests,3); assert.equal(r.tableRequestsDuringHours,2); assert.deepEqual(r.tables,[{label:'Table A',total:3}]);
  await db.query("update internal_roster_requests set status='completed',attendance='arrived' where venue_id=$1",[id(1)]);
  assert.deepEqual((await automatic()).current,r);
});

test('customer and pickup aggregates count existing events without exposing browser IDs or multiplying passengers',async()=>{
  await db.query("insert into venue_page_events values($1,'page_view','secret-browser','2026-10-10'),($1,'page_view','secret-browser','2026-10-11'),($2,'page_view','other','2026-10-11')",[id(1),id(2)]);
  for(const [n,type] of [[8300,'dancer_profile'],[8301,'share_completed'],[8302,'transport']])
    await db.query("insert into venue_interactions(id,venue_id,dancer_id,event_type,source,session_id,occurred_at) values($1,$2,$3,$4,'dancer_profile','secret-browser','2026-10-11')",[id(n),id(1),id(10),type]);
  const notice={payload:{kind:'club_shuttle_request',requestId:id(8310),venueId:id(1),partySize:5}};
  await db.query("insert into club_shuttle_requests values($1,$2,'2026-10-11T05:00Z',$3)",[id(8310),id(1),JSON.stringify([notice,notice])]);
  const r=(await automatic()).current;
  assert.equal(r.clubVisits,2); assert.equal(r.uniqueBrowsers,1); assert.equal(r.profileOpens,1); assert.equal(r.completedShares,1);
  assert.equal(r.pickups,1); assert.equal(r.passengers,5); assert.equal(r.transportClicks,1); assert.deepEqual(r.pickupHours,[{label:'22:00',total:1}]);
  assert.ok(!JSON.stringify(r).includes('secret-browser'));
});

test('live roster stays independent of history and automatic helpers remain service-only',async()=>{
  await modeVisit(8400,'both');
  const r=await automatic(); assert.deepEqual(r.liveRoster,{total:1,internal:0,external:0,both:1,unknown:0});
  assert.equal(r.current.dancersCheckedIn,0,'current visit is outside this historical period');
  for(const role of ['anon','authenticated']) for(const signature of ['get_venue_automatic_period(uuid,timestamptz,timestamptz)','get_venue_performance_scored_dancers(uuid,timestamptz,timestamptz,timestamptz,timestamptz)'])
    assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,`public.${signature}`])).rows[0].allowed,false);
  await db.exec('set local role service_role'); assert.equal((await automatic()).liveRoster.both,1);
});

test('accuracy pairs dancer checkout with its NFC visit and preserves evidence after shift deletion',async()=>{
  await db.query("insert into shifts(id,venue_id,dancer_id,status,checked_in_at,location_status,location_verification_expires_at,shift_source,nfc_tag_id) values($1,$2,$3,'posted',clock_timestamp(),'club_confirmed',now()+interval '2 hours','nfc_presence',$4)",[id(701),id(1),id(10),id(900)]);
  await db.query("update shifts set location_verification_expires_at=now()+interval '3 hours' where id=$1",[id(701)]);
  let visits=(await db.query('select * from venue_dancer_work_sessions where shift_id=$1',[id(701)])).rows;
  assert.equal(visits.length,1); assert.ok(visits[0].dancer_check_in_at); assert.ok(visits[0].check_in_day);
  await db.query("update shifts set checked_out_at=clock_timestamp(),ended_reason='manual',location_verification_expires_at=clock_timestamp() where id=$1",[id(701)]);
  await db.query('delete from shifts where id=$1',[id(701)]);
  visits=(await db.query('select * from venue_dancer_work_sessions where shift_id=$1',[id(701)])).rows;
  assert.equal(visits[0].closure_reason,'dancer'); assert.ok(visits[0].dancer_check_out_at);
  const r=(await report()).dancers[0].internal;
  assert.equal(r.verifiedCheckInDays,1); assert.equal(r.checkoutEligibleDays,1); assert.equal(r.dancerCheckoutDays,1);
});

test('unverified and demo checkins earn no accuracy, while late or staff checkouts cannot earn dancer credit',async()=>{
  for (const [n,source,reason] of [[710,'demo_locked','manual'],[711,'nfc_presence','venue_checkout'],[712,'nfc_presence','manual']]) {
    await db.query("insert into shifts(id,venue_id,dancer_id,status,checked_in_at,location_status,location_verification_expires_at,shift_source,nfc_tag_id) values($1,$2,$3,'posted',clock_timestamp(),'club_confirmed',now()+interval '2 hours',$4,$5)",[id(n),id(1),id(10),source,id(900)]);
    if(n===712) await db.query("update venue_dancer_work_sessions set started_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where shift_id=$1",[id(n)]);
    await db.query('update shifts set checked_out_at=clock_timestamp(),ended_reason=$2,location_verification_expires_at=clock_timestamp() where id=$1',[id(n),reason]);
  }
  const visits=(await db.query('select shift_id,dancer_check_in_at,dancer_check_out_at,closure_reason from venue_dancer_work_sessions order by shift_id')).rows;
  assert.equal(visits[0].dancer_check_in_at,null);
  assert.equal(visits[1].closure_reason,'venue'); assert.equal(visits[1].dancer_check_out_at,null);
  assert.equal(visits[2].closure_reason,'expired'); assert.equal(visits[2].dancer_check_out_at,null);
});

test('same-day repeats cannot dilute missed checkout and active visits wait without penalties',async()=>{
  await session(720); await session(721,{kind:'expired'});
  await session(722,{start:'2026-10-10T22:00Z',end:'2026-10-13T02:00Z',closed:false,kind:null});
  let r=await accuracy();
  assert.equal(r.verifiedCheckInDays,1); assert.equal(r.checkoutEligibleDays,1); assert.equal(r.dancerCheckoutDays,0); assert.equal(r.activeCheckInDays,1);
  assert.equal(r.rosterTrackedHours,28,'overlapping recorded hours are merged');
  await db.exec('delete from venue_dancer_work_sessions');
  await session(723,{end:'2026-10-13T02:00Z',closed:false,kind:null});
  r=await accuracy(); assert.equal(r.checkoutEligibleDays,0); assert.equal(r.dancerCheckoutDays,0); assert.equal(r.activeCheckInDays,1);
});

test('checkout accuracy respects the period end, midnight, other venues and unknown history',async()=>{
  await session(730,{start:'2026-10-09T23:00Z',end:'2026-10-10T03:00Z',day:'2026-10-09'});
  await session(731,{start:'2026-10-11T20:00Z',end:'2026-10-12T02:00Z',day:'2026-10-11'});
  await session(732,{tracked:false,kind:'expired'});
  await session(733,{venue:2,kind:'expired'});
  const r=await accuracy();
  assert.equal(r.verifiedCheckInDays,2); assert.equal(r.checkoutEligibleDays,1); assert.equal(r.dancerCheckoutDays,1); assert.equal(r.activeCheckInDays,1);
  assert.equal(r.rosterTrackedHours,7);
  const later=await accuracy('2026-10-10T00:00Z','2026-10-12T04:00Z');
  assert.equal(later.checkoutEligibleDays,2); assert.equal(later.dancerCheckoutDays,2);
});

test('lazy expiry needs no manager update and administrative interruption remains ungraded',async()=>{
  await session(740,{closed:false,kind:null});
  await session(741,{start:'2026-10-11T08:00Z',end:'2026-10-11T10:00Z',day:'2026-10-11',kind:'interrupted'});
  const r=await accuracy(); assert.equal(r.verifiedCheckInDays,2); assert.equal(r.checkoutEligibleDays,1); assert.equal(r.dancerCheckoutDays,0);
  for(const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query('select has_function_privilege($1,\'public.capture_venue_work_session()\',\'execute\') allowed',[role])).rows[0].allowed,false);
  }
  for(const role of ['anon','authenticated']) {
    assert.equal((await db.query('select has_function_privilege($1,\'public.get_venue_performance_customer_scores(uuid,timestamptz,timestamptz,timestamptz,timestamptz)\',\'execute\') allowed',[role])).rows[0].allowed,false);
  }
});

test('Both hours merge overlapping visits and clip recorded mode intervals to the report and visit',async()=>{
  await session(750,{bothPeriods:'{[2026-10-10T22:00Z,2026-10-11T01:00Z)}'});
  await session(751,{bothPeriods:'{[2026-10-10T23:00Z,2026-10-11T08:00Z)}'});
  await session(752,{tracked:false,bothPeriods:'{[2026-10-10T20:00Z,2026-10-11T02:00Z)}'});
  await session(753,{venue:2,bothPeriods:'{[2026-10-10T20:00Z,2026-10-11T02:00Z)}'});
  const r=await accuracy(); assert.equal(r.rosterTrackedHours,6); assert.equal(r.rosterBothHours,4);
  const clipped=await accuracy('2026-10-11T00:00Z','2026-10-11T01:00Z');
  assert.equal(clipped.rosterTrackedHours,1); assert.equal(clipped.rosterBothHours,1);
  const earlier=await accuracy('2026-10-10T20:00Z','2026-10-10T21:00Z'); assert.equal(earlier.rosterBothHours,0);
});

async function modeVisit(n,mode='internal') {
  await db.query('insert into dancer_channel_preferences values($1,$2)',[id(10),mode]);
  await db.query("insert into shifts(id,venue_id,dancer_id,status,checked_in_at,location_status,location_verification_expires_at,shift_source,nfc_tag_id) values($1,$2,$3,'posted',clock_timestamp(),'club_confirmed',clock_timestamp()+interval '2 hours','nfc_presence',$4)",[id(n),id(1),id(10),id(900)]);
  await db.query('insert into dancer_shift_channels values($1,$2,$3,$4)',[id(n),id(10),id(1),mode]);
}
async function modeSession(n) { return (await db.query('select * from venue_dancer_work_sessions where shift_id=$1 order by started_at desc',[id(n)])).rows[0]; }

test('mode switches start Both timing when both settings agree, preserve repeat taps and close on either setting change',async()=>{
  await modeVisit(760); assert.equal((await modeSession(760)).both_roster_started_at,null);
  await db.query("update dancer_channel_preferences set visibility='both' where dancer_id=$1",[id(10)]);
  assert.equal((await modeSession(760)).both_roster_started_at,null);
  await db.query("update dancer_shift_channels set visibility='both' where shift_id=$1",[id(760)]);
  const started=(await modeSession(760)).both_roster_started_at; assert.ok(started);
  await db.query("update dancer_shift_channels set visibility='both' where shift_id=$1",[id(760)]);
  assert.deepEqual((await modeSession(760)).both_roster_started_at,started);
  // PGlite's clock has millisecond precision; allow a nonzero recorded interval.
  await new Promise(resolve=>setTimeout(resolve,10));
  await db.query("update dancer_channel_preferences set visibility='external' where dancer_id=$1",[id(10)]);
  let row=await modeSession(760); assert.equal(row.both_roster_started_at,null); assert.notEqual(row.both_roster_periods,'{}');
  const recorded=row.both_roster_periods;
  await db.query("update dancer_channel_preferences set visibility='both' where dancer_id=$1",[id(10)]);
  assert.ok((await modeSession(760)).both_roster_started_at);
  await db.query("update dancer_shift_channels set visibility='internal' where shift_id=$1",[id(760)]);
  row=await modeSession(760); assert.equal(row.both_roster_started_at,null); assert.ok(row.both_roster_periods.length>=recorded.length);
});

test('dancer checkout freezes Both history and channel deletion cannot remove it',async()=>{
  await modeVisit(770,'both');
  await new Promise(resolve=>setTimeout(resolve,10));
  await db.query("update shifts set checked_out_at=clock_timestamp(),ended_reason='manual',location_verification_expires_at=clock_timestamp() where id=$1",[id(770)]);
  const row=await modeSession(770); assert.equal(row.both_roster_started_at,null); assert.notEqual(row.both_roster_periods,'{}');
  await db.query('delete from shifts where id=$1',[id(770)]);
  assert.equal((await modeSession(770)).both_roster_periods,row.both_roster_periods);
  assert.equal((await modeSession(770)).closure_reason,'dancer');
  for(const name of ['capture_venue_both_roster_period','capture_venue_roster_mode_change']) for(const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,`public.${name}()`])).rows[0].allowed,false);
  }
});

test('unknown history and a later Both selection do not retroactively boost earlier visits',async()=>{
  await session(780); assert.equal((await accuracy()).rosterBothHours,0);
  await modeVisit(781,'both');
  assert.equal((await accuracy()).rosterBothHours,0);
  const row=await modeSession(781);
  const r=await db.query("select get_venue_performance_analytics($1,$2::timestamptz-interval '1 hour',$2::timestamptz+interval '4 hours',$2::timestamptz-interval '1 hour',$2::timestamptz+interval '4 hours') result",[id(1),row.started_at]);
  const internal=r.rows[0].result.performance.dancers.find(d=>d.id===id(10)).internal;
  assert.ok(internal.rosterBothHours>1.99 && internal.rosterBothHours<=2,'open Both timing stops at presence expiry');
  assert.equal(internal.dancerCheckoutDays,0,'the bonus does not supply an expired visit with a checkout');
});
test('arrival is explicit, idempotent, venue-scoped and distinct from completion',async()=>{
  await request(200); await request(201); await request(202,'completed'); await request(203,'pending');
  await attendance(200,'arrived'); const stamp=(await db.query('select attendance_recorded_at from internal_roster_requests where id=$1',[id(200)])).rows[0].attendance_recorded_at;
  await attendance(200,'arrived');
  assert.equal((await db.query('select attendance_recorded_at from internal_roster_requests where id=$1',[id(200)])).rows[0].attendance_recorded_at.getTime(),stamp.getTime());
  await attendance(201,'no_show');
  await rejected(()=>attendance(200,'no_show'),/REQUEST_CHANGED/);
  await rejected(()=>attendance(203,'arrived',51,1,'pending'),/REQUEST_CHANGED/);
  await rejected(()=>attendance(203,'arrived',52),/ACCESS_DENIED/);
  await rejected(()=>attendance(203,'arrived',53),/ACCESS_DENIED/);
  const r=await report(); assert.equal(r.current.tableArrived,1); assert.equal(r.current.tableNoShows,1); assert.equal(r.current.showUpPercent,50);
  assert.equal(r.current.tableAttendanceUnrecorded,2); assert.equal(r.current.tableCompleted,1);
  assert.equal(r.dancers[0].results.tableArrived,1);
});
test('attendance events retain explicit checkout and do not treat expiration as checkout',async()=>{
  await db.query("insert into shifts values($1,$2,$3,'posted',clock_timestamp(),null,'club_confirmed',now()+interval '2 hours')",[id(300),id(1),id(10)]);
  await db.query("update shifts set location_verification_expires_at=now()+interval '3 hours' where id=$1",[id(300)]);
  assert.equal((await report()).current.checkIns,1);
  await db.query("update shifts set location_verification_expires_at=clock_timestamp() where id=$1",[id(300)]);
  assert.equal((await report()).current.checkOuts,0);
  await db.query('update shifts set checked_out_at=clock_timestamp() where id=$1',[id(300)]);
  await db.query('delete from shifts where id=$1',[id(300)]);
  const r=await report(); assert.equal(r.current.checkOuts,1); assert.ok(r.dancers[0].results.lastCheckOutAt);
});
test('profile conversions count redeemed entry, preserve cohorts and exclude other venues',async()=>{
  await pass(500,{status:'redeemed',redeemed:true}); await pass(501); await pass(502,{source:'club_page',status:'redeemed',redeemed:true});
  await pass(503,{status:'expired'}); await pass(504,{venue:2,status:'redeemed',redeemed:true});
  await pass(505,{status:'redeemed',redeemed:true});
  await db.query('update qr_redemptions set voided_at=now() where id=$1',[id(505)]);
  let r=await report(); assert.equal(r.current.profileConversions,1); assert.equal(r.current.profileClaims,3);
  assert.equal(r.current.profileConversionPercent,33.3); assert.equal(r.dancers[0].results.profileConversions,1);
  await pass(506,{status:'redeemed',redeemed:true});
  await db.query("update qr_redemptions set generated_at=now()-interval '10 days' where id=$1",[id(506)]);
  r=await report(); assert.equal(r.current.profileConversions,2); assert.equal(r.current.profileCohortConversions,1);
  assert.equal(r.current.profileClaims,3); assert.equal(r.previous.profileClaims,1); assert.equal(r.previous.profileCohortConversions,0);
  assert.equal('revenueCents' in r.current,false); assert.equal('purchases' in r.current,false);
  assert.equal(JSON.stringify(r).includes('pass-500'),false); assert.equal(JSON.stringify(r).includes(id(51)),false);
});

test('counts include more than 1000 events and keep previous periods separate',async()=>{
  await db.query("insert into venue_dancer_attendance_events(shift_id,venue_id,dancer_id,kind,occurred_at) select gen_random_uuid(),$1,$2,'check_in',now()-interval '1 day' from generate_series(1,1001)",[id(1),id(10)]);
  await db.query("insert into venue_dancer_attendance_events(shift_id,venue_id,dancer_id,kind,occurred_at) values(gen_random_uuid(),$1,$2,'check_out',now()-interval '10 days'),(gen_random_uuid(),$3,$2,'check_in',now()-interval '1 day')",[id(1),id(10),id(2)]);
  const r=await report(); assert.equal(r.current.checkIns,1001); assert.equal(r.previous.checkOuts,1); assert.equal(r.current.checkOuts,0);
});
test('private attendance and RPCs deny public callers and suspended staff',async()=>{
  await request(200);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await rejected(()=>report(),/permission denied/);
    await rejected(()=>attendance(200,'arrived'),/permission denied/);
    await rejected(()=>db.query('select * from venue_dancer_attendance_events'),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role'); await attendance(200,'arrived'); await report(); await db.exec('reset role');
  await db.query("update app_users set account_state='suspended' where id=$1",[id(51)]);
  await rejected(()=>attendance(200,'arrived'),/ACCESS_DENIED/);
});

test('every dancer metric shares Tonight, 7-day, 30-day and all-time boundaries without mixing venues', async () => {
  const end = '2026-10-12T12:00:00Z';
  const times = ['2026-10-12T10:00:00Z', '2026-10-09T10:00:00Z', '2026-09-27T10:00:00Z', '2026-08-12T10:00:00Z'];
  for (const [i, time] of times.entries()) {
    for (const venue of [1, 2]) {
      await db.query("insert into venue_dancer_attendance_events(shift_id,venue_id,dancer_id,kind,occurred_at) values(gen_random_uuid(),$1,$2,'check_in',$3),(gen_random_uuid(),$1,$2,'check_out',$3::timestamptz+interval '1 hour')", [id(venue), id(10), time]);
      await db.query("insert into venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at,closed_at) values(gen_random_uuid(),$1,$2,$3,$3::timestamptz+interval '1 hour',$3::timestamptz+interval '1 hour')", [id(venue), id(10), time]);
      await db.query("insert into internal_roster_requests(id,venue_id,dancer_id,status,created_at) values(gen_random_uuid(),$1,$2,'completed',$3)", [id(venue),id(10),time]);
      await db.query("insert into venue_vip_requests(id,venue_id,user_id,dancers,status,starts_at,created_at) values(gen_random_uuid(),$1,$2,$3,'pending',$4,$4)", [id(venue),id(53),JSON.stringify([{ id:id(10) },{ id:id(10) }]),time]);
      await db.query("insert into shifts(id,venue_id,dancer_id) values($1,$2,$3)", [id(1000 + venue * 10 + i),id(venue),id(10)]);
      await db.query('insert into going_signals values($1,$2)', [id(1000 + venue * 10 + i),time]);
      for (const type of ['dancer_profile','club_page','directions','free_entry','transport']) {
        await db.query("insert into venue_interactions(id,venue_id,dancer_id,occurred_at,event_type,source,session_id) values(gen_random_uuid(),$1,$2,$3,$4,'dancer_profile','test-browser')",[id(venue),id(10),time,type]);
      }
      await db.query("insert into qr_redemptions(id,venue_id,dancer_id,admission_pass_version,status,generated_at,redeemed_at,source_type) values(gen_random_uuid(),$1,$2,1,'redeemed',$3,$3::timestamptz+interval '1 hour','dancer_profile'),(gen_random_uuid(),$1,$2,1,'expired',$3,null,'dancer_profile')",[id(venue),id(10),time]);
    }
  }
  for (const [start, count] of [['2026-10-12T00:00:00Z',1],['2026-10-05T12:00:00Z',2],['2026-09-12T12:00:00Z',3],['1970-01-01T00:00:00Z',4]]) {
    const { result } = (await db.query("select get_venue_performance_analytics($1,$2,$3,'2026-10-12T00:00Z','2026-10-13T00:00Z') result",[id(1),start,end])).rows[0];
    assert.equal(result.performance.dancers.length,1);
    const dancer = result.performance.dancers[0];
    assert.equal(dancer.results.checkIns,count); assert.equal(dancer.results.checkOuts,count);
    assert.equal(dancer.internal.checkedInHours,count);
    assert.equal(new Date(dancer.results.lastCheckInAt).toISOString(),'2026-10-12T10:00:00.000Z');
    assert.equal(dancer.internal.requests,count); assert.equal(dancer.internal.completed,count);
    assert.equal(dancer.results.profileConversions,count); assert.equal(dancer.results.profileClaims,count*2);
    assert.equal(dancer.results.profileConversionPercent,50);
    assert.equal(dancer.vip.requests,count); assert.equal(dancer.vip.repeatRequesters,1);
    for (const key of ['dancer_profile','club_page','directions','free_entry','transport','going']) assert.equal(dancer.external[key],count,key);
  }
});

test('all-time reports remain service-only and arbitrary long or invalid ranges stay rejected', async () => {
  const call = (since,until='2026-10-12') => db.query("select get_venue_performance_analytics($1,$2,$3,'2026-10-12','2026-10-13')",[id(1),since,until]);
  await rejected(() => call('2026-01-01'), /31 days/);
  await rejected(() => call('1970-01-01','infinity'), /31 days/);
  await rejected(() => call(null), /31 days/);
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`); await rejected(() => call('1970-01-01'),/permission denied/); await db.exec('reset role');
  }
  await db.exec('set role service_role'); await call('1970-01-01'); await db.exec('reset role');
});

test('automatic VIP scoring excludes customer withdrawals and duplicate selections, not staff booking decisions', async () => {
  const insert = async (n, user, status, reviewer, ago, venue=1, dancers=[10,10]) => db.query(
    "insert into venue_vip_requests(id,venue_id,user_id,reviewed_by,dancers,status,starts_at,created_at) values($1,$2,$3,$4,$5,$6,now(),now()-$7::interval)",
    [id(n),id(venue),id(user),reviewer ? id(reviewer) : null,JSON.stringify(dancers.map(n=>({id:id(n)}))),status,ago]);
  await insert(3000,53,'cancelled',53,'10 days'); // Withdrawn history is not a repeat visit/request.
  await insert(3001,54,'declined',50,'10 days'); // Staff decision preserves expressed customer interest.
  await insert(3002,53,'pending',null,'1 day');
  await insert(3003,54,'confirmed',50,'1 day');
  await insert(3004,55,'cancelled',50,'1 day'); // Staff cancellation still represents demand.
  await insert(3005,56,'cancelled',56,'1 day'); // Customer withdrawal does not.
  await insert(3006,57,'pending',null,'1 day',2);
  let r=await report(); let vip=r.dancers.find(d=>d.id===id(10)).vip;
  assert.equal(vip.requests,4); assert.equal(vip.scoringRequests,3);
  assert.equal(vip.scoringUniqueRequesters,3); assert.equal(vip.scoringRepeatRequesters,1);
  assert.equal(vip.customerWithdrawals,1);
  assert.equal(JSON.stringify(r).includes(id(53)),false, 'guest identity must not leave the aggregate');
  await db.query("update venue_vip_requests set status='declined',reviewed_by=$1 where id=$2",[id(50),id(3002)]);
  r=await report(); assert.equal(r.dancers.find(d=>d.id===id(10)).vip.scoringRequests,3);
  await db.query("update venue_vip_requests set status='cancelled',reviewed_by=user_id where id=$1",[id(3003)]);
  r=await report(); vip=r.dancers.find(d=>d.id===id(10)).vip;
  assert.equal(vip.scoringRequests,2); assert.equal(vip.scoringRepeatRequesters,0);
});
