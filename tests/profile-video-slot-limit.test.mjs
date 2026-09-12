import test from 'node:test';
import assert from 'node:assert/strict';
import {createSlotDatabase,seedSlots,addSlots,slotCount,slotSnapshot,slotId,slotSchema,slotMigration,occupiedStatuses} from './helpers/profile-video-slot-database.mjs';

const rejected=p=>assert.rejects(p,e=>e.code==='23514'&&/50 profile videos/.test(e.message));
test('profile library capacity uses the current video schema and actual attached triggers',async t=>{
 const db=await createSlotDatabase();t.after(()=>db.close());
 async function scenario(name,run){await t.test(name,async()=>{await seedSlots(db);await run();});}
 await scenario('one profile can fill exactly fifty slots',async()=>{await addSlots(db,{count:50});assert.equal(await slotCount(db),50);});
 for(const status of occupiedStatuses)await scenario(`${status} cannot claim the fifty-first slot`,async()=>{
  await addSlots(db,{count:50});const before=await slotSnapshot(db);await rejected(addSlots(db,{start:200,status}));assert.deepEqual(await slotSnapshot(db),before);
 });
 await scenario('two rows competing for one remaining slot both roll back',async()=>{
  await addSlots(db,{count:49});const before=await slotSnapshot(db);await rejected(addSlots(db,{count:2,start:200}));assert.deepEqual(await slotSnapshot(db),before);
 });
 for(const status of ['hidden','expired'])await scenario(`${status} does not occupy a slot`,async()=>{
  await addSlots(db,{count:50});await addSlots(db,{count:2,start:200,status});assert.equal(await slotCount(db),50);
 });
 await scenario('feed-only videos do not occupy profile slots',async()=>{
  await addSlots(db,{count:50});await addSlots(db,{count:2,start:200,scope:'feed_only'});assert.equal(await slotCount(db),50);
 });
 await scenario('another profile has independent capacity',async()=>{
  await addSlots(db,{count:50});await addSlots(db,{count:50,start:200,dancer:slotId(2)});assert.equal(await slotCount(db,slotId(2)),50);
 });
 for(const from of ['hidden','expired'])await scenario(`${from} restoration is rejected when the library is full`,async()=>{
  await addSlots(db,{count:50});await addSlots(db,{start:200,status:from});const before=await slotSnapshot(db);
  await rejected(db.query("update public.mydancr_tv_videos set status='approved' where id=$1",[slotId(200)]));assert.deepEqual(await slotSnapshot(db),before);
 });
 await scenario('restoration can claim the last available slot',async()=>{
  await addSlots(db,{count:49});await addSlots(db,{start:200,status:'hidden'});await db.query("update public.mydancr_tv_videos set status='approved' where id=$1",[slotId(200)]);assert.equal(await slotCount(db),50);
 });
 await scenario('feed-to-profile transition cannot bypass a full library',async()=>{
  await addSlots(db,{count:50});await addSlots(db,{start:200,scope:'feed_only'});const before=await slotSnapshot(db);
  await rejected(db.query("update public.mydancr_tv_videos set distribution_scope='profile_and_feed' where id=$1",[slotId(200)]));assert.deepEqual(await slotSnapshot(db),before);
 });
 await scenario('ownership transfer cannot bypass destination capacity',async()=>{
  await addSlots(db,{count:50});await addSlots(db,{start:200,dancer:slotId(2)});const before=await slotSnapshot(db);
  await rejected(db.query('update public.mydancr_tv_videos set dancer_id=$1 where id=$2',[slotId(1),slotId(200)]));assert.deepEqual(await slotSnapshot(db),before);
 });
 await scenario('ownership transfer into the last destination slot succeeds',async()=>{
  await addSlots(db,{count:49});await addSlots(db,{start:200,dancer:slotId(2)});await db.query('update public.mydancr_tv_videos set dancer_id=$1 where id=$2',[slotId(1),slotId(200)]);assert.equal(await slotCount(db),50);assert.equal(await slotCount(db,slotId(2)),0);
 });
 await scenario('moderation transitions retain their existing slot and audit',async()=>{
  await addSlots(db,{count:50,status:'moderating'});await db.query("update public.mydancr_tv_videos set status='approved' where id=$1",[slotId(100)]);
  assert.equal(await slotCount(db),50);assert.equal((await db.query('select count(*)::int n from public.notifications')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from public.admin_actions')).rows[0].n,1);
 });
 await scenario('unchanged status and caption edits succeed at capacity',async()=>{
  await addSlots(db,{count:50});await db.query("update public.mydancr_tv_videos set status=status,caption='Changed' where id=$1",[slotId(100)]);assert.equal(await slotCount(db),50);
 });
 for(const release of ["status='hidden'","status='expired'","distribution_scope='feed_only'"])await scenario(`${release} frees one slot`,async()=>{
  await addSlots(db,{count:50});await db.query(`update public.mydancr_tv_videos set ${release} where id=$1`,[slotId(100)]);await addSlots(db,{start:200});assert.equal(await slotCount(db),50);
 });
 await scenario('deletion frees a slot',async()=>{
  await addSlots(db,{count:50});await db.query('delete from public.mydancr_tv_videos where id=$1',[slotId(100)]);await addSlots(db,{start:200});assert.equal(await slotCount(db),50);
 });
 await scenario('ignored idempotent insert at capacity remains a no-op',async()=>{
  await addSlots(db,{count:50});const before=await slotSnapshot(db);
  await db.query('insert into public.mydancr_tv_videos select * from public.mydancr_tv_videos where id=$1 on conflict(id) do nothing',[slotId(100)]);assert.deepEqual(await slotSnapshot(db),before);
 });
 await scenario('upsert updating an occupied slot succeeds at capacity',async()=>{
  await addSlots(db,{count:50});await db.query("insert into public.mydancr_tv_videos select * from public.mydancr_tv_videos where id=$1 on conflict(id) do update set caption='Updated',status=excluded.status",[slotId(100)]);assert.equal(await slotCount(db),50);
 });
 await scenario('existing shift validation still derives venue and confirmation',async()=>{
  await addSlots(db,{shift:slotId(4)});assert.deepEqual((await db.query('select venue_id,venue_tag_status,venue_featured from public.mydancr_tv_videos')).rows[0],{venue_id:slotId(3),venue_tag_status:'confirmed',venue_featured:false});
 });
 await scenario('invalid linked shift still rolls back the reservation',async()=>{
  const before=await slotSnapshot(db);await assert.rejects(addSlots(db,{shift:slotId(4),dancer:slotId(2)}),/does not belong/);assert.deepEqual(await slotSnapshot(db),before);
 });
 await scenario('mandatory notification failure rolls back status and audit',async()=>{
  await addSlots(db,{status:'moderating'});const before=await slotSnapshot(db);await db.exec("reset role;alter table public.notifications add constraint synthetic_failure check(false);set role service_role");
  try{await assert.rejects(db.query("update public.mydancr_tv_videos set status='approved'"),e=>e.code==='23514');assert.deepEqual(await slotSnapshot(db),before);assert.equal((await db.query('select count(*)::int n from public.admin_actions')).rows[0].n,0);}finally{await db.exec('reset role;alter table public.notifications drop constraint synthetic_failure;set role service_role');}
 });
 await scenario('mandatory audit failure rolls back both status and notification',async()=>{
  await addSlots(db,{status:'moderating'});const before=await slotSnapshot(db);await db.exec("reset role;alter table public.admin_actions add constraint synthetic_failure check(false);set role service_role");
  try{await assert.rejects(db.query("update public.mydancr_tv_videos set status='approved'"),e=>e.code==='23514');assert.deepEqual(await slotSnapshot(db),before);assert.equal((await db.query('select count(*)::int n from public.notifications')).rows[0].n,0);}finally{await db.exec('reset role;alter table public.admin_actions drop constraint synthetic_failure;set role service_role');}
 });
 for(const role of ['anon','authenticated'])await scenario(`${role} still cannot write videos`,async()=>{
  await addSlots(db);const before=await slotSnapshot(db);await db.exec('set role '+role);await assert.rejects(addSlots(db,{start:200}),e=>e.code==='42501');await assert.rejects(db.query("update public.mydancr_tv_videos set status='hidden'"),e=>e.code==='42501');await db.exec('set role service_role');assert.deepEqual(await slotSnapshot(db),before);
 });
 await scenario('function access and invoker ownership remain unchanged',async()=>{
  const row=(await db.query("select p.prosecdef,pg_get_userbyid(p.proowner) owner,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid='public.enforce_mydancr_tv_profile_video_limit()'::regprocedure")).rows[0];
  assert.deepEqual(row,{prosecdef:false,owner:'postgres',anon:false,authenticated:false,service:false});
 });
 await scenario('same-dancer reservations hold one transaction advisory lock',async()=>{
  await db.exec('begin');try{await addSlots(db,{count:2});const locks=(await db.query("select classid::text,objid::text,objsubid,mode,granted from pg_locks where locktype='advisory' order by classid,objid")).rows;assert.equal(locks.length,1);assert.equal(locks[0].mode,'ExclusiveLock');assert.equal(locks[0].granted,true);const expected=(await db.query("select ((h>>32)&4294967295)::text classid,(h&4294967295)::text objid from(select hashtextextended('mydancr:profile-video-slots:'||$1::text,0) h)x",[slotId(1)])).rows[0];assert.equal(locks[0].classid,expected.classid);assert.equal(locks[0].objid,expected.objid);}finally{await db.exec('rollback');}assert.equal((await db.query("select count(*)::int n from pg_locks where locktype='advisory'")).rows[0].n,0);
 });
 await scenario('different dancers hold distinct transaction locks released at commit',async()=>{
  await db.exec('begin');try{await addSlots(db);await addSlots(db,{start:200,dancer:slotId(2)});assert.equal((await db.query("select count(*)::int n from pg_locks where locktype='advisory'")).rows[0].n,2);await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}assert.equal((await db.query("select count(*)::int n from pg_locks where locktype='advisory'")).rows[0].n,0);
 });
 await scenario('repeatable-read snapshot cannot claim a new slot',async()=>{
  await db.exec('begin isolation level repeatable read');try{await assert.rejects(addSlots(db),e=>e.code==='25000');}finally{await db.exec('rollback');}assert.equal(await slotCount(db),0);
 });
 await scenario('serializable reservation is accepted',async()=>{
  await db.exec('begin isolation level serializable');try{await addSlots(db);await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}assert.equal(await slotCount(db),1);
 });
 await scenario('two-row restoration beyond capacity rolls back entirely',async()=>{
  await addSlots(db,{count:49});await addSlots(db,{count:2,start:200,status:'hidden'});const before=await slotSnapshot(db);await rejected(db.query("update public.mydancr_tv_videos set status='approved' where status='hidden'"));assert.deepEqual(await slotSnapshot(db),before);
 });
});

test('the current production attachment gap permits fifty-one reservations',async t=>{
 const db=await createSlotDatabase({migrate:false});t.after(()=>db.close());await seedSlots(db);assert.equal(slotSchema.triggers.some(t=>t.name==='enforce_mydancr_tv_profile_video_limit'),false);await addSlots(db,{count:51});assert.equal(await slotCount(db),51);
 const before=await slotSnapshot(db);await db.exec('reset role');await db.exec(slotMigration);await db.exec('set role service_role');assert.deepEqual(await slotSnapshot(db),before);
 // Deployment does not hide/delete grandfathered rows; it blocks expansion.
 await db.query("update public.mydancr_tv_videos set caption='Preserved',status=status");await rejected(addSlots(db,{start:200}));assert.equal(await slotCount(db),51);
});
