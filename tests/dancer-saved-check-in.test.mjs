import assert from 'node:assert/strict';
import test, {before, beforeEach, afterEach, after} from 'node:test';
import {createSavedCheckInDatabase} from './helpers/saved-check-in-database.mjs';
import {fixtureId as id} from './helpers/dancer-tap-database.mjs';

let pg;
const tap = (tag=id(30),key=id(50),user=id(1),visibility='internal') => pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5) result',[tag,user,key,visibility,{}]).then(r=>r.rows[0].result);
const request = (venue=id(20)) => pg.query('select * from public.club_dancer_approvals where venue_id=$1 and dancer_id=$2',[venue,id(10)]).then(r=>r.rows[0]);
async function approveMedia(venue=id(20)) {
  await pg.query(`insert into public.club_media_permissions(venue_id,dancer_id,source,media_id,content_version,decision)
    select $1,dancer_id,source,id,content_version,'approved' from public.dancer_club_media(array[$2]::uuid[])
    on conflict(venue_id,source,media_id) do nothing`,[venue,id(10)]);
}
const review = async(decision='approved',actor=id(2),venue=id(20),revision,reviewMedia=true) => {
  if(decision==='approved' && reviewMedia) await approveMedia(venue);
  return pg.query('select public.review_club_dancer_approval_and_check_in($1,$2,$3,$4,$5) result',[actor,venue,id(10),revision || (await request(venue)).revision,decision]).then(r=>r.rows[0].result);
};
const count = table => pg.query(`select count(*)::int n from public.${table} where dancer_id=$1`,[id(10)]).then(r=>r.rows[0].n);
async function rejects(action,code){await pg.exec('savepoint expected_error');await assert.rejects(action,{code});await pg.exec('rollback to expected_error');}
before(async()=>{pg=await createSavedCheckInDatabase();});
beforeEach(async()=>pg.exec('begin;set role service_role'));
afterEach(async()=>pg.exec('rollback;reset role'));
after(async()=>pg?.close());

const finalize=()=>pg.query('select public.finalize_pending_dancer_nfc_enrollment($1,$2,$3) result',[id(1),id(99),{tappedAt:'2099-01-01',visibility:'external'}]).then(r=>r.rows[0].result);
const enrollment=()=>pg.query('select * from public.dancer_nfc_enrollments where dancer_user_id=$1 and venue_id=$2',[id(1),id(20)]).then(r=>r.rows[0]);

test('new dancers complete their saved first tap when club and media approvals are ready',async()=>{
  await tap();const before=await enrollment();const result=await review();
  assert.equal(result.shiftCheckedIn,true);assert.equal(result.requiresNewTap,false);
  assert.equal(Date.parse(result.workingUntil)-before.tapped_at,6*3600_000);
  const profile=(await pg.query('select * from public.dancer_profiles where id=$1',[id(10)])).rows[0];
  assert.equal(profile.status,'approved');assert.equal(profile.is_public,false);
  assert.equal((await enrollment()).status,'completed');
  assert.equal((await tap()).shiftCheckedIn,true);assert.equal(await count('shifts'),1);
  await finalize();assert.equal(await count('shifts'),1);
});

test('media approval after club approval completes the same tap without resetting its clock',async()=>{
  await tap();await pg.query("update public.dancer_nfc_enrollments set tapped_at=now()-interval '2 hours' where dancer_user_id=$1",[id(1)]);
  const before=await enrollment();
  await pg.query("update public.dancer_photos set review_status='pending' where dancer_id=$1 and sort_order>1",[id(10)]);
  const pending=await review();assert.equal(pending.checkInStatus,'media_pending');assert.equal(pending.requiresNewTap,false);
  assert.equal((await enrollment()).status,'pending');assert.equal(await count('shifts'),0);
  await pg.query("update public.dancer_photos set review_status='approved' where dancer_id=$1",[id(10)]);
  await approveMedia();
  const result=await finalize();assert.equal(result.shiftCheckedIn,true);
  assert.equal(Date.parse(result.workingUntil)-before.tapped_at,6*3600_000);
  const shift=(await pg.query('select * from public.shifts where id=$1',[result.shiftId])).rows[0];
  assert.equal(+shift.nfc_last_tapped_at,+before.tapped_at);
  assert.equal(Date.parse((await tap()).nextTapAllowedAt)-before.tapped_at,12*3600_000);
  assert.equal((await pg.query('select visibility from public.dancer_shift_channels where shift_id=$1',[result.shiftId])).rows[0].visibility,'internal');
});

test('expired saved taps activate approved profiles but require a fresh tap for Working Now',async()=>{
  await tap();await pg.query("update public.dancer_nfc_enrollments set tapped_at=now()-interval '7 hours' where dancer_user_id=$1",[id(1)]);
  const result=await review();assert.equal(result.checkInStatus,'tap_expired');assert.equal(result.requiresNewTap,true);
  assert.equal(result.shiftCheckedIn,false);assert.equal(await count('shifts'),0);
  assert.equal((await pg.query('select status from public.dancer_profiles where id=$1',[id(10)])).rows[0].status,'approved');
  assert.equal((await finalize()).shiftCheckedIn,false);
  assert.equal((await tap(id(30),id(51))).shiftCheckedIn,true);
});

test('an unapproved club cannot block another approved saved tap',async()=>{
  await tap(id(30),id(50));await tap(id(31),id(51));
  await pg.query("update public.dancer_photos set review_status='pending' where dancer_id=$1 and sort_order>1",[id(10)]);
  await review('approved',id(6),id(21));
  await pg.query("update public.dancer_photos set review_status='approved' where dancer_id=$1",[id(10)]);
  await approveMedia(id(21));const result=await finalize();
  assert.equal(result.shiftCheckedIn,true);assert.equal(result.venueId,id(21));assert.equal((await request()).status,'pending');
});

for(const reason of ['club','age','agreement','media','revoked','tag'])test(`${reason} approval or eligibility cannot be bypassed by completion`,async()=>{
  await tap();await pg.query("update public.dancer_photos set review_status='pending' where dancer_id=$1 and sort_order>1",[id(10)]);
  if(reason!=='club')await review();
  await pg.query("update public.dancer_photos set review_status='approved' where dancer_id=$1",[id(10)]);await approveMedia();
  if(reason==='age')await pg.query("update public.dancer_age_verifications set verified_at=now()+interval '1 hour' where user_id=$1",[id(1)]);
  if(reason==='agreement')await pg.exec('reset role;delete from public.dancer_agreement_acceptances;set role service_role');
  if(reason==='media')await pg.query("update public.club_media_permissions set decision='rejected' where dancer_id=$1",[id(10)]);
  if(reason==='revoked')await pg.query("update public.venue_dancer_affiliations set status='revoked',revoked_at=now() where dancer_id=$1",[id(10)]);
  if(reason==='tag')await pg.query("update public.nfc_tags set status='disabled' where id=$1",[id(30)]);
  const result=await finalize();assert.equal(result.shiftCheckedIn,false);assert.equal(await count('shifts'),0);
});

for(const ended of [false,true])test(`completion preserves ${ended?'cooldown':'another club’s active shift'}`,async()=>{
  await tap(id(30),id(50));await tap(id(31),id(51),id(1),'external');
  assert.equal((await review('approved',id(6),id(21))).shiftCheckedIn,true);
  if(ended)await pg.query('update public.shifts set checked_out_at=clock_timestamp() where dancer_id=$1',[id(10)]);
  const result=await review();assert.equal(result.shiftCheckedIn,false);assert.equal(await count('shifts'),1);
  assert.equal(result.checkInStatus,ended?'cooldown':'active_other_club');
  assert.equal((await pg.query('select visibility from public.dancer_channel_preferences where dancer_id=$1',[id(10)])).rows[0].visibility,'external');
  assert.equal((await pg.query('select is_public from public.dancer_profiles where id=$1',[id(10)])).rows[0].is_public,true);
});

test('stale media permission cannot approve a replaced photo version',async()=>{
  await tap();await pg.query("update public.dancer_photos set review_status='pending' where dancer_id=$1 and sort_order>1",[id(10)]);
  await review();await pg.query("update public.dancer_photos set review_status='approved',storage_path=storage_path||'-replaced' where dancer_id=$1",[id(10)]);
  assert.equal((await finalize()).checkInStatus,'media_pending');assert.equal(await count('shifts'),0);
  await pg.query('delete from public.club_media_permissions where dancer_id=$1',[id(10)]);await approveMedia();
  assert.equal((await finalize()).shiftCheckedIn,true);
});

test('completion remains private to trusted server callers',async()=>{
  for(const signature of ['public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb)','public.complete_saved_dancer_check_in(uuid)','public.finalize_pending_dancer_nfc_enrollment(uuid,uuid,jsonb)']){
    for(const role of ['anon','authenticated'])assert.equal((await pg.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);
    assert.equal((await pg.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,true);
  }
});

async function pendingUploads() {
  await pg.query('delete from public.dancer_photos where dancer_id=$1',[id(10)]);
  await pg.query('update public.dancer_profiles set avatar_storage_path=null where id=$1',[id(10)]);
  for(const [index,context] of ['profile_main','profile_gallery:2','profile_gallery:3'].entries()) {
    await pg.query("insert into public.image_moderation_records values($1,$2,'review',$3,$4,'add',null)",[id(2000+index),id(1),'synthetic/pending-'+index,context]);
  }
}

test('first tap accepts a submitted profile with only pending photos and an unapproved avatar',async()=>{
  await pendingUploads();const result=await tap();
  assert.equal(result.enrollmentStatus,'pending');assert.equal(result.clubApprovalStatus,'pending');assert.equal(result.shiftCheckedIn,false);
  assert.equal(await count('shifts'),0);assert.equal(await count('venue_dancer_affiliations'),0);
  assert.equal((await pg.query('select is_public from public.dancer_profiles where id=$1',[id(10)])).rows[0].is_public,false);
  assert.equal((await finalize()).checkInStatus,'club_pending');
  const first=await enrollment();assert.equal((await tap()).replayed,true);assert.equal(+(await enrollment()).tapped_at,+first.tapped_at);
});

test('a new tap at an approved club can stay saved while required media is pending',async()=>{
  await tap();await pg.query("update public.dancer_photos set review_status='pending' where dancer_id=$1 and sort_order>1",[id(10)]);
  await review();await pendingUploads();
  const result=await tap(id(30),id(51));assert.equal(result.enrollmentStatus,'pending');assert.equal(result.clubApprovalStatus,'approved');
  assert.equal(result.shiftCheckedIn,false);assert.equal((await finalize()).checkInStatus,'media_pending');
  for(const n of [0,1,2])await pg.query("insert into public.dancer_photos(id,dancer_id,storage_path,review_status,sort_order,is_primary) values($1,$2,$3,'approved',$4,$5)",[id(3000+n),id(10),'synthetic/approved-'+n,n+1,n===0]);
  await pg.query("update public.dancer_profiles set avatar_storage_path='synthetic/avatar' where id=$1",[id(10)]);await approveMedia();
  assert.equal((await finalize()).shiftCheckedIn,true);assert.equal(await count('shifts'),1);
});

for(const blocked of ['age','draft','main','count','rejected'])test(`pending uploads cannot bypass missing ${blocked}`,async()=>{
  await pendingUploads();
  if(blocked==='age')await pg.query("update public.dancer_age_verifications set status='pending',verified_at=null where user_id=$1",[id(1)]);
  if(blocked==='draft')await pg.query("update public.dancer_profiles set status='draft' where id=$1",[id(10)]);
  if(blocked==='main')await pg.exec("update public.image_moderation_records set upload_context='profile_gallery:1' where upload_context='profile_main'");
  if(blocked==='count')await pg.exec("delete from public.image_moderation_records where upload_context='profile_gallery:3'");
  if(blocked==='rejected')await pg.exec("update public.image_moderation_records set decision='rejected'");
  await rejects(()=>tap(),'42501');assert.equal(await count('shifts'),0);assert.equal(await enrollment(),undefined);
});

for (const status of ['uploading','moderating','rejected','hidden','expired']) test(status+' videos cannot satisfy first submission or first tap',async()=>{
 await pg.query('update public.mydancr_tv_videos set status=$1',[status]);
 assert.equal((await pg.query('select dancer_submission_media($1) value',[id(10)])).rows[0].value.videoCount,0);
 await rejects(()=>tap(),'42501');
 await rejects(()=>pg.query("update dancer_profiles set status='pending_review' where id=$1",[id(10)]),'23514');
});
test('video count excludes feed-only and failed file preparation',async()=>{
 for(const change of ["distribution_scope='feed_only'","status='submitted',moderation_details='{}'","status='submitted',upload_validation_pending=true"]){
  await pg.query("update mydancr_tv_videos set status='approved',distribution_scope='profile_and_feed',moderation_details='{\"fileChecksPassed\":true}',upload_validation_pending=false");
  await pg.query('update mydancr_tv_videos set '+change);
  assert.equal((await pg.query('select dancer_submission_media($1) value',[id(10)])).rows[0].value.videoCount,0);
 }
});
test('prepared pending video permits submission, but first activation requires final approval',async()=>{
 await pg.query("update mydancr_tv_videos set status='submitted'");
 await pg.query("update dancer_profiles set status='pending_review' where id=$1",[id(10)]);
 await rejects(()=>pg.query("update dancer_profiles set status='approved',verification_status='approved' where id=$1",[id(10)]),'23514');
 await tap();const original=await enrollment();const result=await review();assert.equal(result.checkInStatus,'media_pending');assert.equal(result.shiftCheckedIn,false);
 await pg.query("update mydancr_tv_videos set status='approved'");const completed=await finalize();assert.equal(completed.shiftCheckedIn,true);
 assert.equal(Date.parse(completed.workingUntil)-original.tapped_at,6*3600_000);
});
test('returning approved profiles are not sent back through the new video requirement',async()=>{
 await tap();await review();await pg.query('delete from mydancr_tv_videos');
 await pg.query("update dancer_profiles set status='approved' where id=$1",[id(10)]);
 assert.equal((await tap(id(30),id(51))).shiftCheckedIn,true);
});
