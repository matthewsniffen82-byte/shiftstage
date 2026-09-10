import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const schema=JSON.parse(readFileSync(new URL('../fixtures/invoice-reminder-schema.json',import.meta.url),'utf8'));
const quote=x=>'"'+x.replaceAll('"','""')+'"';
export const invoiceId='80000000-0000-4000-8000-000000000001';
export const venueId='80000000-0000-4000-8000-000000000002';
export const now=new Date('2026-09-10T12:00:00.000Z');

export async function reminderDatabase(){
 const db=new PGlite();
 await db.exec('create table public.venues(id uuid primary key)');
 for(const table of ['club_invoices','club_invoice_reminders']){
  const columns=schema.columns.filter(c=>c.table===table);
  await db.exec('create table public.'+quote(table)+'('+columns.map(c=>quote(c.name)+' '+quote(c.schema)+'.'+quote(c.type)+(c.default?' default '+c.default:'')+(c.nullable==='NO'?' not null':'')).join(',')+')');
 }
 for(const foreign of [false,true])for(const c of schema.constraints.filter(c=>c.definition.startsWith('FOREIGN KEY')===foreign)){
  await db.exec('alter table public.'+quote(c.table)+' add constraint '+quote(c.name)+' '+c.definition);
 }
 return db;
}
export async function resetReminders(db,{status='open',due='2026-09-08T12:00:00Z'}={}){
 await db.exec('truncate public.venues cascade');
 await db.query('insert into venues(id) values($1)',[venueId]);
 await db.query('insert into club_invoices(id,venue_id,period_start,period_end,due_at,status,amount_due_cents,stripe_invoice_id) values($1,$2,$3,$4,$5,$6,$7,$8)',[invoiceId,venueId,'2026-08-01','2026-08-31',due,status,1000,'in_synthetic']);
}
export const invoiceRow=async db=>(await db.query('select * from club_invoices where id=$1',[invoiceId])).rows[0];
export const reminderCount=async db=>(await db.query('select count(*)::int as n from club_invoice_reminders')).rows[0].n;

export function reminderHarness(db,options={}){
 const calls=[],exports={};
 const client={from(table){
  assert.ok(['club_invoices','club_invoice_reminders'].includes(table));
  const allowed=new Set(schema.columns.filter(c=>c.table===table).map(c=>c.name));
  let mutation=null,payload=null,selected=null,single=false,limit=null;
  const filters=[],values=[],bind=value=>{values.push(value&&typeof value==='object'&&!(value instanceof Date)?JSON.stringify(value):value);return '$'+values.length;};
  const column=key=>{assert.ok(allowed.has(key),key);return quote(key);};
  const q={
   select(value){selected=value;return q;},
   update(value){mutation='update';payload=value;return q;},
   insert(value){mutation='insert';payload=value;return q;},
   eq(key,value){filters.push(column(key)+'='+bind(value));return q;},
   in(key,list){filters.push(column(key)+' in('+list.map(bind).join(',')+')');return q;},
   not(key,op,value){assert.equal(op,'is');assert.equal(value,null);filters.push(column(key)+' is not null');return q;},
   order(){return q;},limit(value){limit=value;return q;},
   maybeSingle(){single=true;return execute();},
   then(resolve,reject){return execute().then(resolve,reject);}
  };
  async function execute(){
   const kind=mutation==='insert'?'ledger':mutation==='update'?(payload.status?'overdue':'summary'):table==='club_invoices'?'list':'lookup';
   calls.push(kind);
   if(kind==='overdue')await options.beforeOverdue?.();
   if(options[kind+'Error'])return {data:null,error:options[kind+'Error']};
   if(options[kind+'Zero'])return {data:null,error:null};
   const projection=selected&&selected!=='*'?selected.split(',').map(s=>column(s.trim())).join(','):'*';
   let sql;
   if(mutation==='update')sql='update '+quote(table)+' set '+Object.entries(payload).map(([key,value])=>column(key)+'='+bind(value)).join(',')+' where '+filters.join(' and ')+' returning '+projection;
   else if(mutation==='insert')sql='insert into '+quote(table)+'('+Object.keys(payload).map(column).join(',')+') values('+Object.values(payload).map(bind).join(',')+') returning *';
   else sql='select '+projection+' from '+quote(table)+(filters.length?' where '+filters.join(' and '):'')+(limit?' limit '+limit:'');
   try{
    const {rows}=await db.query(sql,values);
    if(kind==='summary'&&options.afterSummaryCommitError)return {data:null,error:options.afterSummaryCommitError};
    if(single&&rows.length>1)return {data:null,error:{code:'PGRST116'}};
    return {data:single?rows[0]||null:mutation&&!selected?null:rows,error:null};
   }catch(error){return {data:null,error};}
  }
  return q;
 }};
 const stripe={invoices:{
  retrieve:async()=>{calls.push('retrieve');if(options.retrieveError)throw options.retrieveError;return {id:'in_synthetic',collection_method:options.collectionMethod||'send_invoice'};},
  sendInvoice:async()=>{calls.push('send');if(options.sendError)throw options.sendError;return {id:'in_synthetic'};}
 }};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/lib/dancr/finance-invoices.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,{exports,Date,Error,console,require:name=>{
  if(name==='../stripe')return {getStripe:()=>stripe};
  if(name==='./finance-provider-events')return {};
  throw new Error('Unexpected module '+name);
 }});
 return {calls,run:()=>exports.sendClubInvoiceReminders(client,now)};
}
