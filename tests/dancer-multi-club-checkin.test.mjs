import assert from 'node:assert/strict';
import test,{before,beforeEach,afterEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createSavedCheckInDatabase} from './helpers/saved-check-in-database.mjs';
import {fixtureId as id} from './helpers/dancer-tap-database.mjs';
let db, activationBeforeDemoCleanup;
const migration=readFileSync(new URL('../supabase/migrations/20261029215306_multi_club_checkin_media_eligibility.sql',import.meta.url),'utf8');
const demoCleanup=readFileSync(new URL('../supabase/migrations/20261103055741_preserve_demo_shift_cleanup.sql',import.meta.url),'utf8');
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const tap=(venue=20,session=51)=>query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5) result',[id(venue===20?30:31),id(1),id(session),'internal',{}]).then(r=>r[0].result);
const end=()=>db.exec("update shifts set checked_out_at=clock_timestamp(),location_verification_expires_at=clock_timestamp() where dancer_id='"+id(10)+"' and checked_out_at is null");
async function rejectCall(fn,message){await db.exec('savepoint expected_error');await assert.rejects(fn,message);await db.exec('rollback to expected_error');}
async function permissions(venue){await db.query(`insert into club_media_permissions(venue_id,dancer_id,source,media_id,content_version,decision)
 select $1,dancer_id,source,id,content_version,'approved' from dancer_club_media(array[$2]::uuid[]) on conflict do nothing`,[id(venue),id(10)]);}
before(async()=>{
 db=await createSavedCheckInDatabase();
 await db.exec(`create table dancer_media_batches(dancer_id uuid,venue_id uuid,state text);
 grant all on dancer_media_batches to service_role;
 create or replace function public.dancer_club_media(ids uuid[]) returns table(id uuid,dancer_id uuid,source text,kind text,content_version text,photo_id uuid,record jsonb)
 language sql as $$select p.id,p.dancer_id,'photo','photo',md5(p.storage_path),p.id,jsonb_build_object('status',p.review_status,'upload_context','profile_gallery')
 from public.dancer_photos p where p.dancer_id=any(ids)
 union all select v.id,v.dancer_id,'video','video',v.id::text,null,jsonb_build_object('status',v.status)
 from public.mydancr_tv_videos v where v.dancer_id=any(ids)$$;
 create function public.club_approved_media(venue uuid,ids uuid[]) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('dancerId',m.dancer_id,'photoId',m.photo_id,
 'videoId',case when m.kind='video' then m.id end,'isMain',coalesce(p.is_primary,false))),'[]')
 from public.dancer_club_media(ids) m join public.club_media_permissions a on a.media_id=m.id and a.source=m.source
 and a.content_version=m.content_version and a.venue_id=venue and a.decision='approved'
 left join public.dancer_photos p on p.id=m.photo_id where m.record->>'status'='approved'$$;`);
 const eligibility=migration.slice(migration.indexOf('create function private.club_media_eligibility'),migration.indexOf('create function public.dancer_club_media_requirements'));
 await db.exec('drop function public.club_public_media(uuid,uuid[])');
 await db.exec(eligibility);
 for(const name of ['activate_dancer_shift_from_nfc','register_dancer_channel_tap','complete_saved_dancer_check_in']){
  const fn=migration.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$[\\s\\S]*?\\$function\\$','i'))?.[0];
  assert.ok(fn,name);await db.exec(fn);
 }
 await db.exec('grant usage on schema private to service_role;grant execute on all functions in schema private to service_role');
 await db.exec(readFileSync(new URL('../supabase/migrations/20261031004744_nfc_business_conflict_sqlstates.sql',import.meta.url),'utf8'));
 const read=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
 await db.exec(`alter table image_moderation_records add column editor_venue_id uuid,add column image_id uuid;
 alter table mydancr_tv_videos add column editor_venue_id uuid;
 create table dancer_club_media_edits(dancer_id uuid,venue_id uuid,kind text,media_id uuid,removed boolean);
 grant all on dancer_club_media_edits to service_role;`);
 const editor=read('20261029071856_club_scoped_dancer_editor.sql');
 await db.exec(editor.slice(editor.indexOf('create function private.editor_media_origin'),editor.indexOf('alter function public.club_public_media')));
 const offshift=read('20261029090504_submit_off_shift_media_on_check_in.sql');
 await db.exec(offshift.slice(offshift.indexOf('create table public.dancer_club_starting_profiles'),offshift.indexOf('create function private.seed_first_club_profile')));
 await db.exec(read('20261031005946_club_join_review_scoped_media.sql'));
 await db.exec('grant execute on all functions in schema private to service_role');
 activationBeforeDemoCleanup=(await query("select pg_get_functiondef('public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb)'::regprocedure) definition"))[0].definition;
 await db.exec(demoCleanup);
});
beforeEach(async()=>{
 await db.exec('begin;set role service_role');
 await db.query("update dancer_profiles set status='approved',verification_status='approved',approved_at=now(),venue_approved_at=now() where id=$1",[id(10)]);
 for(const venue of [20,21]){
  await db.query("insert into club_dancer_approvals(venue_id,dancer_id,status,reviewed_at,grandfathered) values($1,$2,'approved',now(),true) on conflict(venue_id,dancer_id) do update set status='approved',reviewed_at=now(),grandfathered=true",[id(venue),id(10)]);
  await db.query("insert into venue_dancer_affiliations(venue_id,dancer_id,status,approved_at,approved_by_user_id) values($1,$2,'active',now(),$3) on conflict(venue_id,dancer_id) do update set status='active',revoked_at=null",[id(venue),id(10),id(venue===20?2:6)]);
  await permissions(venue);
 }
});
afterEach(()=>db.exec('rollback;reset role'));
after(()=>db?.close());

async function reviewB(){
 const [{revision}]=await query('select revision from club_dancer_approvals where venue_id=$1 and dancer_id=$2',[id(21),id(10)]);
 return (await query("select review_club_dancer_approval_and_check_in($1,$2,$3,$4,'approved') result",[id(6),id(21),id(10),revision]))[0].result;
}
async function pendingB(){
 await db.query("update club_dancer_approvals set status='pending',reviewed_at=null,reviewed_by=null,grandfathered=false where venue_id=$1 and dancer_id=$2",[id(21),id(10)]);
 await tap(21);
}
test('club join ignores later media outside its frozen profile and removed media',async()=>{
 await db.query(`insert into dancer_club_starting_profiles(dancer_id,venue_id,source_venue_id,items)
 select $1,$2,$3,jsonb_agg(jsonb_build_object('source',source,'id',id)) from dancer_club_media(array[$1]::uuid[])`,[id(10),id(21),id(20)]);
 await db.query("insert into dancer_photos(id,dancer_id,storage_path,review_status) values($1,$2,'later-club-a.jpg','approved')",[id(999),id(10)]);
 await db.query("insert into dancer_club_media_edits values($1,$2,'photo',$3,true)",[id(10),id(21),id(1001)]);
 await db.query('delete from club_media_permissions where venue_id=$1 and media_id=$2',[id(21),id(1001)]);
 await pendingB();
 const result=await reviewB();assert.equal(result.status,'approved');
});
test('club join still requires decisions for media included in that club',async()=>{
 await db.query('delete from club_media_permissions where venue_id=$1 and media_id=$2',[id(21),id(1001)]);
 await pendingB();
 await rejectCall(reviewB,{message:'CLUB_PROFILE_MEDIA_REVIEW_REQUIRED',code:'P0001'});
});

test('checkout at A permits a fresh tap at B, but does not reset A cooldown',async()=>{
 const first=await tap();assert.equal(first.shiftCheckedIn,true);
 await rejectCall(()=>tap(21,52),{message:'NFC_ACTIVE_OTHER_CLUB',code:'P0001'});
 await end();const second=await tap(21,53);assert.equal(second.shiftCheckedIn,true);assert.equal(second.venueId,id(21));
 assert.equal((await query('select count(*)::int n from shifts where dancer_id=$1 and checked_out_at is null',[id(10)]))[0].n,1);
 await end();await rejectCall(()=>tap(20,54),{message:'NFC_COOLDOWN_ACTIVE',code:'P0001'});
});
test('retapping never extends a shift and replays never switch clubs',async()=>{
 const a=await tap();const repeated=await tap(20,52);assert.equal(repeated.workingUntil,a.workingUntil);assert.equal(repeated.tapApplied,false);
 await end();await tap(21,53);const replay=await tap(20,51);assert.equal(replay.replayed,true);
 assert.equal((await query('select venue_id from shifts where dancer_id=$1 and checked_out_at is null',[id(10)]))[0].venue_id,id(21));
});
test('an expired A session permits B while the A cooldown remains',async()=>{
 await tap();await db.query("update shifts set nfc_last_tapped_at=now()-interval '7 hours',checked_in_at=now()-interval '7 hours',last_location_verified_at=now()-interval '7 hours',location_verification_expires_at=now()-interval '1 hour' where dancer_id=$1",[id(10)]);
 assert.equal((await tap(21,52)).shiftCheckedIn,true);
 const [expired]=await query('select commission_tracking_stopped_at from shifts where dancer_id=$1 and venue_id=$2',[id(10),id(20)]);
 assert.ok(expired.commission_tracking_stopped_at,'Real expired NFC shifts still stop commission tracking');
});

test('an expired demo assignment closes without commissions and permits a real NFC check-in',async()=>{
 await db.query(`insert into shifts(id,dancer_id,venue_id,starts_at,ends_at,timezone,status,shift_source,
   checked_in_at,location_status,last_location_verified_at,location_verification_expires_at,working_status)
 values($1,$2,$3,now()-interval '7 hours',now()-interval '1 hour','America/Los_Angeles','posted','demo_locked',
   now()-interval '7 hours','club_confirmed',now()-interval '7 hours',now()-interval '1 hour','club_confirmed')`,[id(800),id(10),id(20)]);
 await db.exec('savepoint legacy_cleanup;reset role');
 await db.exec(activationBeforeDemoCleanup);
 await db.exec('set role service_role');
 await assert.rejects(()=>tap(),error=>error.code==='23514' && error.constraint==='shifts_demo_locked_no_nfc_or_commission_check');
 await db.exec('rollback to legacy_cleanup');
 assert.equal((await query('select checked_out_at from shifts where id=$1',[id(800)]))[0].checked_out_at,null,'The failed old cleanup rolled back');
 const result=await tap();
 assert.equal(result.shiftCheckedIn,true);assert.equal(result.tapApplied,true);assert.notEqual(result.shiftId,id(800));
 const [demo]=await query('select * from shifts where id=$1',[id(800)]);
 assert.equal(demo.shift_source,'demo_locked');assert.equal(demo.working_status,'ended');assert.ok(demo.checked_out_at);
 for(const field of ['nfc_tag_id','nfc_last_tapped_at','commission_tracking_started_at','commission_tracking_stopped_at'])assert.equal(demo[field],null,field);
 const [real]=await query('select * from shifts where id=$1',[result.shiftId]);
 assert.equal(real.shift_source,'nfc_presence');assert.equal(real.nfc_tag_id,id(30));assert.ok(real.commission_tracking_started_at);
 assert.equal(new Date(real.location_verification_expires_at)-new Date(real.checked_in_at),6*60*60*1000);
 const replay=await tap();assert.equal(replay.replayed,true);assert.equal(replay.shiftId,result.shiftId);
 assert.equal((await query('select count(*)::int n from shifts where dancer_id=$1 and checked_out_at is null',[id(10)]))[0].n,1);
});
for(const missing of ['photo','main','video'])test(`Club B cannot use Club A approval to satisfy missing ${missing}`,async()=>{
 const condition=missing==='photo'?"media_id='"+id(1001)+"'":missing==='main'?"media_id='"+id(110)+"'":"source='video'";
 await db.query("update club_media_permissions set decision='rejected' where venue_id=$1 and "+condition,[id(21)]);
 const pending=await tap(21);assert.equal(pending.enrollmentStatus,'pending');assert.equal(pending.checkInStatus,'media_pending');
 assert.equal((await query('select count(*)::int n from shifts where dancer_id=$1',[id(10)]))[0].n,0);
 const ready=await query('select private.club_media_ready($1,$2) ready',[id(20),id(10)]);assert.equal(ready[0].ready,true);
 await db.query("update club_media_permissions set decision='approved' where venue_id=$1",[id(21)]);
 const result=(await query('select complete_saved_dancer_check_in($1) result',[pending.enrollmentId]))[0].result;
 assert.equal(result.shiftCheckedIn,true);assert.equal(result.venueId,id(21));
});
test('direct activation cannot bypass a club media minimum',async()=>{
 await db.query("update club_media_permissions set decision='rejected' where venue_id=$1 and source='video'",[id(21)]);
 await rejectCall(()=>query('select activate_dancer_shift_from_nfc($1,$2,$3,$4)',[id(31),id(1),id(51),{}]),/NFC_CLUB_MEDIA_REQUIRED/);
});
test('late review of an older saved tap cannot reopen a club after a newer visit',async()=>{
 await db.query("update club_media_permissions set decision='rejected' where venue_id=$1 and source='video'",[id(20)]);
 const old=await tap();await tap(21,52);await end();
 await db.query("update club_media_permissions set decision='approved' where venue_id=$1",[id(20)]);
 const result=(await query('select complete_saved_dancer_check_in($1) result',[old.enrollmentId]))[0].result;
 assert.equal(result.shiftCheckedIn,false);assert.equal(result.requiresNewTap,true);
});
