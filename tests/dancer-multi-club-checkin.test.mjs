import assert from 'node:assert/strict';
import test,{before,beforeEach,afterEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createSavedCheckInDatabase} from './helpers/saved-check-in-database.mjs';
import {fixtureId as id} from './helpers/dancer-tap-database.mjs';
let db;
const migration=readFileSync(new URL('../supabase/migrations/20261029215306_multi_club_checkin_media_eligibility.sql',import.meta.url),'utf8');
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
 language sql as $$select p.id,p.dancer_id,'photo','photo',md5(p.storage_path),p.id,jsonb_build_object('status',p.review_status)
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

test('checkout at A permits a fresh tap at B, but does not reset A cooldown',async()=>{
 const first=await tap();assert.equal(first.shiftCheckedIn,true);
 await rejectCall(()=>tap(21,52),/NFC_ACTIVE_OTHER_CLUB/);
 await end();const second=await tap(21,53);assert.equal(second.shiftCheckedIn,true);assert.equal(second.venueId,id(21));
 assert.equal((await query('select count(*)::int n from shifts where dancer_id=$1 and checked_out_at is null',[id(10)]))[0].n,1);
 await end();await rejectCall(()=>tap(20,54),/NFC_COOLDOWN_ACTIVE/);
});
test('retapping never extends a shift and replays never switch clubs',async()=>{
 const a=await tap();const repeated=await tap(20,52);assert.equal(repeated.workingUntil,a.workingUntil);assert.equal(repeated.tapApplied,false);
 await end();await tap(21,53);const replay=await tap(20,51);assert.equal(replay.replayed,true);
 assert.equal((await query('select venue_id from shifts where dancer_id=$1 and checked_out_at is null',[id(10)]))[0].venue_id,id(21));
});
test('an expired A session permits B while the A cooldown remains',async()=>{
 await tap();await db.query("update shifts set nfc_last_tapped_at=now()-interval '7 hours',checked_in_at=now()-interval '7 hours',last_location_verified_at=now()-interval '7 hours',location_verification_expires_at=now()-interval '1 hour' where dancer_id=$1",[id(10)]);
 assert.equal((await tap(21,52)).shiftCheckedIn,true);
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
