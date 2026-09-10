import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
export const cashierSchema=JSON.parse(readFileSync(new URL('../fixtures/cashier-allocation-schema.json',import.meta.url),'utf8'));
export const cashierTables=cashierSchema.tables;
export const cashierSignature='public.confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb)';
export const cashierMigrationPath='supabase/migrations/20260910165000_snapshot_cashier_agent_allocations.sql';
export const cashierMigration=()=>readFileSync(new URL('../../'+cashierMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const cashierId=n=>'98000000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const parents=['auth.users','app_users','dancer_profiles','shifts','club_invoices','dancer_payout_batches','payout_settings','dancer_earning_status_history','notifications','venue_team_members'];
export async function createCashierDatabase({migrate=true}={}){
 const pg=new PGlite({extensions:{pgcrypto}});
 try{
  await pg.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create schema extensions;create extension pgcrypto with schema extensions;set search_path=public,extensions;
   create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
   create type public.user_role as enum('customer','dancer','venue','admin','agent');
   create table public.app_users(id uuid primary key,role public.user_role,account_state text);
   create table public.dancer_profiles(id uuid primary key,user_id uuid);create table public.shifts(id uuid primary key);
   create table public.club_invoices(id uuid primary key);create table public.dancer_payout_batches(id uuid primary key);
   create table public.payout_settings(id text primary key,earnings_hold_days integer);
   create table public.dancer_earning_status_history(earning_id uuid,from_status text,to_status text,actor_user_id uuid,actor_type text,reason text,metadata jsonb);
   create table public.notifications(recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb,sent_at timestamptz);
   create table public.venue_team_members(user_id uuid,venue_id uuid,status text);
  `);
  // The parent/support tables above are explicit projections, not copies of private records.
  for(const table of cashierTables){
   const columns=cashierSchema.columns.filter(r=>r.table===table).map(r=>{
    const identity=cashierSchema.identities.find(i=>i.table_name===table&&i.column_name===r.name);
    return quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(identity?' generated '+identity.identity_generation.toLowerCase()+' as identity':'')+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:'');
   });
   await pg.exec('create table public.'+quote(table)+'('+columns.join(',')+');alter table public.'+quote(table)+' enable row level security');
  }
  for(const fn of cashierSchema.functions){await pg.exec(fn.definition);assert.equal((await pg.query('select md5(pg_get_functiondef($1::regprocedure)) hash',['public.'+fn.signature])).rows[0].hash,fn.fingerprint);await pg.exec('revoke all on function public.'+fn.signature+' from public,anon,authenticated;grant execute on function public.'+fn.signature+' to service_role');}
  for(const foreign of [false,true])for(const r of cashierSchema.constraints.filter(r=>r.definition.startsWith('FOREIGN KEY')===foreign))await pg.exec('alter table public.'+quote(r.table)+' add constraint '+quote(r.name)+' '+r.definition);
  const names=new Set(cashierSchema.constraints.map(r=>r.name));for(const r of cashierSchema.indexes)if(!names.has(r.name))await pg.exec(r.definition);
  for(const r of cashierSchema.triggers){await pg.exec(r.function_definition);await pg.exec(r.definition);}
  await pg.exec('grant usage on schema public,auth,extensions to anon,authenticated,service_role;grant all on all tables in schema public,auth to service_role;grant all on all sequences in schema public to service_role');
  if(migrate)await pg.exec(cashierMigration());
  return pg;
 }catch(error){await pg.close();throw error;}
}
export async function seedCashierDatabase(pg,{attribution=true,enrolled=false,fee=10000}={}){
 await pg.exec("reset role;set timezone='UTC'");
 for(const table of cashierTables)await pg.exec('drop trigger if exists synthetic_failure on public.'+table);
 await pg.exec('truncate '+[...cashierTables,...parents].join(',')+' restart identity');
 await pg.exec("insert into payout_settings values('default',7)");
 for(const n of [1,2,3,10,11,12,13,14,15,16]){
  await pg.query('insert into auth.users values($1)',[cashierId(n)]);
  await pg.query("insert into app_users values($1,$2,'active')",[cashierId(n),n===1?'venue':n===2?'dancer':n===3?'admin':'agent']);
 }
 await pg.query('insert into dancer_profiles values($1,$1);',[cashierId(2)]);
 await pg.query('insert into shifts values($1)',[cashierId(2)]);
 await pg.query("insert into venues(id,owner_user_id,name,slug,city,is_active,timezone) values($1,$1,'Synthetic venue','synthetic-venue','Las Vegas',true,'America/Los_Angeles')",[cashierId(1)]);
 // Keep the real venue trigger's default inactive offer; add a valid active admission offer.
 await pg.query("insert into club_deals(id,venue_id,deal_title,offer_type,is_active) values($1,$1,'Free admission','admission',true)",[cashierId(1)]);
 await pg.query("insert into nfc_tags(id,venue_id,tag_type,label,token_digest) values($1,$1,'cashier','Synthetic cashier',repeat('a',64))",[cashierId(1)]);
 await pg.query("insert into venue_referral_fee_terms(id,venue_id,fee_cents,effective_from,agreement_reference) values($1,$1,$2,'2020-01-01','Synthetic agreement')",[cashierId(1),fee]);
 for(const n of [10,11,12,13,14,15,16])await pg.query("insert into sales_agents(id,user_id,created_by_admin_user_id,updated_by_admin_user_id,commission_depth_limit) values($1,$1,$2,$2,$3)",[cashierId(n),cashierId(3),n===14?5:3]);
 if(attribution)await pg.query(`insert into venue_sales_attributions(id,venue_id,signing_agent_id,sponsor_level_1_agent_id,sponsor_level_2_agent_id,sponsor_level_3_agent_id,sponsor_level_4_agent_id,sponsor_level_5_agent_id,agreement_reference,created_by_admin_user_id,effective_from)
 values($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic agreement',$9,'2020-01-01')`,[cashierId(20),cashierId(1),...Array.from({length:6},(_,i)=>cashierId(10+i)),cashierId(3)]);
 if(enrolled)await pg.query("insert into nats_affiliate_accounts(dancer_id,login_id,status,verified_by) values($1,100,'active',$2)",[cashierId(2),cashierId(3)]);
 await pg.exec('set role service_role');
}
export async function issueCashier(pg,{number=30,source='club_page',tag=1,venue=1,customer=null}={}){
 return (await pg.query('select public.issue_and_confirm_deal_redemption_from_nfc($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval \'1 hour\',$10) receipt',[
  'synthetic_cashier_'+String(number).padStart(30,'0'),cashierId(tag),cashierId(number),cashierId(venue),cashierId(1),source,source==='dancer_profile'?cashierId(2):null,source==='dancer_profile'?cashierId(2):null,customer===null?null:cashierId(customer),{synthetic:true}
 ])).rows[0].receipt;
}
export async function cashierSnapshot(pg){const out={};for(const table of [...cashierTables,'dancer_earning_status_history','notifications'])out[table]=(await pg.query('select to_jsonb(t) row from public.'+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.row);return out;}
