import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountLifecycleCaller} from './helpers/account-lifecycle-caller.mjs';
const userId='a2700000-0000-4000-8000-000000099999';
const valid={id:userId,role:'customer',display_name:'Synthetic',email:'synthetic@example.invalid',account_state:'disabled'};
for(const [name,data] of [
  ['null',null],['array',[valid]],['primitive','disabled'],['missing fields',{}],
  ['wrong owner',{...valid,id:'a2700000-0000-4000-8000-000000099998'}],['wrong state',{...valid,account_state:'active'}],
  ['invalid role',{...valid,role:'superadmin'}],['missing display name',{...valid,display_name:undefined}],
  ['object display name',{...valid,display_name:{}}],['missing email',{...valid,email:undefined}],['object email',{...valid,email:{}}],
])test(`account mutation rejects ${name} receipt with no independent writes`,async()=>{
  const f=accountLifecycleCaller({userId,response:()=>({data,error:null})});await assert.rejects(f.run('disabled'),error=>error.status===503);assert.equal(f.calls.length,1);
});
for(const code of ['PGRST202','42883','SUPABASE_UNAVAILABLE','57014','40P01','40001','55P03'])test(`account RPC ${code} fails closed without fallback or compensation`,async()=>{
  const f=accountLifecycleCaller({userId,response:()=>({data:null,error:{code}})});await assert.rejects(f.run('disabled'),error=>error.status===503);assert.equal(f.calls.length,1);
});
test('account transport exceptions remain uncertain without compensating writes',async()=>{
  const f=accountLifecycleCaller({userId,throwResponse:new Error('Synthetic transport failure')});await assert.rejects(f.run('disabled'),error=>error.status===503);assert.equal(f.calls.length,1);
});
test('account receipt projects only the expected private account fields',async()=>{
  const f=accountLifecycleCaller({userId,response:()=>({data:{...valid,dmca_suspended_at:'private',pause_record:{private:true},extra:'private'},error:null})});
  assert.deepEqual(JSON.parse(JSON.stringify(await f.run('disabled'))),{id:userId,role:'customer',displayName:'Synthetic',email:'synthetic@example.invalid',accountState:'disabled'});
});
