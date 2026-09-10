import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createTapDatabase,seedTapDatabase,tap,tapSnapshot,tapSchema,tapTables,lockMigration,fixtureId as id} from './helpers/dancer-tap-lock-database.mjs';
const migrate=process.env.MYDANCR_TAP_LOCK_BASELINE!=='1';
let pg;
before(async()=>{pg=await createTapDatabase({migrate});});
beforeEach(async()=>{await pg.exec('rollback;reset role');await seedTapDatabase(pg,{migrate});});
after(async()=>pg?.close());
const finish=(user=id(1))=>pg.query("select public.finalize_pending_dancer_nfc_enrollment($1,$2,'{}') receipt",[user,id(50)]).then(r=>r.rows[0].receipt);
const snapshot=()=>tapSnapshot(pg);
const locked=async(user=id(1))=>(await pg.query("select exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and mode='ExclusiveLock' and granted and objsubid=1 and classid=((hashtextextended('mydancr:dancer-nfc-enrollment:'||$1,0)>>32)&4294967295)::oid and objid=(hashtextextended('mydancr:dancer-nfc-enrollment:'||$1,0)&4294967295)::oid) held",[user])).rows[0].held;
async function pending(tag=id(30)){
 await pg.query("update dancer_profiles set city='' where id=$1",[id(10)]);await tap(pg,{tag});await pg.query("update dancer_profiles set city='Las Vegas' where id=$1",[id(10)]);
}
for(const kind of ['fresh-ready','fresh-pending','deferred-ready','deferred-none','deferred-expired','deferred-incomplete'])test(kind+' holds the same dancer transaction lock and releases it on commit',async()=>{
 if(kind.startsWith('deferred-')&&kind!=='deferred-none')await pending();
 if(kind.endsWith('expired'))await pg.exec("update dancer_nfc_enrollments set expires_at=clock_timestamp()-interval '1 second'");
 if(kind==='fresh-pending'||kind==='deferred-incomplete')await pg.query("update dancer_profiles set city='' where id=$1",[id(10)]);
 assert.equal(await locked(),false);await pg.exec('begin');const receipt=kind.startsWith('fresh-')?await tap(pg):await finish();
 assert.ok(receipt.enrollmentStatus);assert.equal(await locked(),true);assert.equal(await locked(id(5)),false);
 await pg.exec('commit');assert.equal(await locked(),false);
});
for(const path of ['fresh','deferred'])test(path+' serialization lock is released by rollback with no retained changes',async()=>{
 if(path==='deferred')await pending();const before=await snapshot();await pg.exec('begin');await(path==='fresh'?tap(pg):finish());assert.equal(await locked(),true);await pg.exec('rollback');assert.equal(await locked(),false);assert.deepEqual(await snapshot(),before);
});
test('two dancers use different lock keys while fresh and deferred calls for one dancer share a key',async()=>{
 await pending();await pg.exec('begin');await finish();assert.equal(await locked(),true);assert.equal(await locked(id(5)),false);await tap(pg,{dancer:id(5),tag:id(31)});assert.equal(await locked(id(5)),true);
 await tap(pg);assert.equal(await locked(),true);await pg.exec('commit');assert.equal(await locked(),false);assert.equal(await locked(id(5)),false);
});
test('both lock acquisitions precede the first tag or enrollment SQL statement',async()=>{
 for(const fn of tapSchema.functions.filter(f=>['register_dancer_nfc_enrollment','finalize_pending_dancer_nfc_enrollment'].includes(f.name))){
  const def=(await pg.query('select pg_get_functiondef($1::regprocedure) def',['public.'+fn.signature])).rows[0].def;
  const body=def.slice(def.indexOf('\nbegin\n')).replace(/--[^\n]*/g,'');
  const lock=body.indexOf('pg_catalog.pg_advisory_xact_lock'),firstRowAccess=body.search(/\b(select|update|insert|delete)\b/i);
  assert.ok(lock>=0&&lock<firstRowAccess,fn.name+' must serialize before any row access');
 }
});
test('an eligible first tap still activates, affiliates and starts exactly one six-hour session',async()=>{
 const before=await snapshot(),receipt=await tap(pg),after=await snapshot();
 assert.equal(receipt.enrollmentStatus,'completed');assert.equal(receipt.profileActivated,true);assert.equal(receipt.affiliationActivated,true);assert.equal(receipt.tapApplied,true);assert.equal(receipt.shiftCheckedIn,true);
 assert.equal(after.shifts.length,1);assert.equal(after.venue_dancer_affiliations.length,1);assert.equal(after.dancer_nfc_enrollments.length,1);
 assert.ok(Math.abs(Date.parse(after.shifts[0].ends_at)-Date.parse(after.shifts[0].starts_at)-6*3600000)<5);
 for(const table of ['app_users','venues','dancer_photos','gallery_media_reference_history','gallery_storage_retirements'])assert.deepEqual(after[table],before[table]);
});
test('deferred setup completion activates the profile without creating Working Now',async()=>{
 await pending();const result=await finish(),after=await snapshot();assert.equal(result.enrollmentStatus,'completed');assert.equal(after.dancer_profiles.find(r=>r.id===id(10)).is_public,true);assert.equal(after.shifts.length,0);
 const repeated=await finish();assert.equal(repeated.enrollmentStatus,'none');assert.equal((await snapshot()).shifts.length,0);assert.equal((await tap(pg)).tapApplied,true);
});
test('a repeat tap at another club cannot extend or move the existing session',async()=>{
 const first=await tap(pg),before=await snapshot(),again=await tap(pg,{tag:id(31)}),after=await snapshot();assert.equal(again.tapApplied,false);assert.equal(again.alreadyWorking,true);assert.equal(again.shiftId,first.shiftId);assert.equal(again.workingUntil,first.workingUntil);assert.equal(again.venueId,id(20));assert.deepEqual(after.shifts,before.shifts);
});
test('expired pending taps expire without affiliation or Working Now',async()=>{
 await pending();await pg.exec("update dancer_nfc_enrollments set expires_at=clock_timestamp()-interval '1 second'");assert.equal((await finish()).enrollmentStatus,'none');const s=await snapshot();assert.equal(s.dancer_nfc_enrollments[0].status,'expired');assert.equal(s.venue_dancer_affiliations.length,0);assert.equal(s.shifts.length,0);
});
test('the oldest unexpired pending venue is still finalized first',async()=>{
 await pending();await pending(id(31));await pg.query("update dancer_nfc_enrollments set tapped_at=clock_timestamp()-interval '1 day' where venue_id=$1",[id(21)]);
 const first=await finish();assert.equal(first.venueId,id(21));assert.equal((await finish()).venueId,id(20));assert.equal((await snapshot()).shifts.length,0);
});
for(const status of ['rejected','disabled'])test('deferred completion cannot activate a '+status+' profile',async()=>{
 await pending();await pg.query('update dancer_profiles set status=$1 where id=$2',[status,id(10)]);const before=await snapshot();assert.equal((await finish()).enrollmentStatus,'pending');const after=await snapshot();assert.deepEqual(after.dancer_profiles,before.dancer_profiles);assert.equal(after.shifts.length,0);assert.equal(after.venue_dancer_affiliations.length,0);
});
for(const [path,table,operation]of [['fresh','dancer_nfc_enrollments','insert'],['fresh','shifts','insert'],['deferred','venue_dancer_affiliation_events','insert'],['deferred','notifications','insert']])test(path+' failure at '+table+' releases the lock and rolls back side effects',async()=>{
 if(path==='deferred')await pending();const before=await snapshot();await pg.exec('reset role;create or replace function synthetic_lock_failure() returns trigger language plpgsql as $$begin raise exception \'Synthetic lock-path failure\';end$$;create trigger synthetic_failure after '+operation+' on '+table+' for each row execute function synthetic_lock_failure();set role service_role');
 await assert.rejects(path==='fresh'?tap(pg):finish(),{code:'P0001'});assert.equal(await locked(),false);assert.deepEqual(await snapshot(),before);
});
for(const role of ['anon','authenticated'])test(role+' cannot enter either serialization function',async()=>{
 const before=await snapshot();await pg.exec('set role '+role);await assert.rejects(pg.query('select public.register_dancer_nfc_enrollment($1,$2,$3)',[id(30),id(1),id(50)]),{code:'42501'});await assert.rejects(finish(),{code:'42501'});await pg.exec('set role service_role');assert.deepEqual(await snapshot(),before);
});
test('migration changes only the two bodies and preserves all metadata and records on repeat',async()=>{
 await tap(pg);const before=await snapshot();await pg.exec('reset role');
 const othersSQL="select proname,md5(pg_get_functiondef(oid)) fingerprint,proacl,proconfig from pg_proc where pronamespace='public'::regnamespace and proname not in ('register_dancer_nfc_enrollment','finalize_pending_dancer_nfc_enrollment') order by proname,oid";
 const others=(await pg.query(othersSQL)).rows;await pg.exec(lockMigration);await pg.exec(lockMigration);assert.deepEqual(await snapshot(),before);assert.deepEqual((await pg.query(othersSQL)).rows,others);
 for(const name of ['register_dancer_nfc_enrollment','finalize_pending_dancer_nfc_enrollment']){
  const metadata=(await pg.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name])).rows[0];
  assert.equal(metadata.prosecdef,true);assert.deepEqual(metadata.proconfig,['search_path=public, pg_temp']);assert.equal(metadata.anon,false);assert.equal(metadata.authenticated,false);assert.equal(metadata.service,true);
 }
});
test('the current target schema includes the gallery guards and the remaining actual triggers',async()=>{
 const tables=[tapTables];assert.equal((await pg.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name=any($1)",tables)).rows[0].n,tapSchema.columns.length);
 assert.equal((await pg.query("select count(*)::int n from pg_indexes where schemaname='public' and tablename=any($1)",tables)).rows[0].n,tapSchema.indexes.length);
 for(const trigger of tapSchema.triggers)assert.equal((await pg.query('select pg_get_functiondef(tgfoid) def from pg_trigger where tgname=$1',[trigger.name])).rows[0].def,trigger.function_definition);
});
