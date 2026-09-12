import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createAgentDatabase,seedAgents,insertAgentChain,assignAgent,agentSnapshot} from './helpers/agent-hierarchy-database.mjs';
import {buildAttributionTimeDeployment,attributionTimeCheckSql,attributionTimeMetadataSql,attributionTimeVersion} from './helpers/attribution-time-deployment.mjs';
const source=readFileSync(new URL('../supabase/migrations/20260912084000_require_finite_attribution_times.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const tables=['public.sales_agents','public.venue_sales_attributions','public.admin_actions','public.venue_signup_requests','public.venues','public.app_users'];
test('finite attribution deployment rejects drift and preserves every function and record',async t=>{
  const db=await createAgentDatabase();t.after(()=>db.close());
  await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  await seedAgents(db);await insertAgentChain(db);await assignAgent(db);await db.exec('reset role');
  await db.exec(source.replace(/commit;\s*$/,''));const check=Object.values((await db.query(attributionTimeCheckSql)).rows[0])[0];await db.exec('rollback');
  const deploy=extra=>buildAttributionTimeDeployment({source,check,tables,...extra});const sql=deploy();
  const absent=async()=>assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,0);
  for(const[name,change,message]of[
    ['disabled RLS','alter table public.venue_sales_attributions disable row level security','ATTR_TIME_SCHEMA_ACCESS_DRIFT'],
    ['changed authenticated write grant','revoke update on public.venue_sales_attributions from authenticated','ATTR_TIME_SCHEMA_ACCESS_DRIFT'],
    ['missing active uniqueness','drop index public.venue_sales_attributions_one_active_idx','ATTR_TIME_SCHEMA_ACCESS_DRIFT'],
    ['nullable effective date','alter table public.venue_sales_attributions alter column effective_from drop not null','ATTR_TIME_SCHEMA_ACCESS_DRIFT'],
    ['changed assignment','alter function public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamptz)stable','ATTR_TIME_ASSIGNMENT_DRIFT'],
    ['changed approval','grant execute on function public.attribute_approved_venue_agent_referral()to anon','ATTR_TIME_APPROVAL_DRIFT'],
  ])await t.test(name+' prevents application',async()=>{await db.exec('begin;'+change);try{await assert.rejects(db.exec(sql.replace(/^begin;/,'')),new RegExp(message));}finally{await db.exec('rollback');}await absent();});
  for(const[name,change,message]of[
    ['changed agreement',"update public.venue_sales_attributions set agreement_reference='Injected agreement'",'ATTR_TIME_RECORDS_CHANGED'],
    ['inserted audit',"insert into public.admin_actions(target_type,action)values('synthetic','injected')",'ATTR_TIME_RECORDS_CHANGED'],
    ['removed check','alter table public.venue_sales_attributions drop constraint venue_sales_attributions_finite_times_check','ATTR_TIME_CONSTRAINT_MISMATCH'],
    ['weakened check','alter table public.venue_sales_attributions drop constraint venue_sales_attributions_finite_times_check;alter table public.venue_sales_attributions add constraint venue_sales_attributions_finite_times_check check(true)','ATTR_TIME_CONSTRAINT_MISMATCH'],
    ['changed assignment ACL','grant execute on function public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamptz)to anon','ATTR_TIME_METADATA_CHANGED'],
    ['changed unrelated graph function','alter function public.lock_sales_agent_hierarchy_writes()stable','ATTR_TIME_METADATA_CHANGED'],
    ['column write grant','grant update(effective_from)on public.venue_sales_attributions to anon','ATTR_TIME_METADATA_CHANGED'],
    ['disabled original hierarchy trigger','alter table public.sales_agents disable trigger validate_sales_agent_hierarchy_trigger','ATTR_TIME_METADATA_CHANGED'],
    ['new ledger entry',"insert into supabase_migrations.schema_migrations(version,name)values('synthetic','injected')",'ATTR_TIME_METADATA_CHANGED'],
  ])await t.test(name+' rolls back the release',async()=>{const before=await agentSnapshot(db);const metadata=(await db.query(attributionTimeMetadataSql)).rows;try{await assert.rejects(db.exec(deploy({after:change+';'})),new RegExp(message));}finally{await db.exec('rollback');}await absent();assert.deepEqual(await agentSnapshot(db),before);assert.deepEqual((await db.query(attributionTimeMetadataSql)).rows,metadata);});
  await t.test('exact source preserves assignments and all native metadata',async()=>{const before=await agentSnapshot(db);await db.exec(sql);assert.deepEqual(await agentSnapshot(db),before);const stored=(await db.query('select * from supabase_migrations.schema_migrations')).rows[0];assert.equal(stored.version,attributionTimeVersion);assert.equal(stored.statements[0],source);});
  await t.test('repeat release is rejected without mutation',async()=>{const before=await agentSnapshot(db);try{await assert.rejects(db.exec(sql),/ATTR_TIME_ALREADY_APPLIED/);}finally{await db.exec('rollback');}assert.deepEqual(await agentSnapshot(db),before);});
});
