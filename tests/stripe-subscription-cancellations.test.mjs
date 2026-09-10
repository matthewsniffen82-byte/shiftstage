import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test, {before,beforeEach,after} from 'node:test';
import ts from 'typescript';
import Stripe from 'stripe';
import {PGlite} from '@electric-sql/pglite';
import {readBoundedRequestBytes} from '../src/lib/bounded-json-body.ts';
import {resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const dancerId='00000000-0000-4000-8000-000000000001';
const otherId='00000000-0000-4000-8000-000000000002';
const secret='synthetic-subscription-cancellation-secret';
let pg;
before(async()=>{
  pg=new PGlite();
  await pg.exec("set timezone='UTC'");
  await pg.exec('create table public.subscriptions(id uuid primary key default gen_random_uuid(),dancer_id uuid not null unique,stripe_customer_id text,stripe_subscription_id text unique,stripe_price_id text,status text not null,current_period_end timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now())');
});
after(async()=>pg?.close());
beforeEach(async()=>{
  await pg.exec('truncate public.subscriptions');
  await pg.query("insert into public.subscriptions(dancer_id,stripe_subscription_id,stripe_customer_id,status,current_period_end) values($1,'sub_current','cus_current','active','2030-01-01'),($2,'sub_other','cus_other','active','2030-02-01')",[dancerId,otherId]);
});
const rows=async()=>(await pg.query('select * from public.subscriptions order by dancer_id')).rows;
function module(path,dependencies){
  const exports={};
  vm.runInNewContext(ts.transpileModule(read(path),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText,{
    exports,Buffer,Date,Headers,console:{warn(){},error(){}},
    require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error('Unexpected dependency '+name);},
  });
  return exports;
}
function harness({beforeUpdate,error}={}){
  const calls=[],finished=[];
  const client={
    from(table){
      assert.equal(table,'subscriptions');
      const filters=[];
      let update;
      const q={
        update(value){update=value;return q;},
        eq(key,value){assert.ok(['dancer_id','stripe_subscription_id'].includes(key));filters.push([key,value]);return q;},
        async then(resolve,reject){
          try{
            calls.push({filters,update});
            if(error)return resolve({data:null,error});
            await beforeUpdate?.();
            const entries=Object.entries(update),values=entries.map(([,value])=>value);
            assert.deepEqual(entries.map(([key])=>key),['status','current_period_end']);
            const where=filters.map(([key,value])=>{values.push(value);return key+'=$'+values.length;}).join(' and ');
            const set=entries.map(([key],index)=>key+'=$'+(index+1)).join(',');
            await pg.query('update public.subscriptions set '+set+' where '+where,values);
            resolve({data:null,error:null});
          }catch(problem){reject(problem);}
        },
      };
      return q;
    },
  };
  const payments=module('../src/lib/dancr/payments.ts',{'../stripe':{}});
  const route=module('../app/api/stripe/webhook/route.ts',{
    'next/server':{NextResponse:{json:Response.json}},
    '@/src/lib/api':{apiError:(problem,fallback)=>{const result=resolveApiError(problem,fallback);return Response.json(result.body,{status:result.status});}},
    '@/src/lib/bounded-json-body':{readBoundedRequestBytes},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
    '@/src/lib/dancr/payments':payments,
    '@/src/lib/dancr/finance-provider-events':{
      recordPaymentProviderWebhook:async()=>true,
      finishPaymentProviderWebhook:async(...args)=>finished.push(args[2]?'failed':'processed'),
    },
    '@/src/lib/server-env':{getServerEnv:()=>secret},
    '@/src/lib/security/safe-error-metadata':{safeErrorMetadata},stripe:Stripe,
  });
  async function deliver(overrides={}){
    const payload=JSON.stringify({
      id:'evt_subscription_cancel_synthetic',type:'customer.subscription.deleted',created:1700000000,
      data:{object:{id:'sub_current',object:'subscription',customer:'cus_current',status:'canceled',current_period_end:1700000000,metadata:{dancerId},...overrides}},
    });
    const signature=Stripe.webhooks.generateTestHeaderString({payload,secret});
    return route.POST(new Request('https://example.test/api/stripe/webhook',{
      method:'POST',headers:{'stripe-signature':signature},body:payload,
    }));
  }
  return {deliver,calls,finished};
}
test('current subscription cancellation updates only its matching dancer and subscription',async()=>{
  const before=await rows(),h=harness();
  assert.equal((await h.deliver()).status,200);
  const after=await rows();
  assert.equal(after[0].status,'canceled');
  assert.equal(new Date(after[0].current_period_end).toISOString(),'2023-11-14T22:13:20.000Z');
  assert.equal(after[0].stripe_subscription_id,'sub_current');
  assert.equal(after[0].stripe_customer_id,'cus_current');
  assert.deepEqual(after[1],before[1]);
  assert.deepEqual(h.finished,['processed']);
});
test('a late cancellation for a former subscription cannot cancel the current subscription',async()=>{
  const before=await rows(),h=harness();
  assert.equal((await h.deliver({id:'sub_former'})).status,200);
  assert.deepEqual(await rows(),before);
  assert.deepEqual(h.finished,['processed']);
});
test('a subscription ID cannot target a different dancer through event metadata',async()=>{
  const before=await rows(),h=harness();
  assert.equal((await h.deliver({metadata:{dancerId:otherId}})).status,200);
  assert.deepEqual(await rows(),before);
});
test('the cancellation predicate still protects a replacement committed immediately before UPDATE',async()=>{
  const h=harness({beforeUpdate:()=>pg.query("update public.subscriptions set stripe_subscription_id='sub_replacement',status='active',current_period_end='2031-01-01' where dancer_id=$1",[dancerId])});
  assert.equal((await h.deliver()).status,200);
  const after=await rows();
  assert.equal(after[0].stripe_subscription_id,'sub_replacement');
  assert.equal(after[0].status,'active');
  assert.equal(new Date(after[0].current_period_end).toISOString(),'2031-01-01T00:00:00.000Z');
});
test('missing dancer metadata skips database work',async()=>{
  const before=await rows(),h=harness();
  assert.equal((await h.deliver({metadata:{}})).status,200);
  assert.deepEqual(await rows(),before);
  assert.equal(h.calls.length,0);
});
test('cancellation of an already removed local record does not recreate it',async()=>{
  await pg.query('delete from public.subscriptions where dancer_id=$1',[dancerId]);
  const before=await rows(),h=harness();
  assert.equal((await h.deliver()).status,200);
  assert.deepEqual(await rows(),before);
});
test('repeated cancellation preserves the confirmed state and unrelated subscription',async()=>{
  const h=harness();
  assert.equal((await h.deliver()).status,200);
  const before=await rows();
  assert.equal((await h.deliver()).status,200);
  assert.deepEqual(await rows(),before);
});
test('the existing canceled fallback and absent period are retained for the matching subscription',async()=>{
  const h=harness();
  assert.equal((await h.deliver({status:null,current_period_end:null})).status,200);
  const after=await rows();
  assert.equal(after[0].status,'canceled');
  assert.equal(after[0].current_period_end,null);
  assert.equal(after[1].status,'active');
});
test('a database outage reports a generic delivery failure without changing subscriptions',async()=>{
  const before=await rows(),h=harness({error:{code:'08006',message:'Synthetic private SQL detail'}});
  const response=await h.deliver();
  assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{ok:false,error:'Unable to process Stripe webhook.'});
  assert.deepEqual(await rows(),before);
  assert.deepEqual(h.finished,['failed']);
});
