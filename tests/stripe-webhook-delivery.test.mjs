import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test,{before,beforeEach,after} from 'node:test';
import ts from 'typescript';
import Stripe from 'stripe';
import {createWebhookAttemptDatabase,seedWebhookAttemptDatabase,webhookSchema} from './helpers/payment-webhook-attempt-database.mjs';
import {readBoundedRequestBytes} from '../src/lib/bounded-json-body.ts';
import {resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const secret='synthetic-webhook-test-secret';
const processors=['syncCheckoutSessionSubscription','syncStripeSubscription','markStripeSubscriptionDeleted','syncStripeInvoice','markStripeInvoiceFailure','syncDancerConnectAccount','completeProviderPayout','reverseDancerPayoutTransfer'];
let pg;
before(async()=>{pg=await createWebhookAttemptDatabase();});
after(async()=>pg?.close());
beforeEach(async()=>seedWebhookAttemptDatabase(pg));

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
   calls.push({kind:'claim',name,args});assert.equal(name,'claim_payment_webhook_attempt');
   if(options.claimThrow)throw new Error('Synthetic private network detail');
   if(options.claimError)return {data:null,error:options.claimError};
   if(Object.hasOwn(options,'claimData'))return {data:options.claimData,error:null};
   const {rows}=await pg.query('select public.claim_payment_webhook_attempt($1,$2,$3,$4) as claimed',
    [args.p_payment_provider,args.p_provider_event_id,args.p_event_type,args.p_object_id]);
   if(options.loseClaimResponse)return {data:null,error:{code:'08006'}};
   if(options.transformClaim)return {data:options.transformClaim(rows[0].claimed),error:null};
   return {data:rows[0].claimed,error:null};
  },
  from(table){
   assert.equal(table,'payment_provider_webhook_events');let update=null,selection=null;const filters=[];
   const q={
    update(value){update=value;return q;},select(value){selection=value;return q;},
    then(resolve,reject){return q.maybeSingle().then(resolve,reject);},
    eq(key,value){assert.ok(['payment_provider','provider_event_id','id','attempt_count','processing_started_at','processing_status'].includes(key));filters.push([key,value]);return q;},
    async maybeSingle(){
     calls.push({kind:update?'finish':'lookup',filters,selection,update});
     assert.deepEqual(filters.slice(0,2).map(([key])=>key),['payment_provider','provider_event_id']);
     if(update){
      assert.equal(selection,'id');assert.deepEqual(filters.map(([key])=>key),['payment_provider','provider_event_id','id','attempt_count','processing_started_at','processing_status']);
      assert.deepEqual(filters[5],['processing_status','processing']);
      if(options.finishThrow)throw new Error('Synthetic private network detail');
      if(options.finishError)return {data:null,error:options.finishError};
      if(Object.hasOwn(options,'finishData'))return {data:options.finishData,error:null};
      const {rows}=await pg.query('update public.payment_provider_webhook_events set processing_status=$1,failure_reason=$2,processed_at=$3 where payment_provider=$4 and provider_event_id=$5 and id=$6 and attempt_count=$7 and processing_started_at=$8::timestamptz and processing_status=$9 returning id',
       [update.processing_status,update.failure_reason,update.processed_at,...filters.map(([,value])=>value)]);
      if(options.loseFinishResponse)return {data:null,error:{code:'08006'}};
      return {data:selection?rows[0]||null:null,error:null};
     }
     assert.fail('Ownership must be returned atomically, without a second lookup');
    },
   };return q;
  },
 };return {client,calls};
}
function harness(options={}){
 const db=database(options),effects=[],logs=[];let adminAccess=0,secretAccess=0;
 const events=module('../src/lib/dancr/finance-provider-events.ts',{
  './finance-audit-log':{},'./payout-account-store':{},'./payout-provider':{},'../stripe':{},
 });
 const handlers=Object.fromEntries(processors.map(name=>[name,async(...args)=>{effects.push({name,args});await options.process?.(name,args);}]));
 const route=module('../app/api/stripe/webhook/route.ts',{
  'next/server':{NextResponse:{json:Response.json}},
  '@/src/lib/api':{apiError:(error,fallback)=>{const result=resolveApiError(error,fallback);return Response.json(result.body,{status:result.status});}},
  '@/src/lib/bounded-json-body':{readBoundedRequestBytes},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>{adminAccess++;return db.client;}},
  '@/src/lib/dancr/payments':handlers,
  '@/src/lib/dancr/finance-provider-events':{...handlers,recordPaymentProviderWebhook:events.recordPaymentProviderWebhook,finishPaymentProviderWebhook:events.finishPaymentProviderWebhook,
   loadCurrentStripeWebhookInvoice:async(_client,invoice)=>({invoice:{...invoice,status:'open'},version:{id:'synthetic-invoice',updatedAt:'2020-01-01T00:00:00Z'}})},
  '@/src/lib/server-env':{getServerEnv:name=>{assert.equal(name,'STRIPE_WEBHOOK_SECRET');secretAccess++;return secret;}},
  '@/src/lib/security/safe-error-metadata':{safeErrorMetadata},stripe:Stripe,
 },{console:{warn:(...args)=>logs.push(args),error:(...args)=>logs.push(args)}});
 return {...db,effects,logs,events,post:route.POST,access:()=>({adminAccess,secretAccess})};
}
function event(type='customer.subscription.updated',id='evt_synthetic'){
 return {id,object:'event',type,created:Math.floor(Date.now()/1000),data:{object:{id:'sub_synthetic',metadata:{payout_batch_id:'synthetic-batch'},description:'Unicode café 🎉',...(type==='transfer.reversed'?{amount:1000,amount_reversed:1000,created:1700000000}:{})}}};
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
 const h=harness();await h.events.recordPaymentProviderWebhook(h.client,'stripe',{id:'evt_synthetic',type:'customer.subscription.updated',objectId:'sub_synthetic'});
 assert.equal((await h.post(request())).status,500);assert.equal(h.effects.length,0);
 await pg.exec("update public.payment_provider_webhook_events set processing_started_at=now()-interval '11 minutes'");
 assert.equal((await h.post(request())).status,200);assert.equal(h.effects.length,1);assert.equal((await rows())[0].attempt_count,2);
});
for(const claimData of [undefined,null,0,1,true,false,'true','false',[],{},NaN]){
 test('unconfirmed claim '+String(claimData)+' returns failure without processing or finalizing',async()=>{
  const h=harness({claimData});assert.equal((await h.post(request())).status,500);assert.equal(h.effects.length,0);assert.equal(h.calls.length,1);
 });
}
for(const status of ['processing','failed','unexpected']){
 test('false claim with '+status+' cannot be acknowledged as completed',async()=>{
  const h=harness({transformClaim:r=>({...r,claimed:false,status})});assert.equal((await h.post(request())).status,500);assert.equal(h.effects.length,0);assert.equal(h.calls.length,1);
 });
}
for(const key of ['claimError','finishError']){
 test(key+' remains a generic retryable failure',async()=>{
  const options={[key]:{code:'08006',message:'Synthetic private database detail'}};
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
 assert.equal(result.rows[0].fingerprint,webhookSchema.existing_function.fingerprint);
});
for(const [provider,id] of [['adyen','evt_synthetic'],['stripe','evt_other']]){
 test('processed '+provider+'/'+id+' cannot acknowledge a different claimed delivery',async()=>{
  await pg.query("insert into public.payment_provider_webhook_events(payment_provider,provider_event_id,event_type,processing_status) values($1,$2,'invoice.paid','processed')",[provider,id]);
  await pg.query("select public.claim_payment_provider_webhook('stripe','evt_synthetic','invoice.paid',null)");
  const h=harness();assert.equal((await h.post(request())).status,500);assert.deepEqual(h.effects,[]);
 });
}

for(const field of ['id','paymentProvider','eventId','eventType','objectId','claimed','status','attemptCount','processingStartedAt']){
 test('missing receipt '+field+' prevents handler execution',async()=>{
  const h=harness({transformClaim:r=>{delete r[field];return r;}});
  assert.equal((await h.post(request())).status,500);assert.deepEqual(h.effects,[]);assert.equal(h.calls.length,1);
 });
}
for(const [field,value] of [['id','invalid'],['id','98000000-0000-4000-8000-000000000099'],['paymentProvider','adyen'],['eventId','evt_other'],['eventType','invoice.voided'],['objectId','in_other'],['claimed','true'],['status','processed'],['attemptCount',0],['attemptCount',-1],['attemptCount',1.5],['attemptCount','1'],['attemptCount',Number.MAX_SAFE_INTEGER+1],['processingStartedAt','yesterday'],['processingStartedAt','2026-09-10T09:00:00.1234567Z']]){
 test('altered receipt '+field+' '+value+' never confirms a delivery',async()=>{
  const h=harness({transformClaim:r=>({...r,[field]:value})});assert.equal((await h.post(request())).status,500);
  // A well-formed but incorrect UUID passes receipt shape and is fenced by the stored row on completion.
  assert.equal(h.effects.length,field==='id'&&String(value).startsWith('9800')?1:0);
  assert.equal((await rows())[0].processing_status,'processing');
 });
}
for(const failure of [false,true]){
 test('an expired '+(failure?'failing':'successful')+' worker cannot finalize a newer in-flight worker',async()=>{
  let enterA,releaseA,enterB,releaseB;
  const enteredA=new Promise(r=>{enterA=r;}),gateA=new Promise(r=>{releaseA=r;});
  const enteredB=new Promise(r=>{enterB=r;}),gateB=new Promise(r=>{releaseB=r;});
  const a=harness({process:async()=>{enterA();await gateA;if(failure)throw new Error('synthetic failure');}});
  const b=harness({process:async()=>{enterB();await gateB;}});
  const pendingA=a.post(request());await enteredA;
  await pg.exec("update public.payment_provider_webhook_events set processing_started_at=clock_timestamp()-interval '11 minutes'");
  const pendingB=b.post(request());await enteredB;const before=await rows();
  try{
   releaseA();assert.equal((await pendingA).status,500);assert.deepEqual(await rows(),before);
   assert.equal(before[0].attempt_count,2);assert.equal(before[0].processing_status,'processing');
  }finally{releaseA();releaseB();}
  assert.equal((await pendingB).status,200);assert.equal((await rows())[0].processing_status,'processed');
 });
}
test('a stale failure cannot downgrade a newer completed delivery',async()=>{
 let entered,release;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 const old=harness({process:async()=>{entered();await gate;throw new Error('synthetic failure');}});
 const pending=old.post(request());await started;
 try{
  await pg.exec("update public.payment_provider_webhook_events set processing_started_at=clock_timestamp()-interval '11 minutes'");
  assert.equal((await harness().post(request())).status,200);const before=await rows();
  release();assert.equal((await pending).status,500);assert.deepEqual(await rows(),before);
 }finally{release();}
});
test('a lost claim response does not execute a handler or release an uncertain lease',async()=>{
 const h=harness({loseClaimResponse:true});assert.equal((await h.post(request())).status,500);
 assert.deepEqual(h.effects,[]);assert.deepEqual(h.calls.map(c=>c.kind),['claim']);assert.equal((await rows())[0].processing_status,'processing');
 assert.equal((await harness().post(request())).status,500);
});
test('a lost completion response preserves committed success and duplicate delivery does not replay work',async()=>{
 const h=harness({loseFinishResponse:true});assert.equal((await h.post(request())).status,500);
 assert.equal((await rows())[0].processing_status,'processed');assert.equal(h.effects.length,1);
 const retry=harness();assert.equal((await retry.post(request())).status,200);assert.deepEqual(retry.effects,[]);
});
for(const key of ['claimThrow','finishThrow'])test(key+' does not expose transport details or acknowledge success',async()=>{
 const h=harness({[key]:true}),response=await h.post(request());assert.equal(response.status,500);
 assert.ok(!(await response.text()).includes('private'));assert.ok(!JSON.stringify(h.logs).includes('private'));
});
test('receipt passed to completion is frozen, whitelisted and preserves timestamp microseconds',async()=>{
 await pg.exec("reset role;create or replace function public.synthetic_webhook_time() returns trigger language plpgsql as $$begin new.processing_started_at:='2099-01-01T00:00:00.123456Z';return new;end$$;create trigger synthetic_failure before insert on public.payment_provider_webhook_events for each row execute function public.synthetic_webhook_time();set role service_role");
 const h=harness({transformClaim:r=>({...r,metadata:{private:'never returned'},failure_reason:'private'})});
 const attempt=await h.events.recordPaymentProviderWebhook(h.client,'stripe',{id:'evt_synthetic',type:'invoice.paid',objectId:'in_synthetic'});
 assert.equal(Object.isFrozen(attempt),true);assert.deepEqual(Object.keys(attempt).sort(),['id','paymentProvider','eventId','attemptCount','processingStartedAt'].sort());
 assert.equal(attempt.processingStartedAt,'2099-01-01T00:00:00.123456+00:00');
 await h.events.finishPaymentProviderWebhook(h.client,attempt);
 assert.equal((await rows())[0].processing_status,'processed');
 assert.deepEqual(h.calls[1].filters[4],['processing_started_at','2099-01-01T00:00:00.123456+00:00']);
});
for(const attempt of [undefined,null,true,{}, {id:'not-a-receipt'}])test('invalid completion ownership '+String(attempt)+' never starts a query',async()=>{
 const h=harness();await assert.rejects(h.events.finishPaymentProviderWebhook(h.client,attempt));assert.deepEqual(h.calls,[]);
});
test('a wrong completion row cannot be acknowledged',async()=>{
 const h=harness({finishData:{id:'98000000-0000-4000-8000-000000000099'}});
 assert.equal((await h.post(request())).status,500);assert.equal((await rows())[0].processing_status,'processing');
});
