import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test,{before,beforeEach,after} from 'node:test';
import ts from 'typescript';
import Stripe from 'stripe';
import {PGlite} from '@electric-sql/pglite';
import {readBoundedRequestBytes} from '../src/lib/bounded-json-body.ts';
import {resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const secret='synthetic-webhook-test-secret';
const processors=['syncCheckoutSessionSubscription','syncStripeSubscription','markStripeSubscriptionDeleted','syncStripeInvoice','markStripeInvoiceFailure','syncDancerConnectAccount','completeProviderPayout','reverseDancerPayoutTransfer'];
let pg;
before(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.payment_provider_webhook_events(
 id uuid primary key default gen_random_uuid(),payment_provider text not null,provider_event_id text not null,
 event_type text not null,object_id text,processing_status text not null default 'processing',
 failure_reason text,processed_at timestamptz,processing_started_at timestamptz not null default now(),
 attempt_count integer not null default 1,unique(payment_provider,provider_event_id));
 alter table public.payment_provider_webhook_events enable row level security;
 grant select on public.payment_provider_webhook_events to anon,authenticated;
 grant all on public.payment_provider_webhook_events to service_role;`);
 // Git may check SQL out with CRLF on Windows; compare the documented LF definition.
 await pg.exec(read('./fixtures/payment-webhook-claim.sql').replace(/\r\n/g,'\n'));
 await pg.exec(`revoke all on function public.claim_payment_provider_webhook(text,text,text,text) from public,anon,authenticated;
 grant execute on function public.claim_payment_provider_webhook(text,text,text,text) to service_role;`);
});
after(async()=>pg?.close());
beforeEach(async()=>{await pg.exec('reset role;truncate public.payment_provider_webhook_events;set role service_role');});

function module(path,dependencies,context={}){
 const exports={};
 vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
  {exports,Buffer,Date,Headers,console:{warn(){},error(){}},...context,require:name=>{
   if(Object.hasOwn(dependencies,name))return dependencies[name];
   throw new Error('Unexpected dependency '+name);
  }});
 return exports;
}
function database(options={}){
 const calls=[];
 const client={
  async rpc(name,args){
   calls.push({kind:'claim',name,args});assert.equal(name,'claim_payment_provider_webhook');
   if(options.claimError)return {data:null,error:options.claimError};
   if(Object.hasOwn(options,'claimData'))return {data:options.claimData,error:null};
   const {rows}=await pg.query('select public.claim_payment_provider_webhook($1,$2,$3,$4) as claimed',
    [args.p_payment_provider,args.p_provider_event_id,args.p_event_type,args.p_object_id]);
   return {data:rows[0].claimed,error:null};
  },
  from(table){
   assert.equal(table,'payment_provider_webhook_events');let update=null,selection=null;const filters=[];
   const q={
    update(value){update=value;return q;},select(value){selection=value;return q;},
    then(resolve,reject){return q.maybeSingle().then(resolve,reject);},
    eq(key,value){assert.ok(['payment_provider','provider_event_id','processing_status'].includes(key));filters.push([key,value]);return q;},
    async maybeSingle(){
     calls.push({kind:update?'finish':'lookup',filters,selection,update});
     assert.deepEqual(filters.slice(0,2).map(([key])=>key),['payment_provider','provider_event_id']);
     if(update){
      assert.ok(selection===null||selection==='id');assert.deepEqual(filters[2],['processing_status','processing']);
      if(options.finishError)return {data:null,error:options.finishError};
      if(Object.hasOwn(options,'finishData'))return {data:options.finishData,error:null};
      const {rows}=await pg.query('update public.payment_provider_webhook_events set processing_status=$1,failure_reason=$2,processed_at=$3 where payment_provider=$4 and provider_event_id=$5 and processing_status=$6 returning id',
       [update.processing_status,update.failure_reason,update.processed_at,...filters.map(([,value])=>value)]);
      return {data:selection?rows[0]||null:null,error:null};
     }
     assert.equal(selection,'processing_status');
     if(options.lookupError)return {data:null,error:options.lookupError};
     if(Object.hasOwn(options,'row'))return {data:options.row,error:null};
     const {rows}=await pg.query('select processing_status from public.payment_provider_webhook_events where payment_provider=$1 and provider_event_id=$2',filters.map(([,value])=>value));
     return {data:rows[0]||null,error:null};
    },
   };return q;
  },
 };return {client,calls};
}
function harness(options={}){
 const db=database(options),effects=[],logs=[];let adminAccess=0,secretAccess=0;
 const events=module('../src/lib/dancr/finance-provider-events.ts',{
  './finance-audit-log':{},'./payout-account-store':{},'./payout-provider':{},
 });
 const handlers=Object.fromEntries(processors.map(name=>[name,async(...args)=>{effects.push({name,args});await options.process?.(name,args);}]));
 const route=module('../app/api/stripe/webhook/route.ts',{
  'next/server':{NextResponse:{json:Response.json}},
  '@/src/lib/api':{apiError:(error,fallback)=>{const result=resolveApiError(error,fallback);return Response.json(result.body,{status:result.status});}},
  '@/src/lib/bounded-json-body':{readBoundedRequestBytes},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>{adminAccess++;return db.client;}},
  '@/src/lib/dancr/payments':handlers,
  '@/src/lib/dancr/finance-provider-events':{...handlers,recordPaymentProviderWebhook:events.recordPaymentProviderWebhook,finishPaymentProviderWebhook:events.finishPaymentProviderWebhook},
  '@/src/lib/server-env':{getServerEnv:name=>{assert.equal(name,'STRIPE_WEBHOOK_SECRET');secretAccess++;return secret;}},
  '@/src/lib/security/safe-error-metadata':{safeErrorMetadata},stripe:Stripe,
 },{console:{warn:(...args)=>logs.push(args),error:(...args)=>logs.push(args)}});
 return {...db,effects,logs,events,post:route.POST,access:()=>({adminAccess,secretAccess})};
}
function event(type='customer.subscription.updated',id='evt_synthetic'){
 return {id,object:'event',type,created:Math.floor(Date.now()/1000),data:{object:{id:'sub_synthetic',metadata:{payout_batch_id:'synthetic-batch'},description:'Unicode café 🎉'}}};
}
function request(value=event(),options={}){
 const body=typeof value==='string'?value:JSON.stringify(value);
 const signature=Stripe.webhooks.generateTestHeaderString({payload:body,secret:options.secret||secret,timestamp:options.timestamp||Math.floor(Date.now()/1000)});
 return new Request('https://example.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature,...options.headers},body:options.body??body});
}
const rows=async()=>(await pg.query('select * from public.payment_provider_webhook_events order by provider_event_id')).rows;

test('unsigned delivery returns 400 before reading the stream, secret or service client',async()=>{
 const h=harness();let readBody=false;
 const response=await h.post({headers:new Headers(),get body(){readBody=true;throw new Error('Must not read');}});
 assert.equal(response.status,400);assert.equal(readBody,false);assert.deepEqual(h.access(),{adminAccess:0,secretAccess:0});assert.deepEqual(await rows(),[]);
});
for(const [name,options] of [['wrong secret',{secret:'different-synthetic-secret'}],['expired signature',{timestamp:Math.floor(Date.now()/1000)-601}],['altered signed bytes',{body:JSON.stringify(event())+' '}],['invalid header',{headers:{'stripe-signature':'t=bad,v1=invalid'}}]]){
 test(name+' is rejected by the real Stripe SDK before privileged access',async()=>{
  const h=harness(),response=await h.post(request(event(),options));assert.equal(response.status,400);
  assert.equal(h.access().adminAccess,0);assert.deepEqual(h.calls,[]);assert.deepEqual(h.effects,[]);
  assert.deepEqual(await response.json(),{ok:false,error:'Invalid Stripe webhook.'});
  assert.ok(!JSON.stringify(h.logs).includes(secret));assert.ok(!JSON.stringify(h.logs).includes('Unicode'));
 });
}
test('malformed signed JSON is rejected without a database write',async()=>{
 const h=harness();assert.equal((await h.post(request('{'))).status,400);assert.deepEqual(h.calls,[]);
});
test('one-megabyte body cap rejects both declared and streamed excess before signature verification',async()=>{
 for(const headers of [{},{'content-length':String(1024*1024+1)}]){
  const h=harness();assert.equal((await h.post(request('x'.repeat(1024*1024+1),{headers}))).status,413);
  assert.deepEqual(h.access(),{adminAccess:0,secretAccess:0});assert.deepEqual(h.calls,[]);
 }
});
test('unknown signed event types are acknowledged without claiming or processing',async()=>{
 const h=harness();assert.equal((await h.post(request(event('unhandled.synthetic')))).status,200);assert.deepEqual(h.calls,[]);assert.deepEqual(h.effects,[]);
});
test('valid signed Unicode bytes are processed once and a completed duplicate is acknowledged',async()=>{
 const h=harness();assert.equal((await h.post(request())).status,200);assert.equal(h.effects.length,1);
 const before=await rows(),duplicate=await h.post(request());assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
 assert.equal(h.effects.length,1);assert.deepEqual(await rows(),before);assert.equal(before[0].processing_status,'processed');
});
test('an in-flight duplicate gets a retryable failure until the first worker completes',async()=>{
 let begin,finish;const entered=new Promise(resolve=>{begin=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 const first=harness({process:async()=>{begin();await gate;}}),second=harness();
 const pending=first.post(request());await entered;
 try{assert.equal((await second.post(request())).status,500);assert.equal(second.effects.length,0);assert.equal((await rows())[0].attempt_count,1);}
 finally{finish();}
 assert.equal((await pending).status,200);assert.equal((await second.post(request())).status,200);assert.equal(second.effects.length,0);
});
test('a failed delivery is retried with the same event ID and completed without a second ledger row',async()=>{
 const failed=harness({process:()=>{throw Object.assign(new Error('synthetic sensitive provider body'),{code:'08006'});}});
 const response=await failed.post(request());assert.equal(response.status,500);assert.ok(!(await response.text()).includes('sensitive'));
 const record=(await rows())[0];assert.equal(record.processing_status,'failed');assert.ok(!record.failure_reason.includes('sensitive'));
 const retry=harness();assert.equal((await retry.post(request())).status,200);
 assert.equal((await rows()).length,1);assert.equal((await rows())[0].attempt_count,2);assert.equal((await rows())[0].processing_status,'processed');
});
test('crashed worker remains retryable during its lease and is reclaimed after the existing ten-minute expiry',async()=>{
 const h=harness();await h.events.recordPaymentProviderWebhook(h.client,'stripe',{id:'evt_synthetic',type:'customer.subscription.updated'});
 assert.equal((await h.post(request())).status,500);assert.equal(h.effects.length,0);
 await pg.exec("update public.payment_provider_webhook_events set processing_started_at=now()-interval '11 minutes'");
 assert.equal((await h.post(request())).status,200);assert.equal(h.effects.length,1);assert.equal((await rows())[0].attempt_count,2);
});
for(const claimData of [undefined,null,0,1,'true','false',[],{},NaN]){
 test('unconfirmed claim '+String(claimData)+' returns failure without processing or finalizing',async()=>{
  const h=harness({claimData});assert.equal((await h.post(request())).status,500);assert.equal(h.effects.length,0);assert.equal(h.calls.length,1);
 });
}
for(const row of [null,{}, {processing_status:'processing'},{processing_status:'failed'},{processing_status:'unexpected'}]){
 test('false claim with '+JSON.stringify(row)+' cannot be acknowledged as completed',async()=>{
  const h=harness({claimData:false,row});assert.equal((await h.post(request())).status,500);assert.equal(h.effects.length,0);assert.equal(h.calls.length,2);
 });
}
for(const key of ['claimError','lookupError','finishError']){
 test(key+' remains a generic retryable failure',async()=>{
  const options={[key]:{code:'08006',message:'Synthetic private database detail'},...(key==='lookupError'?{claimData:false}:{})};
  const h=harness(options),response=await h.post(request());assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{ok:false,error:'Unable to process Stripe webhook.'});
  assert.ok(!JSON.stringify(h.logs).includes('private database'));
 });
}
for(const finishData of [null,undefined,{}]){
 test('missing finalization acknowledgment '+String(finishData)+' cannot produce a successful delivery',async()=>{
  const h=harness({finishData});assert.equal((await h.post(request())).status,500);assert.equal(h.effects.length,1);
 });
}
const handled=[['checkout.session.completed','syncCheckoutSessionSubscription'],['customer.subscription.created','syncStripeSubscription'],['customer.subscription.updated','syncStripeSubscription'],['customer.subscription.deleted','markStripeSubscriptionDeleted'],...['created','finalized','sent','updated','paid','voided','marked_uncollectible'].map(x=>['invoice.'+x,'syncStripeInvoice']),...['payment_failed','payment_action_required'].map(x=>['invoice.'+x,'markStripeInvoiceFailure']),['account.updated','syncDancerConnectAccount'],['transfer.created','completeProviderPayout'],['transfer.reversed','reverseDancerPayoutTransfer']];
for(const [type,processor] of handled){
 test(type+' retains its handler behind a confirmed claim',async()=>{
  const h=harness();assert.equal((await h.post(request(event(type)))).status,200);assert.deepEqual(h.effects.map(x=>x.name),[processor]);
  assert.deepEqual(h.calls.map(x=>x.kind),['claim','finish']);assert.equal((await rows())[0].processing_status,'processed');
 });
}
for(const role of ['anon','authenticated']){
 test(role+' cannot claim events or read the private event ledger',async()=>{
  await pg.query("select public.claim_payment_provider_webhook('stripe','evt_private','invoice.paid',null)");
  await pg.exec('set role '+role);
  await assert.rejects(pg.query("select public.claim_payment_provider_webhook('stripe','evt_denied','invoice.paid',null)"),{code:'42501'});
  assert.deepEqual(await rows(),[]);
 });
}
test('the native fixture matches the captured production function definition',async()=>{
 const result=await pg.query("select md5(pg_get_functiondef('public.claim_payment_provider_webhook(text,text,text,text)'::regprocedure)) as fingerprint");
 // Production's captured function body contains CRLF. The fixture normalizes
 // only those line endings; its PostgreSQL-rendered definition is otherwise exact.
 assert.equal(result.rows[0].fingerprint,'01f6affe019c165528e9198595526479');
});
for(const [provider,id] of [['adyen','evt_synthetic'],['stripe','evt_other']]){
 test('processed '+provider+'/'+id+' cannot acknowledge a different claimed delivery',async()=>{
  await pg.query("insert into public.payment_provider_webhook_events(payment_provider,provider_event_id,event_type,processing_status) values($1,$2,'invoice.paid','processed')",[provider,id]);
  await pg.query("select public.claim_payment_provider_webhook('stripe','evt_synthetic','invoice.paid',null)");
  const h=harness();assert.equal((await h.post(request())).status,500);assert.deepEqual(h.effects,[]);
 });
}
