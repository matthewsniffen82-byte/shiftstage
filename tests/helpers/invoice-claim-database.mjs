import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const invoiceSchema=JSON.parse(readFileSync(new URL('../fixtures/invoice-claim-schema.json',import.meta.url),'utf8'));
export const invoiceMigrationPath='supabase/migrations/20260910102400_claim_invoice_revenue_atomically.sql';
export const invoiceMigration=readFileSync(new URL('../../'+invoiceMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const invoiceSignature='public.create_club_invoice_draft(uuid,date,date,timestamptz,uuid[])';
export const invoiceTables=['club_invoices','club_invoice_items','deal_revenue_events'];
export const invoiceId=n=>'98000000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createInvoiceClaimDatabase({migrate=true}={}){
 const db=new PGlite();
 try{
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
   create table public.venues(id uuid primary key);create table public.club_deals(id uuid primary key);
   create table public.qr_redemptions(id uuid primary key);create table public.dancer_profiles(id uuid primary key);
   create table public.venue_sales_attributions(id uuid primary key);
   create table public.agent_commission_events(id uuid primary key,deal_revenue_event_id uuid,status text,voided_at timestamptz,audit jsonb,venue_payment_received_at timestamptz,payable_at timestamptz);
  `);
  // Only referenced identities and agent records above are synthetic projections.
  // All target columns, constraints, indexes, triggers and function bodies are captured.
  for(const table of invoiceTables){
   const columns=invoiceSchema.columns.filter(r=>r.table===table).map(r=>quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:''));
   await db.exec('create table public.'+quote(table)+'('+columns.join(',')+');alter table public.'+quote(table)+' enable row level security');
  }
  for(const foreign of [false,true])for(const r of invoiceSchema.constraints.filter(r=>r.definition.startsWith('FOREIGN KEY')===foreign))await db.exec('alter table public.'+quote(r.table)+' add constraint '+quote(r.name)+' '+r.definition);
  const constraintNames=new Set(invoiceSchema.constraints.map(r=>r.name));
  for(const r of invoiceSchema.indexes)if(!constraintNames.has(r.name))await db.exec(r.definition);
  for(const r of invoiceSchema.triggers){await db.exec(r.function_definition);await db.exec(r.definition);}
  for(const fn of invoiceSchema.functions){
   await db.exec(fn.definition);
   assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',['public.'+fn.signature])).rows[0].hash,fn.fingerprint);
   await db.exec('revoke all on function public.'+fn.signature+' from public,anon,authenticated;grant execute on function public.'+fn.signature+' to service_role');
  }
  await db.exec('grant usage on schema public,auth to anon,authenticated,service_role;grant all on all tables in schema public to service_role;grant all on auth.users to service_role');
  if(migrate)await db.exec(invoiceMigration);
  return db;
 }catch(error){await db.close();throw error;}
}
export async function seedInvoiceClaimDatabase(db){
 await db.exec("reset role;set timezone='UTC'");
 for(const table of invoiceTables)await db.exec('drop trigger if exists synthetic_failure on public.'+table);
 await db.exec('truncate '+invoiceTables.join(',')+',venues,club_deals,qr_redemptions,dancer_profiles,venue_sales_attributions,agent_commission_events');
 for(const table of ['venues','club_deals','qr_redemptions','dancer_profiles','venue_sales_attributions'])await db.query('insert into public.'+table+'(id) values($1),($2),($3)',[invoiceId(1),invoiceId(2),invoiceId(3)]);
 for(const n of [1,2,3])await db.query("insert into public.deal_revenue_events(id,qr_redemption_id,venue_id,club_deal_id,source_type,commission_month,gross_commission_cents,platform_commission_cents) values($1,$2,$3,$3,'club_page','2026-08-01',500,500)",[invoiceId(10+n),invoiceId(n),invoiceId(1)]);
 await db.query("insert into public.agent_commission_events values($1,$2,'pending_venue_payment',null,'{\"synthetic\":true}',null,null)",[invoiceId(30),invoiceId(11)]);
 await db.exec('set role service_role');
}
export async function claimInvoice(db,{venue=invoiceId(1),ids=[invoiceId(11),invoiceId(12)],start='2026-08-01',end='2026-08-31',due='2026-09-15T00:00:00Z'}={}){
 return (await db.query('select public.create_club_invoice_draft($1,$2,$3,$4,$5) receipt',[venue,start,end,due,ids])).rows[0].receipt;
}
export async function invoiceSnapshot(db){
 const out={};for(const table of [...invoiceTables,'agent_commission_events'])out[table]=(await db.query('select to_jsonb(t) row from public.'+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.row);return out;
}
