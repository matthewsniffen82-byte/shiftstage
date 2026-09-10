import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createTapDatabase,seedTapDatabase,tap,tapSnapshot,tapSchema,tapSignature,fixtureId as id} from './helpers/dancer-tap-database.mjs';
let pg;before(async()=>{pg=await createTapDatabase();});beforeEach(async()=>seedTapDatabase(pg));after(async()=>pg?.close());
const row=(snapshot,table,key)=>snapshot[table].find(r=>r.id===key);
test('first eligible tap activates the profile, affiliates the club and starts Working Now together',async()=>{
 const before=await tapSnapshot(pg),result=await tap(pg),after=await tapSnapshot(pg);
 assert.equal(result.enrollmentStatus,'completed');assert.equal(result.profileActivated,true);assert.equal(result.affiliationActivated,true);assert.equal(result.shiftCheckedIn,true);assert.equal(result.tapApplied,true);assert.equal(result.venueId,id(20));
 const profile=row(after,'dancer_profiles',id(10));assert.equal(profile.status,'approved');assert.equal(profile.is_public,true);assert.equal(profile.verification_status,'approved');assert.equal(profile.venue_approved_venue_id,id(20));assert.equal(profile.avatar_storage_path,'synthetic/avatar');
 const shift=row(after,'shifts',result.shiftId);assert.equal(shift.shift_source,'nfc_presence');assert.equal(shift.venue_affiliation_id,result.id);assert.equal(shift.nfc_tag_id,id(30));assert.equal(shift.checked_out_at,null);assert.equal(shift.location_status,'club_confirmed');assert.equal(shift.checkin_latitude,null);
 assert.ok(Math.abs(Date.parse(shift.ends_at)-Date.parse(shift.starts_at)-6*3600000)<5);assert.ok(Math.abs(Date.parse(result.nextTapAllowedAt)-Date.parse(shift.checked_in_at)-12*3600000)<5);
 assert.equal(after.dancer_nfc_enrollments[0].status,'completed');assert.equal(after.nfc_tap_events.length,2);assert.equal(after.venue_dancer_affiliation_events.length,1);assert.equal(after.notifications.length,2);
 for(const table of ['app_users','dancer_photos','venues'])assert.deepEqual(after[table],before[table]);assert.deepEqual(row(after,'dancer_profiles',id(11)),row(before,'dancer_profiles',id(11)));
});
for(const [column,value]of [['status','draft'],['avatar_storage_path',null],['city',''],['stage_name','']])test('incomplete '+column+' saves only the pending tap',async()=>{
 await pg.query('update public.dancer_profiles set '+column+'=$1 where id=$2',[value,id(10)]);const before=await tapSnapshot(pg),result=await tap(pg),after=await tapSnapshot(pg);
 assert.equal(result.enrollmentStatus,'pending');assert.equal(result.profileActivated,false);assert.equal(result.shiftCheckedIn,false);assert.equal(after.shifts.length,0);assert.equal(after.venue_dancer_affiliations.length,0);assert.deepEqual(after.dancer_profiles,before.dancer_profiles);assert.equal(after.dancer_nfc_enrollments[0].status,'pending');assert.equal(after.nfc_tap_events.length,1);
});
test('media still awaiting approval cannot activate a profile',async()=>{
 await pg.query("update public.dancer_photos set review_status='pending' where dancer_id=$1",[id(10)]);assert.equal((await tap(pg)).enrollmentStatus,'pending');assert.equal((await tapSnapshot(pg)).shifts.length,0);
});
for(const status of ['rejected','disabled'])test(status+' profile never becomes public or Working Now',async()=>{
 await pg.query('update public.dancer_profiles set status=$1 where id=$2',[status,id(10)]);const before=await tapSnapshot(pg);assert.equal((await tap(pg)).enrollmentStatus,'pending');const after=await tapSnapshot(pg);assert.deepEqual(after.dancer_profiles,before.dancer_profiles);assert.equal(after.shifts.length,0);
});
for(const tag of [id(30),id(31)])test('active session is not extended or moved when retapping '+tag,async()=>{
 const first=await tap(pg),before=await tapSnapshot(pg),second=await tap(pg,{tag,session:id(51)}),after=await tapSnapshot(pg);
 assert.equal(second.alreadyWorking,true);assert.equal(second.tapApplied,false);assert.equal(second.extended,false);assert.equal(second.switchedVenue,false);assert.equal(second.venueId,id(20));assert.equal(second.shiftId,first.shiftId);assert.equal(second.workingUntil,first.workingUntil);assert.deepEqual(after.shifts,before.shifts);
 assert.equal(after.venue_dancer_affiliations.length,tag===id(30)?1:2);assert.equal(after.venue_dancer_affiliation_events.length,tag===id(30)?1:2);
});
test('queued repeat taps retain one active shift and one affiliation',async()=>{
 const results=await Promise.all(Array.from({length:5},(_,i)=>tap(pg,{session:id(50+i)})));assert.equal(results.filter(r=>r.tapApplied).length,1);const after=await tapSnapshot(pg);assert.equal(after.shifts.length,1);assert.equal(after.venue_dancer_affiliations.length,1);assert.equal(after.dancer_nfc_enrollments.length,1);
});
test('the existing six-hour cooldown applies across all clubs',async()=>{
 const first=await tap(pg);await pg.query("update public.shifts set starts_at=now()-interval '7 hours',ends_at=now()-interval '1 hour',checked_in_at=now()-interval '7 hours',last_location_verified_at=now()-interval '7 hours',commission_tracking_started_at=now()-interval '7 hours',nfc_last_tapped_at=now()-interval '7 hours',location_verification_expires_at=now()-interval '1 hour' where id=$1",[first.shiftId]);
 const result=await tap(pg,{tag:id(31)}),after=await tapSnapshot(pg);assert.equal(result.cooldownActive,true);assert.equal(result.shiftCheckedIn,false);assert.equal(result.tapApplied,false);assert.equal(result.venueId,id(20));assert.equal(after.shifts.length,1);assert.equal(after.shifts[0].working_status,'ended');
});
test('after the full interval a fresh eligible tap can start at another club',async()=>{
 const first=await tap(pg);await pg.query("update public.shifts set starts_at=now()-interval '13 hours',ends_at=now()-interval '7 hours',checked_in_at=now()-interval '13 hours',last_location_verified_at=now()-interval '13 hours',commission_tracking_started_at=now()-interval '13 hours',nfc_last_tapped_at=now()-interval '13 hours',location_verification_expires_at=now()-interval '7 hours' where id=$1",[first.shiftId]);
 const result=await tap(pg,{tag:id(31)}),after=await tapSnapshot(pg);assert.equal(result.tapApplied,true);assert.equal(result.venueId,id(21));assert.notEqual(result.shiftId,first.shiftId);assert.equal(after.shifts.length,2);assert.equal(after.shifts.filter(s=>s.checked_out_at===null).length,1);
});
test('a matching upcoming date is reused rather than duplicated',async()=>{
 await pg.query("insert into public.shifts(id,dancer_id,venue_id,starts_at,ends_at,timezone,status,shift_source,shift_date) values($1,$2,$3,now()+interval '1 hour',now()+interval '3 hours','America/Los_Angeles','posted','scheduled',timezone('America/Los_Angeles',now())::date)",[id(60),id(10),id(20)]);
 const result=await tap(pg),after=await tapSnapshot(pg);assert.equal(result.shiftId,id(60));assert.equal(after.shifts.length,1);assert.equal(after.shifts[0].shift_source,'scheduled');
});
for(const [table,condition,change]of [
 ['app_users',"id='"+id(1)+"'","account_state='disabled'"],['app_users',"id='"+id(1)+"'","account_state='deleted'"],['app_users',"id='"+id(2)+"'","account_state='disabled'"],['venues',"id='"+id(20)+"'",'is_active=false'],['nfc_tags',"id='"+id(30)+"'","status='disabled'"],['nfc_tags',"id='"+id(30)+"'","tag_type='cashier'"],
])test('ineligible '+table+' '+change+' makes no partial records',async()=>{
 await pg.exec('update public.'+table+' set '+change+' where '+condition);const before=await tapSnapshot(pg);await assert.rejects(tap(pg),e=>e.code==='42501');assert.deepEqual(await tapSnapshot(pg),before);
});
for(const input of [{tag:null},{dancer:null},{session:null},{audit:[]},{audit:'invalid'},{dancer:id(4)},{tag:id(99)}])test('invalid request '+JSON.stringify(input)+' preserves all records',async()=>{
 const before=await tapSnapshot(pg);await assert.rejects(tap(pg,input),e=>['22023','42501'].includes(e.code));assert.deepEqual(await tapSnapshot(pg),before);
});
for(const [table,event,condition]of [
 ['dancer_profiles','update','true'],['venue_dancer_affiliations','insert','true'],['venue_dancer_affiliation_events','insert','true'],['notifications','insert','true'],['dancer_nfc_enrollments','update',"new.status='completed'"],['shifts','insert','true'],['nfc_tap_events','insert',"new.event_type='shift_checked_in'"],
])test('failure at '+table+' rolls back enrollment, profile, affiliation and presence',async()=>{
 await pg.exec("reset role;create or replace function public.synthetic_tap_failure() returns trigger language plpgsql as $f$begin if "+condition+" then raise exception 'synthetic transaction failure';end if;return new;end;$f$;create trigger synthetic_failure before "+event+' on public.'+table+' for each row execute function public.synthetic_tap_failure();set role service_role');
 const before=await tapSnapshot(pg);await assert.rejects(tap(pg),/synthetic transaction failure/);assert.deepEqual(await tapSnapshot(pg),before);
});
test('the former two-call sequence reproduces partial activation when check-in fails',async()=>{
 await pg.exec("reset role;create or replace function public.synthetic_tap_failure() returns trigger language plpgsql as $f$begin raise exception 'synthetic check-in failure';end;$f$;create trigger synthetic_failure before insert on public.shifts for each row execute function public.synthetic_tap_failure();set role service_role");
 await pg.query("select public.register_dancer_nfc_enrollment($1,$2,$3,'{}')",[id(30),id(1),id(50)]);
 await assert.rejects(pg.query("select public.activate_dancer_shift_from_nfc($1,$2,$3,'{}')",[id(30),id(1),id(50)]),/synthetic check-in failure/);
 const after=await tapSnapshot(pg);assert.equal(row(after,'dancer_profiles',id(10)).is_public,true);assert.equal(after.dancer_nfc_enrollments[0].status,'completed');assert.equal(after.shifts.length,0);
});
for(const value of [null,{},[],{shiftCheckedIn:true},{shiftCheckedIn:'true',tapApplied:false,alreadyWorking:false,cooldownActive:false,shiftId:id(99),workingUntil:null,nextTapAllowedAt:null,venueId:id(20)}])test('unconfirmed presence receipt '+JSON.stringify(value)+' rolls back registration',async()=>{
 await pg.exec("reset role;create or replace function public.activate_dancer_shift_from_nfc(p_tag_id uuid,p_dancer_user_id uuid,p_session_id uuid,p_audit jsonb default '{}'::jsonb) returns jsonb language sql as $f$select '"+JSON.stringify(value)+"'::jsonb$f$;set role service_role");const before=await tapSnapshot(pg);await assert.rejects(tap(pg),e=>e.code==='40001');assert.deepEqual(await tapSnapshot(pg),before);
});
test('deferred setup completion still creates no Working Now session without a fresh tap',async()=>{
 await pg.query("update public.dancer_profiles set city='' where id=$1",[id(10)]);await tap(pg);await pg.query("update public.dancer_profiles set city='Las Vegas' where id=$1",[id(10)]);
 const result=(await pg.query("select public.finalize_pending_dancer_nfc_enrollment($1,$2,'{}') result",[id(1),id(50)])).rows[0].result;assert.equal(result.enrollmentStatus,'completed');assert.equal((await tapSnapshot(pg)).shifts.length,0);
});
for(const role of ['anon','authenticated'])test(role+' cannot execute the combined entry point',async()=>{await pg.exec('reset role;set role '+role);await assert.rejects(tap(pg),e=>e.code==='42501');});
test('the wrapper remains invoker-only and all existing function and trigger definitions are preserved',async()=>{
 const metadata=(await pg.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[tapSignature])).rows[0];assert.equal(metadata.prosecdef,false);assert.ok(metadata.proconfig.includes('search_path=""'));assert.ok(metadata.proconfig.includes('lock_timeout=3s'));
 for(const fn of tapSchema.functions){const signature=fn.name+(fn.name==='finalize_pending_dancer_nfc_enrollment'?'(uuid,uuid,jsonb)':'(uuid,uuid,uuid,jsonb)');assert.equal((await pg.query('select md5(pg_get_functiondef($1::regprocedure)) hash',[signature])).rows[0].hash,fn.fingerprint);}
 for(const trigger of tapSchema.triggers)assert.equal((await pg.query('select pg_get_functiondef(tgfoid) def from pg_trigger where tgname=$1',[trigger.name])).rows[0].def,trigger.function_definition);
});
