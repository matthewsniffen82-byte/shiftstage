import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createAccountLifecycleDatabase,seedAccountLifecycle,accountLifecycleSnapshot,transitionOwnAccount} from './helpers/account-lifecycle-database.mjs';
import {accountLifecycleCaller} from './helpers/account-lifecycle-caller.mjs';
let db,next=2000;
before(async()=>{db=await createAccountLifecycleDatabase();});
after(async()=>db?.close());
async function fixture(role,state,held=false) {
  const ids=await seedAccountLifecycle(db,{n:next++,role}),caller=accountLifecycleCaller({db,userId:ids.userId});
  if(state==='disabled')await caller.run('disabled');
  if(held)await db.query('update public.app_users set dmca_suspended_at=now()where id=$1',[ids.userId]);
  return {...ids,...caller};
}
for(const role of ['customer','dancer','venue','admin']) {
  for(const state of ['active','disabled']) {
    test(`${role} with an active copyright restriction cannot self-reactivate from ${state}`,async()=>{
      const f=await fixture(role,state,true),before=await accountLifecycleSnapshot(db);await assert.rejects(f.run('active'),error=>error.status===403);assert.deepEqual(await accountLifecycleSnapshot(db),before);
    });
    test(`${role} without a copyright restriction keeps authorized ${state} reactivation`,async()=>{
      const f=await fixture(role,state),result=await f.run('active');assert.equal(result.accountState,'active');assert.equal('dmca_suspended_at'in result,false);
    });
    test(`${role} restriction committed after ${state} user intent prevents the atomic transaction`,async()=>{
      const f=await fixture(role,state);
      const interleaved=accountLifecycleCaller({userId:f.userId,response:async args=>{
        await db.query("update public.app_users set account_state='disabled',dmca_suspended_at=now()where id=$1",[f.userId]);
        const before=await accountLifecycleSnapshot(db);
        try {await transitionOwnAccount(db,f.userId,args.p_account_state);assert.fail('Restriction must reject the transition');}
        catch(error) {assert.equal(error.code,'42501');assert.deepEqual(await accountLifecycleSnapshot(db),before);return {data:null,error};}
      }});
      await assert.rejects(interleaved.run('active'),error=>error.status===403);
    });
  }
  test(`${role} retains own-account deletion during a copyright restriction`,async()=>{
    const f=await fixture(role,'disabled',true),result=await f.run('deleted');assert.equal(result.accountState,'deleted');assert.equal(result.email,null);assert.equal(result.displayName,null);
  });
}
