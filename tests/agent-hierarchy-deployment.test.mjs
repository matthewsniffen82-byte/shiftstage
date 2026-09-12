import test from'node:test';import assert from'node:assert/strict';
import{createAgentDatabase,seedAgents,insertAgentChain,agentSnapshot,agentMigration}from'./helpers/agent-hierarchy-database.mjs';
import{buildAgentDeployment,agentVersion,agentLockSignature,agentReplaced}from'./helpers/agent-hierarchy-deployment.mjs';
const tables=['public.sales_agents','public.venue_sales_attributions','public.admin_actions','public.venue_signup_requests','public.venues','public.app_users'];
test('agent hierarchy deployment rejects drift and preserves exact source, access and records',async t=>{
 const db=await createAgentDatabase({migrate:false});t.after(()=>db.close());
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');await seedAgents(db);await insertAgentChain(db);await db.exec('reset role');
 await db.exec(agentMigration.replace(/commit;\s*$/,''));const fingerprints={};for(const signature of[agentLockSignature,...agentReplaced.map(f=>'public.'+f.signature)])fingerprints[signature]=(await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',[signature])).rows[0].hash;await db.exec('rollback');
 const deployment=extra=>buildAgentDeployment({source:agentMigration,fingerprints,tables,...extra});const sql=deployment();
 const absent=async()=>{assert.equal((await db.query('select to_regprocedure($1)f',[agentLockSignature])).rows[0].f,null);assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,0);};
 for(const[name,change,message]of[
  ['existing lock function',`create function ${agentLockSignature}returns trigger language plpgsql as $$begin return null;end$$`,'AGENT_GRAPH_UNEXPECTED_FUNCTION'],
  ['disabled RLS','alter table public.sales_agents disable row level security','AGENT_GRAPH_SCHEMA_ACCESS_DRIFT'],
  ['changed browser grant','grant insert on public.sales_agents to anon','AGENT_GRAPH_SCHEMA_ACCESS_DRIFT'],
  ['removed admin policy','drop policy "Admins manage sales agents"on public.sales_agents','AGENT_GRAPH_SCHEMA_ACCESS_DRIFT'],
  ['removed founder uniqueness','drop index public.sales_agents_single_active_founder_idx','AGENT_GRAPH_SCHEMA_ACCESS_DRIFT'],
  ['removed active attribution uniqueness','drop index public.venue_sales_attributions_one_active_idx','AGENT_GRAPH_SCHEMA_ACCESS_DRIFT'],
  ['removed depth constraint','alter table public.sales_agents drop constraint sales_agents_commission_depth_limit_check','AGENT_GRAPH_SCHEMA_ACCESS_DRIFT'],
  ['nullable referral code','alter table public.sales_agents alter column referral_code drop not null','AGENT_GRAPH_SCHEMA_ACCESS_DRIFT'],
  ['changed setter ACL','grant execute on function public.set_admin_sales_agent(uuid,uuid,uuid,smallint,text)to authenticated','AGENT_GRAPH_DEPENDENCY_DRIFT'],
  ['changed assignment body','alter function public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamptz)stable','AGENT_GRAPH_DEPENDENCY_DRIFT'],
  ['changed approval body','alter function public.attribute_approved_venue_agent_referral()stable','AGENT_GRAPH_DEPENDENCY_DRIFT'],
  ['changed admin ACL','revoke execute on function public.is_admin()from public','AGENT_GRAPH_DEPENDENCY_DRIFT'],
  ['disabled approval attachment','alter table public.venue_signup_requests disable trigger venue_signup_requests_attribute_agent','AGENT_GRAPH_APPROVAL_ATTACHMENT_DRIFT'],
 ])await t.test(name+' prevents application',async()=>{await db.exec('begin;'+change);try{await assert.rejects(db.exec(sql.replace(/^begin;/,'')),new RegExp(message));}finally{await db.exec('rollback');}await absent();});
 for(const[name,change,message]of[
  ['agent row change',"update public.sales_agents set referral_code=repeat('f',36)where id=(select id from public.sales_agents order by id limit 1)",'AGENT_GRAPH_RECORDS_CHANGED'],
  ['audit insertion',"insert into public.admin_actions(target_type,action)values('synthetic','injected')",'AGENT_GRAPH_RECORDS_CHANGED'],
  ['venue mutation','update public.venues set is_active=false','AGENT_GRAPH_RECORDS_CHANGED'],
  ['approval request insertion',"insert into public.venue_signup_requests(id,status)values(gen_random_uuid(),'pending')",'AGENT_GRAPH_RECORDS_CHANGED'],
  ['lock function ACL',`grant execute on function ${agentLockSignature}to authenticated`,'AGENT_GRAPH_LOCK_FUNCTION_MISMATCH'],
  ['assignment function ACL','grant execute on function public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamptz)to authenticated','AGENT_GRAPH_CALLER_MISMATCH'],
  ['approval function ACL','grant execute on function public.attribute_approved_venue_agent_referral()to service_role','AGENT_GRAPH_CALLER_MISMATCH'],
  ['assignment function body','alter function public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamptz)stable','AGENT_GRAPH_CALLER_MISMATCH'],
  ['other setter function ACL','grant execute on function public.set_admin_sales_agent(uuid,uuid,uuid,smallint,text)to anon','AGENT_GRAPH_METADATA_CHANGED'],
  ['column grant','grant update(sponsor_agent_id)on public.sales_agents to anon','AGENT_GRAPH_METADATA_CHANGED'],
  ['policy removal','drop policy "Admins manage sales agents"on public.sales_agents','AGENT_GRAPH_METADATA_CHANGED'],
  ['disabled graph attachment','alter table public.sales_agents disable trigger lock_sales_agent_hierarchy_writes','AGENT_GRAPH_ATTACHMENT_MISMATCH'],
  ['disabled original validator','alter table public.sales_agents disable trigger validate_sales_agent_hierarchy_trigger','AGENT_GRAPH_METADATA_CHANGED'],
  ['unexpected ledger row',"insert into supabase_migrations.schema_migrations(version,name)values('synthetic','injected')",'AGENT_GRAPH_METADATA_CHANGED'],
 ])await t.test(name+' rolls the entire release back',async()=>{const before=await agentSnapshot(db);try{await assert.rejects(db.exec(deployment({after:change+';'})),new RegExp(message));}finally{await db.exec('rollback');}await absent();assert.deepEqual(await agentSnapshot(db),before);});
 await t.test('exact source adds one graph lock and replaces only the two callers',async()=>{const before=await agentSnapshot(db);const result=await db.exec(sql);assert.deepEqual(await agentSnapshot(db),before);assert.equal((await db.query('select version from supabase_migrations.schema_migrations')).rows[0].version,agentVersion);const release=result.flatMap(r=>r.rows).find(r=>r.release).release;assert.equal(release.records_preserved,true);assert.deepEqual(release.function_fingerprints,fingerprints);});
 await t.test('repeated application is rejected without modifying installed state',async()=>{const before=await agentSnapshot(db);try{await assert.rejects(db.exec(sql),/AGENT_GRAPH_ALREADY_APPLIED/);}finally{await db.exec('rollback');}assert.deepEqual(await agentSnapshot(db),before);});
});
