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
const id='00000000-0000-4000-8000-000000000001',otherId='00000000-0000-4000-8000-000000000002';
const secret='synthetic-invoice-webhook-secret',initialTime='2020-01-01T00:00:00.000Z';
let pg;
before(async()=>{
 pg=new PGlite();await pg.exec(`
 create table public.club_invoices(id uuid primary key,status text not null,amount_due_cents integer not null default 1000,
 amount_paid_cents integer not null default 0,stripe_invoice_id text unique,stripe_customer_id text,hosted_invoice_url text,
 invoice_pdf_url text,due_at timestamptz,paid_at timestamptz,external_payment_reference text,last_error text,updated_at timestamptz not null);
 create table public.deal_revenue_events(id uuid primary key,club_invoice_id uuid,status text,venue_payment_reference text,venue_payment_received_at timestamptz,audit jsonb);
 create table public.agent_commission_events(id uuid primary key,deal_revenue_event_id uuid,status text,venue_payment_received_at timestamptz,payable_at timestamptz,audit jsonb);
 `);await pg.exec(read('./fixtures/stripe-invoice-payment.sql'));
});
after(async()=>pg?.close());
beforeEach(async()=>{await pg.exec('truncate public.agent_commission_events,public.deal_revenue_events,public.club_invoices');await seed();});
async function seed({invoiceId=id,providerId='in_synthetic',status='open',paid=0}={}){
 await pg.query('insert into public.club_invoices(id,status,amount_paid_cents,stripe_invoice_id,stripe_customer_id,last_error,updated_at) values($1,$2,$3,$4,$5,$6,$7)',
  [invoiceId,status,paid,providerId,'cus_synthetic','Existing note',initialTime]);
}
const row=async(invoiceId=id)=>(await pg.query('select * from public.club_invoices where id=$1',[invoiceId])).rows[0];
const invoice=(status='open',overrides={})=>({id:'in_synthetic',object:'invoice',status,amount_paid:status==='paid'?1000:0,customer:'cus_synthetic',metadata:{mydancr_invoice_id:id},due_date:Math.floor(Date.now()/1000)+86400,hosted_invoice_url:'https://invoice.stripe.com/synthetic',invoice_pdf:'https://pay.stripe.com/synthetic.pdf',status_transitions:{paid_at:status==='paid'?1700000000:null},...overrides});
function module(path,dependencies){
 const exports={};vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
  {exports,Buffer,Date,Headers,console:{warn(){},error(){}},require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw new Error('Unexpected dependency '+name);}});
 return exports;
}
function harness({current=invoice(),retrieve=null,readError=null,updateError=null,beforeUpdate=null}={}){
 const calls=[],finished=[];let claimed=false;
 const client={
  async rpc(name,args){
   assert.equal(name,'apply_club_invoice_payment');calls.push({kind:'payment',args});
   const {rows}=await pg.query('select public.apply_club_invoice_payment($1,$2,$3,$4,$5,$6,$7) as result',
    [args.p_invoice_id,args.p_total_paid_cents,args.p_payment_reference,args.p_paid_at,args.p_stripe_invoice_id,args.p_hosted_invoice_url,args.p_invoice_pdf_url]);
   return {data:rows[0].result,error:null};
  },
  from(table){
   assert.equal(table,'club_invoices');const eq=[],or=[];let update=null,select='*';
   const allowed=new Set(['id','status','amount_due_cents','amount_paid_cents','stripe_invoice_id','stripe_customer_id','hosted_invoice_url','invoice_pdf_url','due_at','last_error','updated_at']);
   const q={
    select(value){select=value;return q;},limit(value){assert.equal(value,1);return q;},
    eq(key,value){assert.ok(allowed.has(key));eq.push([key,value]);return q;},
    or(value){for(const item of value.split(',')){const match=item.match(/^(id|stripe_invoice_id)\.eq\.(.+)$/);assert.ok(match);or.push([match[1],match[2]]);}return q;},
    update(value){update=value;return q;},single(){return execute();},maybeSingle(){return execute();},then(resolve,reject){return execute().then(resolve,reject);},
   };
   async function execute(){
    calls.push({kind:update?'update':'read',eq,or,select,update});
    if(update&&updateError)return {data:null,error:updateError};if(!update&&readError)return {data:null,error:readError};
    if(update)await beforeUpdate?.();
    const values=[],bind=value=>{values.push(value);return '$'+values.length;};
    const set=update?Object.entries(update).map(([key,value])=>{assert.ok(allowed.has(key));return key+'='+bind(value);}):[];
    const filters=eq.map(([key,value])=>key+'='+bind(value));
    if(or.length)filters.push('('+or.map(([key,value])=>key+'='+bind(value)).join(' or ')+')');
    const columns=select==='*'?'*':select.split(',').map(x=>{x=x.trim();assert.ok(allowed.has(x));return x;}).join(',');
    const sql=update?'update public.club_invoices set '+set.join(',')+' where '+filters.join(' and ')+' returning '+columns:
     'select '+columns+' from public.club_invoices where '+filters.join(' and ')+' limit 1';
    const {rows}=await pg.query(sql,values);if(rows[0]?.updated_at)rows[0].updated_at=new Date(rows[0].updated_at).toISOString();
    return {data:rows[0]||null,error:null};
   }return q;
  },
 };
 const events=module('../src/lib/dancr/finance-provider-events.ts',{
  './finance-audit-log':{},'./payout-account-store':{},'./payout-provider':{},
  '../stripe':{getStripe:()=>({invoices:{retrieve:async(providerId,params,options)=>{
   assert.equal(claimed,true,'Provider reads must follow signature and claim verification');
   assert.equal(providerId,'in_synthetic');assert.equal(options.timeout,10000);assert.equal(options.maxNetworkRetries,0);assert.deepEqual(Object.keys(params),[]);
   calls.push({kind:'provider'});return retrieve?retrieve():current;
  }}})},
 });
 const route=module('../app/api/stripe/webhook/route.ts',{
  'next/server':{NextResponse:{json:Response.json}},
  '@/src/lib/api':{apiError:(error,fallback)=>{const result=resolveApiError(error,fallback);return Response.json(result.body,{status:result.status});}},
  '@/src/lib/bounded-json-body':{readBoundedRequestBytes},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
  '@/src/lib/dancr/payments':{},'@/src/lib/dancr/finance-provider-events':{...events,recordPaymentProviderWebhook:async()=>{claimed=true;return true;},finishPaymentProviderWebhook:async(...args)=>finished.push(args[3]?'failed':'processed')},
  '@/src/lib/server-env':{getServerEnv:()=>secret},'@/src/lib/security/safe-error-metadata':{safeErrorMetadata},stripe:Stripe,
 });
 async function deliver(snapshot=invoice(),type='invoice.updated'){
  const payload=JSON.stringify({id:'evt_invoice_synthetic',type,created:1700000000,data:{object:snapshot}});
  const signature=Stripe.webhooks.generateTestHeaderString({payload,secret});
  return route.POST(new Request('https://example.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload}));
 }
 return {deliver,calls,finished,events,client};
}

for(const currentStatus of ['paid','void','uncollectible']){
 for(const type of ['invoice.payment_failed','invoice.payment_action_required','invoice.created','invoice.updated']){
  test(type+' stale open snapshot respects current '+currentStatus+' provider state',async()=>{
   const h=harness({current:invoice(currentStatus)}),response=await h.deliver(invoice('open'),type);
   assert.equal(response.status,200);assert.equal((await row()).status,currentStatus);assert.equal((await row()).last_error,null);
   assert.deepEqual(h.finished,['processed']);assert.equal(h.calls.filter(c=>c.kind==='provider').length,1);
  });
 }
}
test('a stale paid snapshot does not apply a payment when the current provider invoice is open',async()=>{
 const h=harness({current:invoice('open')});assert.equal((await h.deliver(invoice('paid'),'invoice.paid')).status,200);
 assert.equal((await row()).status,'open');assert.equal((await row()).amount_paid_cents,0);assert.equal(h.calls.filter(c=>c.kind==='payment').length,0);
});
test('a legitimate current reopening is not blocked by a permanent paid-state guard',async()=>{
 await pg.query("update public.club_invoices set status='paid',amount_paid_cents=1000 where id=$1",[id]);
 const h=harness({current:invoice('open')});assert.equal((await h.deliver(invoice('paid'),'invoice.updated')).status,200);assert.equal((await row()).status,'open');
 // Existing financial accounting remains monotonic; unapplying historical
 // payments/earnings is not introduced by this webhook reconciliation change.
 assert.equal((await row()).amount_paid_cents,1000);
});
for(const type of ['invoice.payment_failed','invoice.payment_action_required']){
 test(type+' still displays a genuine current payment failure',async()=>{
  const h=harness();assert.equal((await h.deliver(invoice(),type)).status,200);assert.equal((await row()).status,'open');assert.match((await row()).last_error,/Payment is still required/);
 });
}
for(const type of ['invoice.payment_failed','invoice.updated']){
 test(type+' cannot overwrite a payment committed during the provider read',async()=>{
  const h=harness({retrieve:async()=>{await pg.query("update public.club_invoices set status='paid',amount_paid_cents=1000,last_error=null,updated_at=now() where id=$1",[id]);return invoice('open');}});
  const response=await h.deliver(invoice(),type);assert.equal(response.status,500);assert.equal((await row()).status,'paid');assert.equal((await row()).last_error,null);assert.deepEqual(h.finished,['failed']);
 });
 test(type+' checks the version atomically even when another writer finishes immediately before UPDATE',async()=>{
  const h=harness({beforeUpdate:()=>pg.query("update public.club_invoices set status='void',last_error='Preserve newer state',updated_at=now() where id=$1",[id])});
  assert.equal((await h.deliver(invoice(),type)).status,500);assert.equal((await row()).status,'void');assert.equal((await row()).last_error,'Preserve newer state');
 });
}
test('a fresh redelivery after a version conflict reconciles the current state',async()=>{
 const stale=harness({beforeUpdate:()=>pg.query("update public.club_invoices set status='paid',amount_paid_cents=1000,updated_at=now() where id=$1",[id])});
 assert.equal((await stale.deliver()).status,500);
 const retry=harness({current:invoice('paid')});assert.equal((await retry.deliver(invoice('open'),'invoice.payment_failed')).status,200);assert.equal((await row()).status,'paid');
});
test('provider timeout retains local state and reports failure without falling back to the snapshot',async()=>{
 const before=await row(),h=harness({retrieve:()=>{throw new Error('Synthetic provider timeout');}});
 const response=await h.deliver();assert.equal(response.status,500);assert.deepEqual(await row(),before);assert.deepEqual(h.finished,['failed']);assert.ok(!(await response.text()).includes('timeout'));
});
test('wrong provider object ID cannot update the local invoice',async()=>{
 const before=await row(),h=harness({current:invoice('paid',{id:'in_other'})});assert.equal((await h.deliver()).status,500);assert.deepEqual(await row(),before);
});
test('a local invoice missing before lookup skips provider work and financial writes',async()=>{
 await pg.exec('truncate public.club_invoices');const h=harness();assert.equal((await h.deliver()).status,200);assert.deepEqual(h.calls.map(c=>c.kind),['read']);
});
test('snapshot metadata still locates an invoice before its provider ID is stored',async()=>{
 await pg.query('update public.club_invoices set stripe_invoice_id=null where id=$1',[id]);const h=harness();assert.equal((await h.deliver()).status,200);assert.equal((await row()).stripe_invoice_id,'in_synthetic');
});
test('invoice lookup still works without metadata when the provider ID is stored',async()=>{
 const h=harness({current:invoice('open',{metadata:{}})});assert.equal((await h.deliver(invoice('open',{metadata:{}}))).status,200);assert.equal((await row()).status,'open');
});
for(const option of ['readError','updateError']){
 test(option+' fails safely without a successful delivery acknowledgment',async()=>{
  const before=await row(),h=harness({[option]:{code:'08006',message:'Synthetic private SQL detail'}}),response=await h.deliver();
  assert.equal(response.status,500);assert.deepEqual(await row(),before);assert.deepEqual(h.finished,['failed']);assert.ok(!(await response.text()).includes('SQL'));
 });
}
test('provider metadata cannot switch the record after the initial version was captured',async()=>{
 await seed({invoiceId:otherId,providerId:'in_other'});const before=await row(otherId);
 const h=harness({current:invoice('open',{metadata:{mydancr_invoice_id:otherId}})});const response=await h.deliver();
 assert.equal(response.status,500);assert.deepEqual(await row(otherId),before);
});
test('the existing payment RPC remains monotonic and does not release unrelated commissions',async()=>{
 await pg.query("update public.club_invoices set amount_paid_cents=800 where id=$1",[id]);
 const h=harness({current:invoice('open',{amount_paid:300})});assert.equal((await h.deliver(invoice('paid'))).status,200);assert.equal((await row()).amount_paid_cents,800);
 assert.equal((await pg.query('select count(*)::int as n from public.agent_commission_events')).rows[0].n,0);
});
