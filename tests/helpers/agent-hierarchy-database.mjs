import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
import{PGlite}from'@electric-sql/pglite';
import{pgcrypto}from'@electric-sql/pglite/contrib/pgcrypto';
export const agentSchema=JSON.parse(readFileSync(new URL('../fixtures/agent-hierarchy-schema.json',import.meta.url),'utf8'));
export const agentMigrationPath='supabase/migrations/20260912063000_serialize_sales_agent_hierarchy.sql';
export const agentMigration=readFileSync(new URL('../../supabase/migrations/20260912063000_serialize_sales_agent_hierarchy.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
export const agentId=n=>'a1510000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createAgentDatabase({migrate=true}={}){
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  // Complete target tables and affected functions. Account, venue and request
  // controls below are explicit synthetic projections; unrelated approval
  // triggers are not installed in this focused native fixture.
  await db.exec(`create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
   create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.app_users(id uuid primary key,role text not null,account_state text not null,display_name text,email text);
   create table public.venues(id uuid primary key,is_active boolean not null);
   create table public.venue_signup_requests(id uuid primary key,status text not null,referring_agent_id uuid,matched_venue_id uuid,reviewed_by uuid,reviewed_at timestamptz);
   create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth,extensions to anon,authenticated,service_role;
   grant all on public.app_users,public.venues,public.venue_signup_requests to service_role;
   set search_path=pg_catalog,public,pg_temp;`);
  for(const table of agentSchema.relations){
   const columns=agentSchema.columns.filter(c=>c.table_name===table.name);
   await db.exec('create table public.'+quote(table.name)+'('+columns.map(c=>quote(c.column_name)+' '+quote(c.udt_schema)+'.'+quote(c.udt_name)+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':'')).join(',')+')');
   if(table.rls)await db.exec('alter table public.'+quote(table.name)+' enable row level security');
   for(const[role,rights]of Object.entries(table.grants)){const names=Object.entries(rights).filter(([,allow])=>allow).map(([right])=>right);if(names.length)await db.exec('grant '+names.join(',')+' on public.'+quote(table.name)+' to '+role);}
  }
  for(const foreign of[false,true])for(const c of agentSchema.constraints.filter(c=>c.definition.startsWith('FOREIGN KEY')===foreign))await db.exec('alter table public.'+quote(c.table_name)+' add constraint '+quote(c.name)+' '+c.definition);
  const constraintNames=new Set(agentSchema.constraints.map(c=>c.name));for(const i of agentSchema.indexes)if(!constraintNames.has(i.indexname))await db.exec(i.indexdef);
  for(const f of agentSchema.functions){await db.exec(f.definition+';');assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',['public.'+f.signature])).rows[0].hash,f.fingerprint,f.name);if(f.acl===null)continue;await db.exec('revoke all on function public.'+f.signature+' from public,anon,authenticated,service_role');for(const[role,key]of[['anon','anon'],['authenticated','authenticated'],['service_role','service']])if(f[key])await db.exec('grant execute on function public.'+f.signature+' to '+role);}
  for(const p of agentSchema.policies)await db.exec('create policy '+quote(p.policyname)+' on public.'+quote(p.tablename)+' as '+p.permissive+' for '+p.cmd+' to '+p.roles.map(quote).join(',')+(p.qual?' using('+p.qual+')':'')+(p.with_check?' with check('+p.with_check+')':''));
  for(const t of agentSchema.triggers)await db.exec(t.definition);
  if(migrate)await db.exec(agentMigration);
  return db;
 }catch(error){await db.close();throw error;}
}
export async function seedAgents(db){
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);truncate public.venue_sales_attributions,public.sales_agents,public.admin_actions,public.venue_signup_requests,public.venues,public.app_users");
 await db.query("insert into public.app_users values($1,'admin','active','Synthetic admin',null),($2,'customer','active',null,null),($3,'admin','suspended',null,null)",[agentId(1),agentId(2),agentId(3)]);
 for(let i=10;i<30;i++)await db.query("insert into public.app_users values($1,'agent','active','Synthetic agent',null)",[agentId(i)]);
 await db.query('insert into public.venues values($1,true),($2,true),($3,false)',[agentId(100),agentId(101),agentId(102)]);await db.exec('set role service_role');
}
export async function insertAgent(db,{id=10,sponsor=null,status='active',depth=3}={}){return(await db.query('insert into public.sales_agents(id,user_id,sponsor_agent_id,status,commission_depth_limit,created_by_admin_user_id,updated_by_admin_user_id)values($1,$1,$2,$3,$4,$5,$5)returning *',[agentId(id),sponsor===null?null:agentId(sponsor),status,depth,agentId(1)])).rows[0];}
export async function insertAgentChain(db,{length=6}={}){for(let i=length-1;i>=0;i--)await insertAgent(db,{id:10+i,sponsor:i===length-1?null:11+i});}
export async function assignAgent(db,{actor=agentId(1),venue=agentId(100),signer=agentId(10),reference='Synthetic agreement',effective='2026-01-01T00:00:00Z'}={}){return(await db.query('select public.assign_admin_venue_sales_agent($1,$2,$3,$4,$5) id',[actor,venue,signer,reference,effective])).rows[0].id;}
export async function agentSnapshot(db){return(await db.query("select jsonb_build_object('agents',(select coalesce(jsonb_agg(to_jsonb(a)order by id),'[]')from public.sales_agents a),'attributions',(select coalesce(jsonb_agg(to_jsonb(a)order by id),'[]')from public.venue_sales_attributions a),'audit',(select coalesce(jsonb_agg(to_jsonb(a)order by id),'[]')from public.admin_actions a),'requests',(select coalesce(jsonb_agg(to_jsonb(a)order by id),'[]')from public.venue_signup_requests a)) snapshot")).rows[0].snapshot;}
export async function graphLocks(db){return(await db.query("select classid::text,objid::text,objsubid,mode,granted from pg_locks where locktype='advisory' and pid=pg_backend_pid()order by classid,objid,objsubid")).rows;}
