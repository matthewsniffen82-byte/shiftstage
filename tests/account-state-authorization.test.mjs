import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createAccountLifecycleDatabase,seedAccountLifecycle,accountLifecycleSnapshot} from './helpers/account-lifecycle-database.mjs';
import {accountLifecycleCaller} from './helpers/account-lifecycle-caller.mjs';
let db,next=1;
before(async()=>{db=await createAccountLifecycleDatabase();});
after(async()=>db?.close());
async function fixture(options={}) {
  const ids=await seedAccountLifecycle(db,{...options,n:next++});
  return {...ids,...accountLifecycleCaller({db,userId:ids.userId})};
}
const row=async(table,key,id)=>(await db.query(`select * from public.${table} where ${key}=$1`,[id])).rows[0];
for(const role of ['customer','dancer','venue','admin']) {
  for(const target of ['active','disabled']) {
    test(`administratively disabled ${role} cannot use self-service ${target}`,async()=>{
      const f=await fixture({role,state:'disabled'}),before=await accountLifecycleSnapshot(db);
      await assert.rejects(f.run(target),error=>error.status===403);assert.deepEqual(await accountLifecycleSnapshot(db),before);
    });
    test(`deleted ${role} cannot regain access through ${target}`,async()=>{
      const f=await fixture({role,state:'deleted',metadata:{mydancr_self_disabled_at:'old-pause'}}),before=await accountLifecycleSnapshot(db);
      await assert.rejects(f.run(target),error=>error.status===403);assert.deepEqual(await accountLifecycleSnapshot(db),before);
    });
  }
  test(`active ${role} retains atomic self-disable and reactivation`,async()=>{
    const f=await fixture({role});await f.run('disabled');
    assert.equal((await row('app_users','id',f.userId)).account_state,'disabled');assert.ok(await row('account_self_pauses','user_id',f.userId));
    if(f.venueId)assert.equal((await row('venues','id',f.venueId)).is_active,false);
    await f.run('active');assert.equal((await row('app_users','id',f.userId)).account_state,'active');assert.equal(await row('account_self_pauses','user_id',f.userId),undefined);
    if(f.venueId)assert.equal((await row('venues','id',f.venueId)).is_active,true);
    await db.query("update public.app_users set account_state='disabled' where id=$1",[f.userId]);await assert.rejects(f.run('active'),error=>error.status===403);
  });
}
test('a suspended user cannot manufacture a self-pause permission using user metadata',async()=>{
  const f=await fixture({state:'disabled',forgedMetadata:{role:'admin',mydancr_self_disabled_at:'forged'}}),before=await accountLifecycleSnapshot(db);
  await assert.rejects(f.run('disabled'),error=>error.status===403);await assert.rejects(f.run('active'),error=>error.status===403);assert.deepEqual(await accountLifecycleSnapshot(db),before);
});
test('a failed disable transaction preserves account, publication, Auth metadata and pause records',async()=>{
  const f=await fixture({role:'venue'}),before=await accountLifecycleSnapshot(db);
  await db.exec("create function public.synthetic_fail_pause()returns trigger language plpgsql as $$begin raise exception 'Synthetic write failure';end$$;create trigger synthetic_fail_pause before insert on public.account_self_pauses for each row execute function public.synthetic_fail_pause()");
  try {await assert.rejects(f.run('disabled'),error=>error.status===503);assert.deepEqual(await accountLifecycleSnapshot(db),before);}
  finally {await db.exec('drop trigger synthetic_fail_pause on public.account_self_pauses;drop function public.synthetic_fail_pause()');}
});
test('a private venue stays private through an authorized pause and resume',async()=>{
  const f=await fixture({role:'venue',venueActive:false});await f.run('disabled');await f.run('active');assert.equal((await row('venues','id',f.venueId)).is_active,false);
});
test('an old active-account Auth marker cannot restore an obsolete public venue state',async()=>{
  const f=await fixture({role:'venue',venueActive:false,metadata:{mydancr_self_disabled_at:'old-pause',mydancr_venue_was_active:true}});
  await f.run('disabled');await f.run('active');assert.equal((await row('venues','id',f.venueId)).is_active,false);
});
test('failed venue restoration retains the exact self-pause and private state for retry',async()=>{
  const f=await fixture({role:'venue'});await f.run('disabled');const before=await accountLifecycleSnapshot(db);
  await db.exec("create function public.synthetic_fail_restore()returns trigger language plpgsql as $$begin if new.is_active then raise exception 'Synthetic restoration failure';end if;return new;end$$;create trigger synthetic_fail_restore before update on public.venues for each row execute function public.synthetic_fail_restore()");
  try {await assert.rejects(f.run('active'),error=>error.status===503);assert.deepEqual(await accountLifecycleSnapshot(db),before);}
  finally {await db.exec('drop trigger synthetic_fail_restore on public.venues;drop function public.synthetic_fail_restore()');}
  await f.run('active');assert.equal((await row('venues','id',f.venueId)).is_active,true);
});
for(const state of ['active','disabled','deleted'])test(`own account deletion remains available from ${state}`,async()=>{
  const f=await fixture({state,role:'venue'}),result=await f.run('deleted');assert.equal(result.accountState,'deleted');assert.equal(result.email,null);assert.equal(result.displayName,null);
  assert.equal((await row('venues','id',f.venueId)).is_active,false);assert.equal(await row('account_self_pauses','user_id',f.userId),undefined);
});
