import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {invoiceId,venueId} from './invoice-reminder-fixture.mjs';
const columns=new Set(JSON.parse(readFileSync(new URL('../fixtures/invoice-reminder-schema.json',import.meta.url),'utf8')).columns.filter(c=>c.table==='club_invoices').map(c=>c.name));
const quote=name=>{assert.ok(columns.has(name),name);return '"'+name+'"';};
export const expectedLine=()=>({id:'il_synthetic',amount:1000,currency:'usd',metadata:{mydancr_invoice_id:invoiceId}});
export function publicationProvider({lines=[],status='draft',metadata={mydancr_invoice_id:invoiceId},customer='cus_synthetic'}={}){
 return {id:'in_synthetic',customer,metadata,status,collection_method:'send_invoice',lines:structuredClone(lines)};
}
function load(path,dependencies){
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,Date,Error,console:{error(){},warn(){}},require:name=>{assert.ok(name in dependencies,name);return dependencies[name];}
 });
 return exports;
}
export function publicationHarness(db,{provider=publicationProvider(),...options}={}){
 const calls=[],logs=[];
 const client={from(table){
  if(table==='club_finance_accounts'){
   const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{venue_id:venueId,stripe_customer_id:'cus_synthetic',collection_method:'send_invoice',payment_terms_days:15},error:null})};
   return q;
  }
  assert.equal(table,'club_invoices');
  let patch=null,selection=null,single=false;const values=[],filters=[];
  const bind=v=>{values.push(v);return '$'+values.length;};
  const q={
   select(value){selection=value;return q;},update(value){patch=value;return q;},
   eq(key,value){filters.push(quote(key)+'='+bind(value));return q;},
   in(key,list){filters.push(quote(key)+' in('+list.map(bind).join(',')+')');return q;},
   or(input){filters.push('('+input.split(',').map(x=>{
    const m=x.match(/^stripe_invoice_id\.(is|eq)\.(.+)$/);assert.ok(m);
    return m[1]==='is'?'stripe_invoice_id is null':'stripe_invoice_id='+bind(m[2]);
   }).join(' or ')+')');return q;},
   order(){return q;},limit(){return q;},
   maybeSingle(){single=true;return execute();},
   then(resolve,reject){return execute().then(resolve,reject);}
  };
  async function execute(){
   const kind=patch?(patch.stripe_invoice_id?'reference':'failure'):'read';
   calls.push({kind,selection,patch});
   if(kind==='reference')await options.beforeReference?.();
   if(kind==='failure')await options.beforeFailure?.();
   if(options[kind+'Error'])return {data:null,error:options[kind+'Error']};
   if(options[kind+'Zero'])return {data:null,error:null};
   const where=filters.length?' where '+filters.join(' and '):'';
   const sql=patch?'update club_invoices set '+Object.entries(patch).map(([k,v])=>quote(k)+'='+bind(v)).join(',')+where+' returning *':'select * from club_invoices'+where;
   try{
    const {rows}=await db.query(sql,values);
    if(kind==='reference'&&options.afterReferenceCommitError)return {data:null,error:options.afterReferenceCommitError};
    const mapped=rows.map(row=>({...row,venues:{name:'Synthetic venue',owner_user_id:'synthetic-owner'}}));
    return {data:single?mapped[0]||null:patch&&!selection?null:mapped,error:null};
   }catch(error){return {data:null,error};}
  }
  return q;
 }};
 const snapshot=()=>structuredClone({...provider,lines:{data:provider.lines,has_more:false}});
 const stripe={invoices:{
  create:async(params,options)=>{calls.push({kind:'createInvoice',params,options});assert.equal(options.idempotencyKey,'mydancr-club-invoice-'+invoiceId);return snapshot();},
  retrieve:async()=>{calls.push({kind:'retrieve'});if(options.retrieveError)throw options.retrieveError;return snapshot();},
  listLineItems:async(id,params,request)=>{assert.equal(id,provider.id);assert.equal(params.limit,100);assert.equal(request.timeout,10000);assert.equal(request.maxNetworkRetries,0);calls.push({kind:'lines'});if(options.linesError)throw options.linesError;return options.lineResponse!==undefined?options.lineResponse:{data:structuredClone(provider.lines),has_more:false};},
  finalizeInvoice:async()=>{calls.push({kind:'finalize'});provider.status='open';return snapshot();},
  sendInvoice:async()=>{calls.push({kind:'send'});return snapshot();}
 },invoiceItems:{create:async(params,key)=>{
  calls.push({kind:'createItem',params,key});assert.equal(key.idempotencyKey,'mydancr-club-invoice-item-'+invoiceId);
  if(options.itemError)throw options.itemError;
  provider.lines.push(expectedLine());
  if(options.afterItemCommitError)throw options.afterItemCommitError;
  return {id:'ii_synthetic',...params};
 }}};
 const exports=load('src/lib/dancr/finance-invoices.ts',{
  '../stripe':{getStripe:()=>stripe},
  '../security/safe-error-metadata':{safeErrorMetadata:error=>({code:error?.code||'unknown'})},
  './finance-provider-events':{syncStripeInvoice:async(_client,invoice)=>{
   calls.push({kind:'sync'});if(options.syncError)throw options.syncError;if(options.syncNull)return null;
   return (await db.query('update club_invoices set status=$1 where id=$2 returning *',[invoice.status,invoiceId])).rows[0];
  }}
 });
 return {run:()=>exports.publishClubInvoiceDrafts(client),calls,provider,logs};
}
export function publicationAutomation(publication){
 const exports=load('src/lib/dancr/finance-automation.ts',{
  './finance-invoices':{createMonthlyClubInvoiceDrafts:async()=>0,publishClubInvoiceDrafts:async()=>publication,reconcileOpenClubInvoices:async()=>0,sendClubInvoiceReminders:async()=>0},
  './finance-payout-processing':{},'./nats-commission-sync':{},'./nats':{}
 });
 return exports.runClubInvoiceAutomation({});
}
