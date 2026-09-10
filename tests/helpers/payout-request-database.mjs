import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const payoutSchema=JSON.parse(readFileSync(new URL('../fixtures/payout-request-schema.json',import.meta.url),'utf8'));
export const payoutMigrationPath='supabase/migrations/20260910153000_scope_payout_retry_to_dancer.sql';
export const payoutMigration=readFileSync(new URL('../../'+payoutMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const payoutSignature='public.request_dancer_payout(uuid,text,text,boolean)';
export const payoutTables=['commission_events','dancer_payout_batches','financial_audit_events','dancer_payout_accounts','dancer_payout_items','payout_settings'];
export const payoutId=n=>'99000000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createPayoutRequestDatabase({migrate=true}={}){
 const pg=new PGlite();
 try{
  await pg.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
   create table public.dancer_profiles(id uuid primary key,user_id uuid);create table public.venues(id uuid primary key);
   create table public.club_deals(id uuid primary key);create table public.qr_redemptions(id uuid primary key);
   create table public.app_users(id uuid primary key,role text,account_state text);
   create table public.deal_revenue_events(qr_redemption_id uuid,dancer_id uuid,dancer_commission_eligible boolean,dancer_nats_activated_at timestamptz,confirmed_at timestamptz,dancer_commission_cents integer,status text);
   create table public.dancer_earning_status_history(earning_id uuid,from_status text,to_status text,actor_user_id uuid,actor_type text,reason text,metadata jsonb);
   create table public.nats_affiliate_accounts(dancer_id uuid,status text);
   create table public.nats_commission_exports(commission_event_id uuid unique,dancer_id uuid,amount_cents integer,currency text,status text,last_error text,failed_at timestamptz,updated_at timestamptz);
  `);
  // Referenced identities, history and NATS tables above are explicit synthetic projections.
  // The six target tables below retain all freshly inspected columns, constraints, indexes and triggers.
  for(const table of payoutTables){
   const columns=payoutSchema.columns.filter(r=>r.table===table).map(r=>{
    const identity=payoutSchema.identities.find(i=>i.table_name===table&&i.column_name===r.name);
    return quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(identity?' generated '+identity.identity_generation.toLowerCase()+' as identity':'')+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:'');
   });
   await pg.exec('create table public.'+quote(table)+'('+columns.join(',')+');alter table public.'+quote(table)+' enable row level security');
  }
  for(const foreign of [false,true])for(const r of payoutSchema.constraints.filter(r=>r.definition.startsWith('FOREIGN KEY')===foreign))await pg.exec('alter table public.'+quote(r.table)+' add constraint '+quote(r.name)+' '+r.definition);
  const names=new Set(payoutSchema.constraints.map(r=>r.name));for(const r of payoutSchema.indexes)if(!names.has(r.name))await pg.exec(r.definition);
  for(const r of payoutSchema.triggers){await pg.exec(r.function_definition);await pg.exec(r.definition);}
  for(const fn of payoutSchema.functions){await pg.exec(fn.definition);assert.equal((await pg.query('select md5(pg_get_functiondef($1::regprocedure)) hash',['public.'+fn.signature])).rows[0].hash,fn.fingerprint);await pg.exec('revoke all on function public.'+fn.signature+' from public,anon,authenticated;grant execute on function public.'+fn.signature+' to service_role');}
  await pg.exec('grant usage on schema public,auth to anon,authenticated,service_role;grant all on all tables in schema public to service_role;grant all on all sequences in schema public to service_role;grant all on auth.users to service_role');
  if(migrate)await pg.exec(payoutMigration);
  return pg;
 }catch(error){await pg.close();throw error;}
}
export async function seedPayoutRequestDatabase(pg){
 await pg.exec("reset role;set timezone='UTC'");
 for(const table of payoutTables)await pg.exec('drop trigger if exists synthetic_failure on public.'+table);
 await pg.exec('truncate '+payoutTables.join(',')+',auth.users,dancer_profiles,venues,club_deals,qr_redemptions,app_users,deal_revenue_events,dancer_earning_status_history,nats_affiliate_accounts,nats_commission_exports restart identity');
 await pg.exec("insert into public.payout_settings(id,payouts_enabled) values('default',true)");
 for(const n of [1,2]){
  for(const table of ['auth.users','venues','club_deals','qr_redemptions'])await pg.query('insert into '+table+'(id) values($1)',[payoutId(n)]);
  await pg.query('insert into dancer_profiles(id,user_id) values($1,$1)',[payoutId(n)]);
  await pg.query("insert into deal_revenue_events values($1,$1,true,'2020-01-01','2020-01-02',5000,'settled')",[payoutId(n)]);
  await pg.query("insert into dancer_payout_accounts(dancer_id,onboarding_status,payout_eligibility,verification_status) values($1,'complete','eligible','verified')",[payoutId(n)]);
  await pg.query("insert into commission_events(id,qr_redemption_id,venue_id,club_deal_id,dancer_id,status,amount_cents) values($1,$2,$2,$2,$2,'available',5000)",[payoutId(n+20),payoutId(n)]);
 }
 await pg.exec('set role service_role');
}
export async function requestPayout(pg,{user=1,key='synthetic-payout-request',provider='stripe',isTest=false}={}){
 return (await pg.query('select public.request_dancer_payout($1,$2,$3,$4) receipt',[user===null?null:payoutId(user),key,provider,isTest])).rows[0].receipt;
}
export async function payoutRequestSnapshot(pg){const out={};for(const table of [...payoutTables,'dancer_earning_status_history','nats_commission_exports'])out[table]=(await pg.query('select to_jsonb(t) row from public.'+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.row);return out;}
