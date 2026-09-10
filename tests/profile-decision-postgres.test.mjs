import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createProfileDecisionDatabase,seedDecisionDatabase,profileDecisionVersion,profileDecisionSnapshot,reviewProfile,fixtureId as id,profileDecisionSignature,profileDecisionTransition} from './helpers/profile-decision-database.mjs';
let pg;before(async()=>{pg=await createProfileDecisionDatabase();});beforeEach(async()=>seedDecisionDatabase(pg));after(async()=>pg?.close());
for(const decision of ['approved','rejected'])test(decision+' commits the existing private transition, review and audit together',async()=>{
 const before=await profileDecisionSnapshot(pg),result=await reviewProfile(pg,{status:decision}),after=await profileDecisionSnapshot(pg);
 assert.equal(result.status,decision==='approved'?'pending_review':'rejected');assert.equal(result.decision,decision);assert.equal(result.recipient_id,id(1));assert.equal(result.dancer_id,id(11));
 const dancer=after.dancer_profiles.find(r=>r.id===id(11));assert.equal(dancer.is_public,false);assert.equal(dancer.approved_at,null);assert.equal(dancer.verification_status,decision==='approved'?'pending':'rejected');
 assert.deepEqual(result.version,await profileDecisionVersion(pg));assert.notEqual(dancer.updated_at,before.dancer_profiles[0].updated_at);
 assert.equal(after.approval_reviews.length,before.approval_reviews.length+1);assert.deepEqual(after.approval_reviews.filter(r=>r.id!==result.review_id),before.approval_reviews);
 assert.deepEqual(after.admin_actions.filter(r=>r.id!==result.audit_id),before.admin_actions);
 const review=after.approval_reviews.find(r=>r.id===result.review_id),audit=after.admin_actions.find(r=>r.id===result.audit_id);
 assert.equal(review.status,decision);assert.equal(review.review_type,'profile');assert.equal(review.reviewer_id,id(3));assert.equal(review.reviewed_at,result.reviewed_at);assert.equal(audit.created_at,result.reviewed_at);
 assert.equal(audit.action,decision==='approved'?'approve_dancer':'reject_dancer');assert.equal(audit.target_type,'dancer_profile');assert.equal(audit.target_id,id(11));
 for(const table of ['app_users','dancer_photos','social_links'])assert.deepEqual(after[table],before[table]);
 for(const key of Object.keys(dancer).filter(k=>!['status','verification_status','approved_at','is_public','updated_at'].includes(k)))assert.deepEqual(dancer[key],before.dancer_profiles[0][key],key+' preserved');
});
test('an old snapshot cannot repeat a completed decision or undo a newer one',async()=>{
 const version=await profileDecisionVersion(pg);await reviewProfile(pg,{expected:version});const before=await profileDecisionSnapshot(pg);
 for(const status of ['approved','rejected'])await assert.rejects(reviewProfile(pg,{status,expected:version}),e=>e.code==='40001');assert.deepEqual(await profileDecisionSnapshot(pg),before);
});
test('a later intentional decision uses the returned profile version and preserves old history',async()=>{
 const first=await reviewProfile(pg),before=await profileDecisionSnapshot(pg),second=await reviewProfile(pg,{status:'approved',expected:first.version});
 assert.notEqual(second.review_id,first.review_id);const after=await profileDecisionSnapshot(pg);assert.deepEqual(after.approval_reviews.filter(r=>r.id!==second.review_id),before.approval_reviews);
});
for(const [field,value]of [
 ['user_id',id(2)],['stage_name','Changed'],['city','New city'],['status','draft'],['verification_status','rejected'],['photo_review_status','approved'],['avatar_storage_path','new-avatar'],['is_public',false],
 ['approved_at','2026-01-01T00:00:00Z'],['disabled_at','2026-01-01T00:00:00Z'],['admin_disabled_at','2026-01-01T00:00:00Z'],['venue_approved_at','2025-01-01T00:00:00Z'],
 ['venue_approved_by_user_id',id(4)],['venue_approved_venue_id',null],['updated_at','2026-01-01T00:00:00.123456Z'],
])test('stale '+field+' conflicts before any writes',async()=>{
 const expected=await profileDecisionVersion(pg);expected[field]=value;const before=await profileDecisionSnapshot(pg);await assert.rejects(reviewProfile(pg,{expected}),e=>e.code==='40001');assert.deepEqual(await profileDecisionSnapshot(pg),before);
});
test('equivalent timezone offsets retain timestamp precision',async()=>{
 await pg.query("update public.dancer_profiles set updated_at='2026-01-02T00:00:00.123456Z' where id=$1",[id(11)]);
 const expected=await profileDecisionVersion(pg);expected.updated_at='2026-01-01T16:00:00.123456-08:00';expected.venue_approved_at='2025-12-31T16:00:00-08:00';assert.equal((await reviewProfile(pg,{expected})).status,'rejected');
});
test('a one-microsecond profile change is a real conflict',async()=>{
 await pg.query("update public.dancer_profiles set updated_at='2026-01-02T00:00:00.123456Z' where id=$1",[id(11)]);
 const expected=await profileDecisionVersion(pg);expected.updated_at='2026-01-02T00:00:00.123455Z';await assert.rejects(reviewProfile(pg,{expected}),e=>e.code==='40001');
});
for(const reviewer of [null,id(1),id(5),id(99)])test('unauthorized reviewer '+reviewer+' cannot change anything',async()=>{
 const before=await profileDecisionSnapshot(pg);await assert.rejects(reviewProfile(pg,{reviewer}),e=>['42501','22023'].includes(e.code));assert.deepEqual(await profileDecisionSnapshot(pg),before);
});
test('an administrator disabled after opening the page cannot decide',async()=>{
 await pg.query("update public.app_users set account_state='disabled' where id=$1",[id(3)]);await assert.rejects(reviewProfile(pg),e=>e.code==='42501');
});
test('a missing profile is not an empty successful review',async()=>{await assert.rejects(reviewProfile(pg,{dancer:id(99),expected:{}}),e=>e.code==='P0002');});
test('an account that no longer has the dancer role is rejected',async()=>{
 await pg.query("update public.app_users set role='customer' where id=$1",[id(1)]);const before=await profileDecisionSnapshot(pg);await assert.rejects(reviewProfile(pg),e=>e.code==='P0002');assert.deepEqual(await profileDecisionSnapshot(pg),before);
});
for(const status of ['approved','rejected'])test(status+' preserves disabled, administrative and DMCA suspension markers',async()=>{
 await pg.query("update public.app_users set account_state='disabled',dmca_suspended_at='2026-01-01Z' where id=$1",[id(1)]);
 await pg.query("update public.dancer_profiles set status='disabled',disabled_at='2026-01-01Z',admin_disabled_at='2026-01-01Z',is_public=false where id=$1",[id(11)]);
 const before=await profileDecisionSnapshot(pg);await reviewProfile(pg,{status});const after=await profileDecisionSnapshot(pg);
 assert.deepEqual(after.app_users,before.app_users);for(const key of ['disabled_at','admin_disabled_at','venue_approved_at','venue_approved_by_user_id','venue_approved_venue_id'])assert.equal(after.dancer_profiles[0][key],before.dancer_profiles[0][key]);assert.equal(after.dancer_profiles[0].is_public,false);
});
for(const expected of [null,[],{}, {updated_at:14}])test('malformed snapshot '+JSON.stringify(expected)+' fails before any change',async()=>{
 const before=await profileDecisionSnapshot(pg);await assert.rejects(reviewProfile(pg,{expected}),e=>e.code==='22023');assert.deepEqual(await profileDecisionSnapshot(pg),before);
});
for(const date of ['bad','infinity','-infinity'])test('invalid/nonfinite snapshot date '+date+' fails safely',async()=>{
 const expected=await profileDecisionVersion(pg);expected.updated_at=date;const before=await profileDecisionSnapshot(pg);await assert.rejects(reviewProfile(pg,{expected}),e=>['22023','22007','22008'].includes(e.code));assert.deepEqual(await profileDecisionSnapshot(pg),before);
});
for(const status of [null,'pending','disabled'])test('invalid decision '+status+' fails safely',async()=>{await assert.rejects(reviewProfile(pg,{status}),e=>e.code==='22023');});
test('oversized notes are rejected and blank notes preserve existing optional behavior',async()=>{
 await assert.rejects(reviewProfile(pg,{notes:'x'.repeat(12001)}),e=>e.code==='22023');const result=await reviewProfile(pg,{notes:'   '});assert.equal((await profileDecisionSnapshot(pg)).approval_reviews.find(r=>r.id===result.review_id).notes,null);
});
for(const table of ['dancer_profiles','approval_reviews','admin_actions'])for(const mode of ['throw','skip'])test(table+' '+mode+' failure rolls back publication, review and audit',async()=>{
 await pg.exec('reset role');await pg.exec("create or replace function public.synthetic_profile_failure() returns trigger language plpgsql as $$begin "+(mode==='throw'?"raise exception 'synthetic failure';":"return null;")+"end;$$");
 await pg.exec('create trigger synthetic_failure before '+(table==='dancer_profiles'?'update':'insert')+' on public.'+table+' for each row execute function public.synthetic_profile_failure()');await pg.exec('set role service_role');
 const before=await profileDecisionSnapshot(pg);await assert.rejects(reviewProfile(pg));assert.deepEqual(await profileDecisionSnapshot(pg),before);
});
for(const role of ['anon','authenticated'])test(role+' cannot execute profile decisions',async()=>{
 const version=await profileDecisionVersion(pg);await pg.exec('set role '+role);await assert.rejects(reviewProfile(pg,{expected:version}),e=>e.code==='42501');
});
test('new function is service-only/invoker and the existing publication transition is unchanged',async()=>{
 const row=(await pg.query("select prosecdef,proconfig,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid=$1::regprocedure",[profileDecisionSignature])).rows[0];
 assert.equal(row.prosecdef,false);assert.equal(row.service,true);assert.ok(row.proconfig.includes('search_path=""'));assert.ok(row.proconfig.includes('TimeZone=UTC'));assert.ok(row.proconfig.includes('lock_timeout=3s'));
 assert.equal((await pg.query("select md5(pg_get_functiondef('public.transition_dancer_publication_safely(uuid,text,uuid)'::regprocedure)) hash")).rows[0].hash,profileDecisionTransition.fingerprint);
});
