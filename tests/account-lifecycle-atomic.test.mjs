import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createAccountLifecycleDatabase,seedAccountLifecycle,accountLifecycleSnapshot,asAccountLifecycleRole,transitionOwnAccount,accountLifecycleSource,accountLifecycleId} from './helpers/account-lifecycle-database.mjs';
import {accountLifecycleCaller} from './helpers/account-lifecycle-caller.mjs';
let db,next=1000;
before(async()=>{db=await createAccountLifecycleDatabase();});
after(async()=>db?.close());
async function fixture(options={}) {
  const ids=await seedAccountLifecycle(db,{...options,n:next++});
  return {...ids,...accountLifecycleCaller({db,userId:ids.userId})};
}
const row=async(table,key,id)=>(await db.query(`select * from public.${table} where ${key}=$1`,[id])).rows[0];

for(const state of ['disabled','active','deleted'])test(`lost ${state} acknowledgement never compensates and supports safe state retry`,async()=>{
  const f=await fixture({role:'venue'});if(state==='active')await f.run('disabled');
  const uncertain=accountLifecycleCaller({db,userId:f.userId,afterCommit:()=>({data:null,error:{code:'SUPABASE_UNAVAILABLE'}})});
  await assert.rejects(uncertain.run(state),error=>error.status===503);
  const committed=await accountLifecycleSnapshot(db);
  assert.equal((await row('app_users','id',f.userId)).account_state,state);
  assert.equal((await row('venues','id',f.venueId)).is_active,state==='active');
  assert.equal(Boolean(await row('account_self_pauses','user_id',f.userId)),state==='disabled');
  assert.equal((await f.run(state)).accountState,state);
  if(state!=='deleted')assert.deepEqual(await accountLifecycleSnapshot(db),committed);
});
test('a failed RPC response cannot overwrite an independent venue retirement',async()=>{
  const f=await fixture({role:'venue'});
  const failed=accountLifecycleCaller({userId:f.userId,response:async()=>{
    await db.query('update public.venues set is_active=false where id=$1',[f.venueId]);
    return {data:null,error:{code:'SUPABASE_UNAVAILABLE'}};
  }});
  await assert.rejects(failed.run('disabled'),error=>error.status===503);
  assert.equal((await row('venues','id',f.venueId)).is_active,false);
  assert.equal((await row('app_users','id',f.userId)).account_state,'active');assert.equal(failed.calls.length,1);
});
for(const sql of ["is_active=false","is_active=true","page_review_status='published'","published_at=published_at"])test(`later explicit venue decision ${sql} prevents stale pause restoration`,async()=>{
  const f=await fixture({role:'venue'});await f.run('disabled');
  await db.query(`update public.venues set ${sql} where id=$1`,[f.venueId]);
  const prior=await row('venues','id',f.venueId);await f.run('active');assert.deepEqual(await row('venues','id',f.venueId),prior);
});
for(const role of ['customer','venue','dancer','admin'])for(const sql of ["account_state='disabled'","dmca_suspended_at=now()","role=role"])test(`${role} later account decision ${sql} revokes self-reactivation`,async()=>{
  const f=await fixture({role});await f.run('disabled');await db.query(`update public.app_users set ${sql} where id=$1`,[f.userId]);
  const before=await accountLifecycleSnapshot(db);
  for(const state of ['disabled','active'])await assert.rejects(f.run(state),error=>error.status===403);
  assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
for(const profilePublic of [false,true])test(`dancer pause preserves prior public=${profilePublic} on resume`,async()=>{
  const f=await fixture({role:'dancer',profilePublic});await f.run('disabled');assert.equal((await row('dancer_profiles','id',f.dancerId)).is_public,false);
  await f.run('active');const profile=await row('dancer_profiles','id',f.dancerId);
  assert.equal(profile.status,'approved');assert.equal(profile.is_public,profilePublic);assert.equal(profile.disabled_at,null);
});
test('active account reactivation is a no-op and cannot republish an incognito profile',async()=>{
  const f=await fixture({role:'dancer',profilePublic:false}),before=await accountLifecycleSnapshot(db);await f.run('active');assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
for(const sql of ["is_public=false","status='disabled'","admin_disabled_at=now()","dmca_suspended_at=now()","verification_status='rejected'","photo_review_status='rejected'","venue_approved_at=null","approved_at=null"])test(`later dancer decision ${sql} remains intact after account resume`,async()=>{
  const f=await fixture({role:'dancer'});await f.run('disabled');await db.query(`update public.dancer_profiles set ${sql} where id=$1`,[f.dancerId]);
  const prior=await row('dancer_profiles','id',f.dancerId);await f.run('active');assert.deepEqual(await row('dancer_profiles','id',f.dancerId),prior);
});
test('unrelated account, venue and profile edits retain legitimate restoration ownership',async()=>{
  for(const role of ['venue','dancer']) {
    const f=await fixture({role});await f.run('disabled');await db.query("update public.app_users set display_name='Changed name' where id=$1",[f.userId]);
    if(f.venueId)await db.query("update public.venues set city='Synthetic City' where id=$1",[f.venueId]);
    if(f.dancerId)await db.query("update public.dancer_profiles set city='Synthetic City' where id=$1",[f.dancerId]);
    await f.run('active');assert.equal((await row('app_users','id',f.userId)).display_name,'Changed name');
    if(f.venueId)assert.equal((await row('venues','id',f.venueId)).is_active,true);
    if(f.dancerId)assert.equal((await row('dancer_profiles','id',f.dancerId)).is_public,true);
  }
});
for(const role of ['customer','venue','dancer','admin'])test(`${role} cannot turn an active DMCA hold into a trusted self-pause`,async()=>{
  const f=await fixture({role});await db.query('update public.app_users set dmca_suspended_at=now()where id=$1',[f.userId]);const before=await accountLifecycleSnapshot(db);
  for(const target of ['disabled','active'])await assert.rejects(f.run(target),error=>error.status===403);
  assert.deepEqual(await accountLifecycleSnapshot(db),before);assert.equal((await f.run('deleted')).accountState,'deleted');
});
for(const role of ['anon','authenticated'])test(`${role} cannot call the server transition or inspect/forge private pause records`,async()=>{
  const f=await fixture();await f.run('disabled');
  for(const sql of ['select * from public.account_self_pauses','delete from public.account_self_pauses','update public.account_self_pauses set venue_was_active=true',`insert into public.account_self_pauses(user_id)values('${accountLifecycleId(999999)}')`,`select public.transition_own_account_safely('${f.userId}','active')`])await assert.rejects(asAccountLifecycleRole(db,role,f.userId,()=>db.exec(sql)),error=>error.code==='42501');
});
test('service calls require the service claim and never permit trigger functions as RPCs',async()=>{
  const f=await fixture();await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  try {await assert.rejects(transitionOwnAccount(db,f.userId,'disabled'),error=>error.code==='42501');}
  finally {await db.exec("select set_config('request.jwt.claim.role','service_role',false)");}
  await assert.rejects(asAccountLifecycleRole(db,'service_role',null,()=>db.exec('select public.invalidate_account_self_pause()')),error=>error.code==='42501');
});
test('venue team account pause and deletion cannot change another owners venue',async()=>{
  const owner=await fixture({role:'venue'}),member=await fixture({role:'venue'});await db.query('delete from public.venues where id=$1',[member.venueId]);
  await db.query("insert into public.venue_team_members(id,venue_id,user_id,role,status)values($1,$2,$3,'staff','active')",[accountLifecycleId(999998),owner.venueId,member.userId]);
  const before=await row('venues','id',owner.venueId);await member.run('disabled');await member.run('deleted');assert.deepEqual(await row('venues','id',owner.venueId),before);
});
test('legacy import retains trusted paused access without inventing historical publication ownership',async()=>{
  const legacy=await createAccountLifecycleDatabase({migrate:false});
  try {
    const trusted=await seedAccountLifecycle(legacy,{n:90000,role:'dancer',state:'disabled',metadata:{mydancr_self_disabled_at:'2026-09-09T12:00:00.000Z'}});
    await legacy.query("update public.dancer_profiles set status='disabled',disabled_at=now(),is_public=false where id=$1",[trusted.dancerId]);
    const forged=await seedAccountLifecycle(legacy,{n:91000,state:'disabled',forgedMetadata:{mydancr_self_disabled_at:'2026-09-09T12:00:00.000Z'}});
    const stale=await seedAccountLifecycle(legacy,{n:92000,state:'active',metadata:{mydancr_self_disabled_at:'2026-09-09T12:00:00.000Z'}});
    const held=await seedAccountLifecycle(legacy,{n:93000,state:'disabled',metadata:{mydancr_self_disabled_at:'2026-09-09T12:00:00.000Z'}});
    await legacy.query('update public.app_users set dmca_suspended_at=now()where id=$1',[held.userId]);
    const original=(await legacy.query('select jsonb_agg(to_jsonb(a)order by id)data from auth.users a')).rows[0].data;await legacy.exec(accountLifecycleSource);
    assert.equal((await legacy.query('select count(*)::int n from public.account_self_pauses')).rows[0].n,1);await transitionOwnAccount(legacy,trusted.userId,'active');
    const profile=(await legacy.query('select status,is_public,disabled_at from public.dancer_profiles where id=$1',[trusted.dancerId])).rows[0];
    assert.equal(profile.status,'approved');assert.equal(profile.is_public,false);assert.equal(profile.disabled_at,null);
    await assert.rejects(transitionOwnAccount(legacy,forged.userId,'active'),error=>error.code==='42501');await assert.rejects(transitionOwnAccount(legacy,held.userId,'active'),error=>error.code==='42501');
    assert.equal((await transitionOwnAccount(legacy,stale.userId,'active')).account_state,'active');
    assert.deepEqual((await legacy.query('select jsonb_agg(to_jsonb(a)order by id)data from auth.users a')).rows[0].data,original);
  } finally {await legacy.close();}
});
for(const [role,state,table,event] of [
  ['customer','disabled','app_users','update'],['customer','active','app_users','update'],['customer','deleted','app_users','update'],
  ['venue','disabled','venues','update'],['venue','active','venues','update'],['venue','deleted','venues','update'],
  ['dancer','disabled','dancer_profiles','update'],['dancer','active','dancer_profiles','update'],['dancer','deleted','dancer_profiles','update'],
  ['customer','disabled','account_self_pauses','insert'],
])test(`suppressed ${table} ${event} rolls back the entire ${role} ${state} transition`,async()=>{
  const f=await fixture({role});if(state==='active')await f.run('disabled');const before=await accountLifecycleSnapshot(db);
  await db.exec(`create function public.synthetic_suppress_account_write()returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_suppress_account_write before ${event} on public.${table} for each row execute function public.synthetic_suppress_account_write()`);
  try {await assert.rejects(transitionOwnAccount(db,f.userId,state),error=>error.code==='40001');assert.deepEqual(await accountLifecycleSnapshot(db),before);}
  finally {await db.exec(`drop trigger synthetic_suppress_account_write on public.${table};drop function public.synthetic_suppress_account_write()`);}
});
for(const [role,state,table,event,change] of [
  ['customer','disabled','app_users','update',"new.account_state:='active'"],
  ['venue','disabled','venues','update','new.is_active:=true'],
  ['dancer','disabled','dancer_profiles','update','new.is_public:=true'],
  ['customer','disabled','account_self_pauses','insert','new.legacy_imported:=true'],
])test(`altered ${table} write cannot acknowledge a partial ${state} change`,async()=>{
  const f=await fixture({role}),before=await accountLifecycleSnapshot(db);
  await db.exec(`create function public.synthetic_alter_account_write()returns trigger language plpgsql as $$begin ${change};return new;end$$;create trigger synthetic_alter_account_write before ${event} on public.${table} for each row execute function public.synthetic_alter_account_write()`);
  try {await assert.rejects(transitionOwnAccount(db,f.userId,state),error=>error.code==='40001');assert.deepEqual(await accountLifecycleSnapshot(db),before);}
  finally {await db.exec(`drop trigger synthetic_alter_account_write on public.${table};drop function public.synthetic_alter_account_write()`);}
});
test('a later copyright restriction and restoration do not recreate revoked self-service permission',async()=>{
  const f=await fixture({role:'dancer'});await f.run('disabled');
  await db.query("update public.app_users set account_state='disabled',dmca_suspended_at=now()where id=$1",[f.userId]);
  await db.query("update public.app_users set account_state='disabled',dmca_suspended_at=null where id=$1",[f.userId]);
  const before=await accountLifecycleSnapshot(db);await assert.rejects(f.run('active'),error=>error.status===403);assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
test('the legacy paused venue account can resume login without inventing earlier venue publication ownership',async()=>{
  const legacy=await createAccountLifecycleDatabase({migrate:false});
  try {
    const f=await seedAccountLifecycle(legacy,{n:94000,role:'venue',state:'disabled',venueActive:false,metadata:{mydancr_self_disabled_at:'2026-09-09T12:00:00.000Z'}});
    const originalVenue=(await legacy.query('select to_jsonb(v)row from public.venues v where id=$1',[f.venueId])).rows[0].row;
    const originalAuth=(await legacy.query('select to_jsonb(u)row from auth.users u where id=$1',[f.userId])).rows[0].row;
    await legacy.exec(accountLifecycleSource);
    const pause=(await legacy.query('select legacy_imported,venue_id,venue_was_active from public.account_self_pauses where user_id=$1',[f.userId])).rows[0];
    assert.deepEqual(pause,{legacy_imported:true,venue_id:null,venue_was_active:null});
    assert.equal((await transitionOwnAccount(legacy,f.userId,'active')).account_state,'active');
    assert.deepEqual((await legacy.query('select to_jsonb(v)row from public.venues v where id=$1',[f.venueId])).rows[0].row,originalVenue);
    assert.deepEqual((await legacy.query('select to_jsonb(u)row from auth.users u where id=$1',[f.userId])).rows[0].row,originalAuth);
    assert.equal((await legacy.query('select count(*)::int n from public.account_self_pauses')).rows[0].n,0);
  }finally{await legacy.close();}
});
test('Supabase default service grants are reduced to the explicit private table contract',async()=>{
  const fixture=await createAccountLifecycleDatabase({migrate:false});
  try {
    await fixture.exec('alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant all on functions to anon,authenticated,service_role');
    await fixture.exec(accountLifecycleSource);
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await fixture.query("select has_table_privilege('service_role','public.account_self_pauses',$1)allowed",[privilege])).rows[0].allowed,true);
    for(const privilege of ['TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await fixture.query("select has_table_privilege('service_role','public.account_self_pauses',$1)allowed",[privilege])).rows[0].allowed,false);
    for(const role of ['anon','authenticated'])assert.equal((await fixture.query("select has_function_privilege($1,'public.transition_own_account_safely(uuid,text)','EXECUTE')allowed",[role])).rows[0].allowed,false);
    assert.equal((await fixture.query("select has_function_privilege('service_role','public.invalidate_account_self_pause()','EXECUTE')allowed")).rows[0].allowed,false);
  } finally {await fixture.close();}
});
test('the computed venue offer flag follows venue row visibility and has no named RPC argument',async()=>{
  const f=await fixture({role:'venue',venueActive:false});
  await db.query("update public.club_deals set deal_title='Free admission',offer_type='admission',payout_type='flat',payout_amount_cents=1000,is_active=true where venue_id=$1",[f.venueId]);
  const read=()=>db.query('select id,public.has_active_club_deal(v)offer from public.venues v where id=$1',[f.venueId]);
  assert.equal((await asAccountLifecycleRole(db,'anon',null,read)).rows.length,0);
  assert.equal((await asAccountLifecycleRole(db,'authenticated',f.userId,read)).rows[0].offer,true);
  assert.equal((await db.query("select proargnames from pg_proc where oid='public.has_active_club_deal(public.venues)'::regprocedure")).rows[0].proargnames,null);
});
