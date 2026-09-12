import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createAccountLifecycleDatabase,seedAccountLifecycle,accountLifecycleSnapshot,asAccountLifecycleRole,transitionOwnAccount,accountLifecycleId} from './helpers/account-lifecycle-database.mjs';
let db,next=10000;
before(async()=>{db=await createAccountLifecycleDatabase();});after(async()=>db?.close());
const actor=(role='venue',state='active')=>seedAccountLifecycle(db,{n:next++,role,state,venueActive:false});
const change=async(user,venue,action,changes={})=>(await db.query('select public.change_venue_publication_safely($1,$2,$3,$4)venue',[user,venue,action,JSON.stringify(changes)])).rows[0].venue;
async function pending(status='venue_review') {
  const owner=await actor();await db.query('update public.venues set page_review_status=$1,published_at=null where id=$2',[status,owner.venueId]);return owner;
}
test('old service account mutations and venue compensation are denied by column privileges',async()=>{
  const f=await pending(),before=await accountLifecycleSnapshot(db);
  for(const sql of ["update public.app_users set account_state='disabled'where id=$1","update public.app_users set account_state='active'where id=$1"])await assert.rejects(asAccountLifecycleRole(db,'service_role',null,()=>db.query(sql,[f.userId])),error=>error.code==='42501');
  for(const active of [false,true])await assert.rejects(asAccountLifecycleRole(db,'service_role',null,()=>db.query('update public.venues set is_active=$1 where id=$2',[active,f.venueId])),error=>error.code==='42501');
  assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
test('unrelated service account and venue column updates remain authorized',async()=>{
  const f=await pending();
  await asAccountLifecycleRole(db,'service_role',null,async()=>{
    await db.query("update public.app_users set display_name='Updated name'where id=$1",[f.userId]);
    await db.query("update public.venues set phone='555-0100'where id=$1",[f.venueId]);
  });
  assert.equal((await db.query('select display_name from public.app_users where id=$1',[f.userId])).rows[0].display_name,'Updated name');
  assert.equal((await db.query('select phone from public.venues where id=$1',[f.venueId])).rows[0].phone,'555-0100');
});
test('the new owner-definer lifecycle still pauses and restores when invoked as service_role',async()=>{
  const f=await pending();
  await asAccountLifecycleRole(db,'service_role',null,async()=>{
    assert.equal((await transitionOwnAccount(db,f.userId,'disabled')).account_state,'disabled');
    assert.equal((await transitionOwnAccount(db,f.userId,'active')).account_state,'active');
  });
});
test('an active venue owner can approve the current review with existing notifications intact',async()=>{
  const f=await pending();const result=await asAccountLifecycleRole(db,'service_role',null,()=>change(f.userId,f.venueId,'owner_approve',{notes:''}));
  assert.equal(result.is_active,true);assert.equal(result.page_review_status,'published');assert.ok(result.published_at);assert.equal(result.page_reviewed_by_user_id,f.userId);
  assert.equal((await db.query("select count(*)::int n from public.notifications where recipient_id=$1 and notification_type='venue_publication_status'",[f.userId])).rows[0].n,1);
});
test('a venue owner can request changes without publishing',async()=>{
  const f=await pending(),result=await change(f.userId,f.venueId,'owner_request_changes',{notes:'Please correct the published opening hours.'});
  assert.equal(result.is_active,false);assert.equal(result.published_at,null);assert.equal(result.page_review_status,'changes_requested');assert.match(result.page_review_notes,/opening hours/);
});
for(const [role,status,allowed]of [['manager','active',true],['staff','active',false],['manager','removed',false]])test(`${status} venue ${role} review authorization is checked under the transaction`,async()=>{
  const owner=await pending(),member=await actor();
  await db.query('insert into public.venue_team_members(venue_id,user_id,role,status)values($1,$2,$3,$4)',[owner.venueId,member.userId,role,status]);
  if(allowed)assert.equal((await change(member.userId,owner.venueId,'owner_approve')).is_active,true);
  else {const before=await accountLifecycleSnapshot(db);await assert.rejects(change(member.userId,owner.venueId,'owner_approve'),error=>error.code==='42501');assert.deepEqual(await accountLifecycleSnapshot(db),before);}
});
test('a paused venue owner prevents manager publication',async()=>{
  const owner=await pending(),manager=await actor();
  await db.query("insert into public.venue_team_members(venue_id,user_id,role,status)values($1,$2,'manager','active')",[owner.venueId,manager.userId]);
  await transitionOwnAccount(db,owner.userId,'disabled');const before=await accountLifecycleSnapshot(db);
  await assert.rejects(change(manager.userId,owner.venueId,'owner_approve'),error=>error.code==='42501');assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
for(const role of ['customer','dancer','admin'])test(`${role} cannot impersonate the venue review actor`,async()=>{
  const owner=await pending(),other=await actor(role),before=await accountLifecycleSnapshot(db);
  await assert.rejects(change(other.userId,owner.venueId,'owner_approve'),error=>error.code==='42501');assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
test('an active administrator can publish the venue-approved version',async()=>{
  const owner=await pending('venue_approved'),admin=await actor('admin');const result=await change(admin.userId,owner.venueId,'admin_publish');
  assert.equal(result.is_active,true);assert.equal(result.page_review_status,'published');assert.ok(result.published_at);
});
test('administrator retirement plus edited fields remain one atomic update',async()=>{
  const owner=await pending(),admin=await actor('admin');await db.query('update public.venues set is_active=true where id=$1',[owner.venueId]);
  const result=await change(admin.userId,owner.venueId,'admin_edit',{is_active:false,name:'Updated Venue',opens_at:'18:30',page_review_status:'admin_draft'});
  assert.equal(result.is_active,false);assert.equal(result.name,'Updated Venue');assert.equal(result.opens_at,'18:30:00');assert.equal(result.page_review_status,'admin_draft');
});
for(const state of ['disabled','deleted'])test(`${state} administrator cannot publish or retire a venue`,async()=>{
  const owner=await pending('venue_approved'),admin=await actor('admin',state),before=await accountLifecycleSnapshot(db);
  for(const [action,changes]of [['admin_publish',{}],['admin_edit',{is_active:false}]])await assert.rejects(change(admin.userId,owner.venueId,action,changes),error=>error.code==='42501');
  assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
for(const [action,changes]of [['admin_edit',{is_active:true}],['admin_edit',{is_active:false,owner_user_id:accountLifecycleId(99999)}],['admin_edit',{is_active:false,id:accountLifecycleId(99999)}],['admin_edit',{is_active:false,created_at:'2026-01-01'}],['owner_approve',{is_active:true}],['owner_request_changes',{notes:'short'}]])test(`${action} rejects unapproved fields or invalid review input ${JSON.stringify(changes)}`,async()=>{
  const owner=await pending(),admin=await actor('admin'),before=await accountLifecycleSnapshot(db),user=action.startsWith('admin')?admin.userId:owner.userId;
  await assert.rejects(change(user,owner.venueId,action,changes),error=>error.code==='22023');assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
for(const action of ['admin_publish','owner_approve'])test(`${action} cannot publish after the review state changes`,async()=>{
  const owner=await pending('admin_draft'),admin=await actor('admin'),before=await accountLifecycleSnapshot(db);
  await assert.rejects(change(action==='admin_publish'?admin.userId:owner.userId,owner.venueId,action),error=>error.code==='40001');assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
for(const role of ['anon','authenticated'])test(`${role} cannot call the privileged venue publication writer`,async()=>{
  const owner=await pending();await assert.rejects(asAccountLifecycleRole(db,role,owner.userId,()=>change(owner.userId,owner.venueId,'owner_approve')),error=>error.code==='42501');
});
test('suppressed venue publication rolls back without a false receipt or notification',async()=>{
  const owner=await pending(),before=await accountLifecycleSnapshot(db);
  await db.exec('create function public.synthetic_stop_publication()returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_stop_publication before update on public.venues for each row execute function public.synthetic_stop_publication()');
  try {await assert.rejects(change(owner.userId,owner.venueId,'owner_approve'),error=>error.code==='40001');assert.deepEqual(await accountLifecycleSnapshot(db),before);}
  finally {await db.exec('drop trigger synthetic_stop_publication on public.venues;drop function public.synthetic_stop_publication()');}
});
