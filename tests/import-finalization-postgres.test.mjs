import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createImportDatabase,seedImportDatabase,importVersion,importSnapshot,finalizeImport,fixtureId as id,importSignature,importSchema,importMigration} from './helpers/import-finalization-database.mjs';
let pg;before(async()=>{pg=await createImportDatabase();});beforeEach(async()=>seedImportDatabase(pg));after(async()=>pg?.close());
test('finalization commits one private note and acknowledged audit without publication changes',async()=>{
 const before=await importSnapshot(pg),result=await finalizeImport(pg),after=await importSnapshot(pg);
 assert.equal(result.video_id,id(20));assert.equal(result.batch_id,'synthetic-batch');assert.equal(result.status,'approved');assert.equal(result.already_recorded,false);
 assert.deepEqual(result.version,await importVersion(pg));const video=after.mydancr_tv_videos.find(r=>r.id===id(20));
 assert.equal(video.review_notes,'platform-import:synthetic-batch:approved\nKeep exact moderation text  ');
 for(const field of Object.keys(video).filter(k=>k!=='review_notes'))assert.deepEqual(video[field],before.mydancr_tv_videos[0][field],field+' preserved');
 assert.deepEqual(after.mydancr_tv_videos[1],before.mydancr_tv_videos[1]);
 const audit=after.admin_actions.find(r=>r.id===result.audit_id);assert.equal(audit.admin_id,id(2));assert.equal(audit.created_at,result.recorded_at);assert.match(audit.notes,/^Batch synthetic-batch; status approved; version [a-f0-9]{32}$/);
 assert.deepEqual(after.admin_actions.filter(r=>r.id!==result.audit_id),before.admin_actions);
 for(const table of ['app_users','dancer_profiles','venues','shifts','notifications'])assert.deepEqual(after[table],before[table]);
});
for(const useOriginal of [true,false])test('lost-response replay using '+(useOriginal?'original':'returned')+' snapshot returns the same receipt',async()=>{
 const expected=await importVersion(pg),first=await finalizeImport(pg,{expected}),before=await importSnapshot(pg);
 const repeated=await finalizeImport(pg,{expected:useOriginal?expected:first.version,admin:id(6)});
 assert.deepEqual({...repeated,already_recorded:false},first);assert.deepEqual(await importSnapshot(pg),before);
});
test('serialized repeated finalizations produce one receipt and preserve all records',async()=>{
 const expected=await importVersion(pg),results=await Promise.all(Array.from({length:8},()=>finalizeImport(pg,{expected})));
 assert.equal(new Set(results.map(r=>r.audit_id)).size,1);assert.equal(results.filter(r=>!r.already_recorded).length,1);
 assert.equal((await importSnapshot(pg)).admin_actions.length,2);
});
for(const note of [null,'','platform-import:synthetic-batch:approved','platform-import:synthetic-batch:approved\nKeep original text','platform-import:older-batch:approved\nHistorical text','  Keep leading and trailing whitespace  '])test('preserves moderation text and prefixes once: '+JSON.stringify(note),async()=>{
 await pg.query('update public.mydancr_tv_videos set review_notes=$1 where id=$2',[note,id(20)]);
 const first=await finalizeImport(pg),expected=note?.split('\n')[0]==='platform-import:synthetic-batch:approved'?note:'platform-import:synthetic-batch:approved'+(note?'\n'+note:'');
 assert.equal(first.version.review_notes,expected);await finalizeImport(pg);assert.equal((await importVersion(pg)).review_notes,expected);assert.equal((await importSnapshot(pg)).admin_actions.length,2);
});
for(const status of ['moderating','submitted','rejected','hidden','expired'])test('records actual '+status+' without approving, republishing or notifying',async()=>{
 await pg.query('update public.mydancr_tv_videos set status=$1 where id=$2',[status,id(20)]);const before=await importSnapshot(pg),result=await finalizeImport(pg),after=await importSnapshot(pg);
 assert.equal(result.status,status);assert.equal(after.mydancr_tv_videos[0].status,status);assert.deepEqual(after.notifications,before.notifications);
});
test('an upload that has not been submitted cannot be finalized',async()=>{
 await pg.query("update public.mydancr_tv_videos set status='uploading' where id=$1",[id(20)]);const before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg),e=>e.code==='40001');assert.deepEqual(await importSnapshot(pg),before);
});
for(const [field,value]of [['dancer_id',id(99)],['submitted_by',id(99)],['storage_path','other-file'],['status','rejected'],['review_notes','Different note'],['reviewed_by',id(6)],['submitted_at','2025-01-01Z'],['reviewed_at','2025-01-01Z'],['published_at','2025-01-01Z'],['updated_at','2025-01-01Z'],['moderation_started_at','2025-01-01Z'],['moderation_completed_at','2025-01-01Z']])test('stale '+field+' fails before any mutation',async()=>{
 const expected=await importVersion(pg);expected[field]=value;const before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg,{expected}),e=>e.code==='40001');assert.deepEqual(await importSnapshot(pg),before);
});
test('a newer moderation decision after finalization invalidates even an original replay',async()=>{
 const expected=await importVersion(pg);await finalizeImport(pg,{expected});await pg.query("update public.mydancr_tv_videos set review_notes='New decision' where id=$1",[id(20)]);const before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg,{expected}),e=>e.code==='40001');assert.deepEqual(await importSnapshot(pg),before);
});
test('timestamp normalization preserves microseconds across equivalent offsets',async()=>{
 const expected=await importVersion(pg);expected.reviewed_at='2026-01-01T04:34:56.123456-08:00';assert.equal((await finalizeImport(pg,{expected})).status,'approved');
});
test('a one-microsecond change is a stale version',async()=>{
 const expected=await importVersion(pg);expected.reviewed_at='2026-01-01T12:34:56.123455Z';await assert.rejects(finalizeImport(pg,{expected}),e=>e.code==='40001');
});
for(const admin of [null,id(1),id(3),id(4),id(5),id(99)])test('inactive or unauthorized administrator '+admin+' cannot write',async()=>{
 const before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg,{admin}),e=>['42501','22023'].includes(e.code));assert.deepEqual(await importSnapshot(pg),before);
});
test('missing video is explicit and leaves data intact',async()=>{
 const expected=await importVersion(pg),before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg,{video:id(99),expected}),e=>e.code==='P0002');assert.deepEqual(await importSnapshot(pg),before);
});
for(const batch of [null,'short','UPPERCASE','bad:batch','x'.repeat(81),'valid-batch\n'])test('invalid batch '+JSON.stringify(batch)+' is rejected',async()=>{
 const before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg,{batch}),e=>e.code==='22023');assert.deepEqual(await importSnapshot(pg),before);
});
for(const kind of ['missing','extra','null','array','infinite','timestamp-type','note-type'])test('malformed '+kind+' snapshot is rejected',async()=>{
 let expected=await importVersion(pg);if(kind==='missing')delete expected.status;if(kind==='extra')expected.extra=true;if(kind==='null')expected=null;if(kind==='array')expected=[];if(kind==='infinite')expected.reviewed_at='infinity';if(kind==='timestamp-type')expected.reviewed_at=7;if(kind==='note-type')expected.review_notes={};
 const before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg,{expected}),e=>e.code==='22023');assert.deepEqual(await importSnapshot(pg),before);
});
for(const [table,timing,body]of [
 ['mydancr_tv_videos','before','raise exception \'synthetic failure\';'],['admin_actions','before','raise exception \'synthetic failure\';'],
 ['mydancr_tv_videos','before','return null;'],['admin_actions','before','return null;'],
 ['mydancr_tv_videos','before',"new.storage_path := 'unexpected-change'; return new;"],['admin_actions','before',"new.notes := 'unexpected-change'; return new;"],
 ['admin_actions','after','raise exception \'synthetic failure\';'],
])test(table+' '+timing+' failure '+body+' rolls back the complete transaction',async()=>{
 await pg.exec("reset role;create or replace function public.synthetic_import_failure() returns trigger language plpgsql as $fn$ begin "+body+" end;$fn$;create trigger synthetic_failure "+timing+' '+(table==='admin_actions'?'insert':'update')+' on public.'+table+' for each row execute function public.synthetic_import_failure();set role service_role');
 const before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg));assert.deepEqual(await importSnapshot(pg),before);
});
test('conflicting duplicate receipts are explicit and cannot silently return success',async()=>{
 await finalizeImport(pg);await pg.exec("insert into public.admin_actions(admin_id,target_type,target_id,action,notes) select admin_id,target_type,target_id,action,notes from public.admin_actions where action='finalize_platform_tv_import'");const before=await importSnapshot(pg);await assert.rejects(finalizeImport(pg),e=>e.code==='40001');assert.deepEqual(await importSnapshot(pg),before);
});
for(const role of ['anon','authenticated'])test(role+' cannot execute the privileged RPC',async()=>{
 const expected=await importVersion(pg);await pg.exec('reset role;set role '+role);await assert.rejects(finalizeImport(pg,{expected}),e=>e.code==='42501');
});
test('security configuration and original trigger definitions remain intact',async()=>{
 const result=(await pg.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[importSignature])).rows[0];assert.equal(result.prosecdef,false);assert.ok(result.proconfig.includes('search_path=""'));assert.ok(result.proconfig.includes('lock_timeout=3s'));assert.ok(result.proconfig.includes('TimeZone=UTC'));
 for(const trigger of importSchema.triggers)assert.equal((await pg.query('select pg_get_functiondef(tgfoid) def from pg_trigger where tgname=$1',[trigger.name])).rows[0].def,trigger.function_definition);
 assert.doesNotMatch(importMigration,/\b(delete\s+from|truncate\s+(?:table\s+)?public\.|drop\s+(?:table|function)|security\s+definer)\b/i);
});
