import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {slotMetadataSql,slotRecordsSql} from './profile-video-slot-deployment.mjs';
const schema=JSON.parse(readFileSync(new URL('../fixtures/agent-hierarchy-schema.json',import.meta.url),'utf8'));
export const attributionTimeVersion='20260912084000';
export const attributionTimeCheck='venue_sales_attributions_finite_times_check';
const literal=s=>s===null?'null':"'"+s.replaceAll("'","''")+"'";
export const attributionTimeMetadataSql=slotMetadataSql
  .replace(" and p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure",'')
  .replace(" and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')",'')
  .replace("where n.nspname in ('public','auth','storage')),\n 'indexes'","where n.nspname in ('public','auth','storage') and not(c.conrelid='public.venue_sales_attributions'::regclass and c.conname='"+attributionTimeCheck+"')),\n 'indexes'");
if(attributionTimeMetadataSql.includes('enforce_mydancr_tv_profile_video_limit')||!attributionTimeMetadataSql.includes('c.conname='))throw new Error('Unexpected attribution metadata template');
export const attributionTimeTargetSql=`select jsonb_build_object(
 'relations',(select jsonb_build_array(c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,(select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE')))from unnest(array['anon','authenticated','service_role'])r))from pg_class c where c.oid='public.venue_sales_attributions'::regclass),
 'columns',(select jsonb_agg(jsonb_build_array(column_name,ordinal_position,udt_schema,udt_name,is_nullable,column_default,is_identity,is_generated)order by ordinal_position)from information_schema.columns where table_schema='public'and table_name='venue_sales_attributions'),
 'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid),convalidated)order by conname)from pg_constraint where conrelid='public.venue_sales_attributions'::regclass and contype<>'n'),
 'indexes',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)order by c.relname)from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid='public.venue_sales_attributions'::regclass),
 'policies',(select jsonb_agg(to_jsonb(p)order by policyname)from pg_policies p where schemaname='public'and tablename='venue_sales_attributions'),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(tgname,pg_get_triggerdef(oid),tgenabled)order by tgname),'[]')from pg_trigger where tgrelid='public.venue_sales_attributions'::regclass and not tgisinternal)
)`;
const relation=schema.relations.find(t=>t.name==='venue_sales_attributions');
export const expectedAttributionTarget={relations:[relation.name,relation.owner,relation.rls,relation.force_rls,relation.grants],columns:schema.columns.filter(c=>c.table_name===relation.name).map(c=>[c.column_name,c.ordinal_position,c.udt_schema,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.is_generated]),constraints:schema.constraints.filter(c=>c.table_name===relation.name).map(c=>[c.name,c.definition,c.validated]),indexes:schema.indexes.filter(i=>i.tablename===relation.name).map(i=>[i.indexname,i.indexdef,i.indisvalid,i.indisready]),policies:schema.policies.filter(p=>p.tablename===relation.name),triggers:schema.triggers.filter(t=>t.table_name===relation.name).map(t=>[t.name,t.definition,t.enabled])};
export const attributionTimeCheckSql="select jsonb_build_array(conname,pg_get_constraintdef(oid),convalidated)from pg_constraint where conrelid='public.venue_sales_attributions'::regclass and conname='"+attributionTimeCheck+"'";
export function buildAttributionTimeDeployment({source,check,tables,after=''}={}) {
  if(check?.[0]!==attributionTimeCheck||check[2]!==true)throw new Error('Missing verified attribution constraint');
  source=source.replaceAll('\r\n','\n');if(!source.includes('\nbegin;')||!source.trimEnd().endsWith('commit;'))throw new Error('Unexpected attribution migration source');
  const body=source.replace('\nbegin;','\n').replace(/commit;\s*$/,'');const records=slotRecordsSql(tables);const md5=createHash('md5').update(source).digest('hex');
  return `begin;
set local search_path=pg_catalog,public,pg_temp;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.venue_sales_attributions in share row exclusive mode;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(attributionTimeVersion)})then raise exception 'ATTR_TIME_ALREADY_APPLIED';end if;
 if (${attributionTimeTargetSql})is distinct from ${literal(JSON.stringify(expectedAttributionTarget))}::jsonb then raise exception 'ATTR_TIME_SCHEMA_ACCESS_DRIFT';end if;
 if not exists(select 1 from pg_proc where oid='public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamptz)'::regprocedure and md5(pg_get_functiondef(oid))='5b90232f8c2996747f2adae61b628a8c'and proacl::text='{postgres=X/postgres,service_role=X/postgres}'and pg_get_userbyid(proowner)='postgres')then raise exception 'ATTR_TIME_ASSIGNMENT_DRIFT';end if;
 if not exists(select 1 from pg_proc where oid='public.attribute_approved_venue_agent_referral()'::regprocedure and md5(pg_get_functiondef(oid))='a7ea3b1ba3310b7815e69fec5c370610'and proacl::text='{postgres=X/postgres}'and pg_get_userbyid(proowner)='postgres')then raise exception 'ATTR_TIME_APPROVAL_DRIFT';end if;
end $guard$;
create temporary table attr_time_metadata_before on commit drop as ${attributionTimeMetadataSql};
create temporary table attr_time_records_before on commit drop as ${records};
${body}
${after}
do $guard$ begin
 if (${attributionTimeCheckSql})is distinct from ${literal(JSON.stringify(check))}::jsonb then raise exception 'ATTR_TIME_CONSTRAINT_MISMATCH';end if;
 if(select metadata from attr_time_metadata_before)is distinct from(${attributionTimeMetadataSql})then raise exception 'ATTR_TIME_METADATA_CHANGED';end if;
 if(select records from attr_time_records_before)is distinct from(${records})then raise exception 'ATTR_TIME_RECORDS_CHANGED';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(attributionTimeVersion)},'require_finite_attribution_times',array[${literal(source)}]);
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(attributionTimeVersion)}and name='require_finite_attribution_times'and md5(array_to_string(statements,E'\\n'))=${literal(md5)})then raise exception 'ATTR_TIME_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(attributionTimeVersion)},'source_md5',${literal(md5)},'check',${literal(JSON.stringify(check))}::jsonb,'records_preserved',true,'metadata_preserved',true)release;
commit;\n`;
}
