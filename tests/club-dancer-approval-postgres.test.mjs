import assert from 'node:assert/strict';
import test, {before, beforeEach, afterEach, after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createInternalRosterDatabase} from './helpers/internal-roster-database.mjs';
import {fixtureId as id} from './helpers/dancer-tap-database.mjs';

let pg;
const source = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const tap = (tag=id(30),key=id(50),user=id(1),visibility='internal') => pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5) result',[tag,user,key,visibility,{}]).then(r=>r.rows[0].result);
const request = (venue=id(20)) => pg.query('select * from public.club_dancer_approvals where venue_id=$1 and dancer_id=$2',[venue,id(10)]).then(r=>r.rows[0]);
const review = async(decision='approved',actor=id(2),venue=id(20),revision) => pg.query('select public.review_club_dancer_approval($1,$2,$3,$4,$5) result',[actor,venue,id(10),revision || (await request(venue)).revision,decision]).then(r=>r.rows[0].result);
const count = table => pg.query(`select count(*)::int n from public.${table} where dancer_id=$1`,[id(10)]).then(r=>r.rows[0].n);
async function rejects(action,code){await pg.exec('savepoint expected_error');await assert.rejects(action,{code});await pg.exec('rollback to expected_error');}
before(async()=>{
  pg=await createInternalRosterDatabase();
  await pg.exec(`reset role;alter table public.venue_dancer_affiliations add column reentry_blocked boolean not null default false;
    create table public.dancer_age_verification_settings(singleton boolean primary key,enabled boolean);
    insert into public.dancer_age_verification_settings values(true,true);`);
  for(const fn of JSON.parse(source('tests/fixtures/club-join-tap-functions.json')).functions) await pg.exec(fn.source);
  for(const dancer of [10,11])for(const n of [1,2])await pg.query("insert into public.dancer_photos(id,dancer_id,storage_path,review_status,sort_order) values($1,$2,$3,'approved',$4)",[id(dancer*100+n),id(dancer),`synthetic/extra-${dancer}-${n}`,n+1]);
  await tap(id(30),id(49),id(5));
  await pg.exec(source('supabase/migrations/20261023091937_club_dancer_join_approval.sql'));
  await pg.exec(source('supabase/migrations/20261023093339_club_approval_returning_dancer_taps.sql'));
});
beforeEach(async()=>pg.exec('begin;set role service_role'));
afterEach(async()=>pg.exec('rollback;reset role'));
after(async()=>pg?.close());

test('first club tap creates an idempotent pending request without affiliation, shift, or visibility changes',async()=>{
  const result=await tap();
  assert.equal(result.clubApprovalStatus,'pending');assert.equal(result.shiftCheckedIn,false);assert.equal(result.profileActivated,false);
  assert.equal(await count('venue_dancer_affiliations'),0);assert.equal(await count('shifts'),0);assert.equal(await count('dancer_channel_preferences'),0);
  assert.equal((await pg.query('select is_public from public.dancer_profiles where id=$1',[id(10)])).rows[0].is_public,false);
  assert.deepEqual(await tap(),{...result,replayed:true});
  assert.equal((await pg.query('select count(*)::int n from public.nfc_tap_events where actor_user_id=$1',[id(1)])).rows[0].n,1);
  assert.equal((await request()).status,'pending');
});

test('owner approval does not activate remotely; a fresh tap activates only the approved club',async()=>{
  await tap();const result=await review();assert.equal(result.requiresNewTap,true);
  assert.equal(await count('venue_dancer_affiliations'),0);assert.equal(await count('shifts'),0);
  const finalized=(await pg.query('select public.finalize_pending_dancer_nfc_enrollment($1,$2,$3) result',[id(1),id(1),{}])).rows[0].result;
  assert.equal(finalized.enrollmentStatus,'pending');assert.equal(await count('venue_dancer_affiliations'),0);
  assert.equal((await tap()).clubApprovalStatus,'pending','Replay is not a fresh physical tap');
  const checked=await tap(id(30),id(51));assert.equal(checked.shiftCheckedIn,true);assert.equal(checked.enrollmentStatus,'completed');
  assert.equal(await count('venue_dancer_affiliations'),1);assert.equal(await count('shifts'),1);
  await rejects(()=>tap(id(31),id(52)),'40001');
  await pg.query("update public.shifts set checked_out_at=clock_timestamp(),nfc_last_tapped_at=now()-interval '13 hours' where dancer_id=$1",[id(10)]);
  const second=await tap(id(31),id(53));assert.equal(second.clubApprovalStatus,'pending');assert.equal(second.venueId,id(21));
  assert.equal((await request()).status,'approved');assert.equal((await request(id(21))).status,'pending');
});

test('an already activated account still needs approval from its next club',async()=>{
  await pg.query("update public.shifts set checked_out_at=clock_timestamp(),nfc_last_tapped_at=now()-interval '13 hours' where dancer_id=$1",[id(11)]);
  const before=(await pg.query('select is_public from public.dancer_profiles where id=$1',[id(11)])).rows[0];
  const result=await tap(id(31),id(51),id(5),'external');assert.equal(result.clubApprovalStatus,'pending');assert.equal(result.shiftCheckedIn,false);
  assert.deepEqual((await pg.query('select is_public from public.dancer_profiles where id=$1',[id(11)])).rows[0],before);
  assert.equal((await pg.query('select count(*)::int n from public.venue_dancer_affiliations where venue_id=$1 and dancer_id=$2',[id(21),id(11)])).rows[0].n,0);
});

test('legacy NFC helpers and direct affiliation writes cannot bypass the club decision',async()=>{
  await tap();
  await rejects(()=>pg.query('select public.approve_dancer_venue_affiliation_from_nfc($1,$2,$3,$4)',[id(30),id(1),id(51),{}]),'42501');
  await rejects(()=>pg.query('select public.register_dancer_nfc_enrollment($1,$2,$3,$4)',[id(30),id(1),id(51),{}]),'42501');
  await rejects(()=>pg.query("insert into public.venue_dancer_affiliations(venue_id,dancer_id,status,approved_by_user_id) values($1,$2,'active',$3)",[id(20),id(10),id(2)]),'42501');
  await review();
  await rejects(()=>pg.query('select public.approve_dancer_venue_affiliation_from_nfc($1,$2,$3,$4)',[id(30),id(1),id(51),{}]),'42501');
  assert.equal(await count('venue_dancer_affiliations'),0);
});

test('declines survive retaps and can only be reconsidered by this club',async()=>{
  await tap();const oldRevision=(await request()).revision;await review('rejected');
  assert.equal((await tap(id(30),id(51))).clubApprovalStatus,'rejected');
  await rejects(()=>review('approved',id(6)),'42501');
  await rejects(()=>review('approved',id(2),id(20),oldRevision),'40001');
  assert.equal(await count('shifts'),0);
  await review();assert.equal((await tap(id(30),id(52))).shiftCheckedIn,true);
});

test('only active owners and managers can decide, and suspended clubs cannot accept taps',async()=>{
  await tap();
  for(const actor of [id(1),id(3),id(4),id(6)])await rejects(()=>review('approved',actor),'42501');
  await pg.query("insert into public.venue_team_members(venue_id,user_id,status,role) values($1,$2,'active','staff')",[id(20),id(6)]);
  await rejects(()=>review('approved',id(6)),'42501');
  await pg.exec("update public.venue_team_members set role='manager',status='disabled'");
  await rejects(()=>review('approved',id(6)),'42501');
  await pg.exec("update public.venue_team_members set status='active'");
  assert.equal((await review('approved',id(6))).status,'approved');
  await pg.query('update public.venues set is_active=false where id=$1',[id(21)]);
  await rejects(()=>tap(id(31),id(51)),'42501');
});

test('expired requests need a fresh tap before review and stale decisions are rejected',async()=>{
  await tap();await pg.query("update public.dancer_nfc_enrollments set expires_at=now()-interval '1 second' where dancer_user_id=$1",[id(1)]);
  await rejects(()=>review(),'40001');await tap(id(30),id(51));await review();
  await rejects(()=>review('rejected'),'40001');
});

test('existing club relationships stay approved and removal blocks still apply',async()=>{
  assert.equal((await tap(id(30),id(51),id(5))).enrollmentStatus,'completed');
  assert.equal((await pg.query('select grandfathered from public.club_dancer_approvals where dancer_id=$1',[id(11)])).rows[0].grandfathered,true);
  await tap();await review();await tap(id(30),id(51));
  await pg.query("update public.venue_dancer_affiliations set status='revoked',revoked_at=clock_timestamp(),revoked_by_user_id='97000000-0000-4000-8000-000000000002',reentry_blocked=true where dancer_id=$1",[id(10)]);
  await rejects(()=>tap(id(30),id(52)),'42501');
});

test('browser roles cannot read decisions, forge approval, or call privileged functions',async()=>{
  await tap();const revision=(await request()).revision;
  for(const role of ['anon','authenticated']){
    await pg.exec('reset role;set role '+role);
    await rejects(()=>pg.query('select * from public.club_dancer_approvals'),'42501');
    await rejects(()=>pg.query("update public.club_dancer_approvals set status='approved'"),'42501');
    await rejects(()=>review('approved',id(2),id(20),revision),'42501');
    await rejects(()=>tap(),'42501');
  }
});

test('a returning dancer keeps club approval but needs a new tap after removal',async()=>{
  await tap();await review();await tap(id(30),id(51));
  await pg.query("update public.venue_dancer_affiliations set status='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=$1,reentry_blocked=true where dancer_id=$2",[id(2),id(10)]);
  await rejects(()=>tap(id(30),id(52)),'42501');
  await pg.query('update public.venue_dancer_affiliations set reentry_blocked=false where dancer_id=$1',[id(10)]);
  await rejects(()=>pg.query('select public.approve_dancer_venue_affiliation_from_nfc($1,$2,$3,$4)',[id(30),id(1),id(52),{}]),'42501');
  await pg.query("update public.shifts set checked_out_at=clock_timestamp(),nfc_last_tapped_at=now()-interval '13 hours' where dancer_id=$1",[id(10)]);
  const result=await tap(id(30),id(52));assert.equal(result.shiftCheckedIn,true);assert.equal(result.affiliationActivated,true);
  assert.equal((await request()).status,'approved');
});
