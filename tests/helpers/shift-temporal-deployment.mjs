import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {slotMetadataSql,slotRecordsSql} from './profile-video-slot-deployment.mjs';
const schema=JSON.parse(readFileSync(new URL('../fixtures/shift-temporal-schema.json',import.meta.url),'utf8'));
export const shiftVersion='20260912083000';
export const shiftSignature='public.set_shift_date_from_starts_at()';
export const shiftChecks=['shifts_finite_schedule_times_check','shifts_checkout_time_order_check'];
const literal=s=>s===null?'null':"'"+s.replaceAll("'","''")+"'";
export const shiftMetadataSql=slotMetadataSql
  .replace("p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure","p.oid<>'"+shiftSignature+"'::regprocedure")
  .replace(" and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')",'')
  .replace("where n.nspname in ('public','auth','storage')),\n 'indexes'", "where n.nspname in ('public','auth','storage') and not(c.conrelid='public.shifts'::regclass and c.conname in("+shiftChecks.map(literal).join(',')+"))),\n 'indexes'");
if(shiftMetadataSql.includes('enforce_mydancr_tv_profile_video_limit')||!shiftMetadataSql.includes('c.conname in('))throw new Error('Unexpected temporal metadata template');
export const shiftTargetSql=`select jsonb_build_object(
 'relations',(select jsonb_build_array(c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,(select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE')))from unnest(array['anon','authenticated','service_role'])r))from pg_class c where c.oid='public.shifts'::regclass),
 'columns',(select jsonb_agg(jsonb_build_array(column_name,ordinal_position,udt_schema,udt_name,is_nullable,column_default,is_identity,is_generated)order by ordinal_position)from information_schema.columns where table_schema='public'and table_name='shifts'),
 'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid),convalidated)order by conname)from pg_constraint where conrelid='public.shifts'::regclass and contype<>'n'),
 'indexes',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)order by c.relname)from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid='public.shifts'::regclass),
 'policies',(select jsonb_agg(to_jsonb(p)order by policyname)from pg_policies p where schemaname='public'and tablename='shifts'),
 'triggers',(select jsonb_agg(jsonb_build_array(tgname,pg_get_triggerdef(oid),tgenabled)order by tgname)from pg_trigger where tgrelid='public.shifts'::regclass and not tgisinternal)
)`;
const relation=schema.relations[0];
export const expectedShiftTarget={relations:[relation.name,relation.owner,relation.rls,relation.force_rls,relation.grants],columns:schema.columns.map(c=>[c.column_name,c.ordinal_position,c.udt_schema,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.is_generated]),constraints:schema.constraints.map(c=>[c.name,c.definition,c.validated]),indexes:schema.indexes.map(i=>[i.indexname,i.indexdef,i.indisvalid,i.indisready]),policies:schema.policies,triggers:schema.triggers.map(t=>[t.name,t.definition,t.enabled])};
export const shiftCheckSql=`select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid),convalidated)order by conname)from pg_constraint where conrelid='public.shifts'::regclass and conname in(${shiftChecks.map(literal).join(',')})`;
export function buildShiftDeployment({source,newFingerprint,checks,tables,after=''}={}) {
  if(!/^[0-9a-f]{32}$/.test(newFingerprint)||checks?.length!==2||checks.some(c=>!shiftChecks.includes(c[0])||c[2]!==true))throw new Error('Missing verified temporal function/constraint results');
  source=source.replaceAll('\r\n','\n');if(!source.includes('\nbegin;')||!source.trimEnd().endsWith('commit;'))throw new Error('Unexpected temporal migration source');
  const body=source.replace('\nbegin;','\n').replace(/commit;\s*$/,'');const records=slotRecordsSql(tables);const md5=createHash('md5').update(source).digest('hex');
  return `begin;
set local search_path=pg_catalog,public,pg_temp;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.shifts in share row exclusive mode;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(shiftVersion)})then raise exception 'SHIFT_TIME_ALREADY_APPLIED';end if;
 if (${shiftTargetSql})is distinct from ${literal(JSON.stringify(expectedShiftTarget))}::jsonb then raise exception 'SHIFT_TIME_SCHEMA_ACCESS_DRIFT';end if;
 ${schema.functions.map(f=>`if not exists(select 1 from pg_proc p where p.oid='public.${f.signature}'::regprocedure and md5(pg_get_functiondef(p.oid))=${literal(f.fingerprint)} and pg_get_userbyid(p.proowner)=${literal(f.owner)} and p.proacl::text is not distinct from ${literal(f.acl)})then raise exception 'SHIFT_TIME_DEPENDENCY_DRIFT';end if;`).join('\n')}
end $guard$;
create temporary table shift_time_metadata_before on commit drop as ${shiftMetadataSql};
create temporary table shift_time_records_before on commit drop as ${records};
${body}
${after}
do $guard$ begin
 if not exists(select 1 from pg_proc p where p.oid='${shiftSignature}'::regprocedure and md5(pg_get_functiondef(p.oid))=${literal(newFingerprint)}and pg_get_userbyid(p.proowner)='postgres'and not p.prosecdef and p.proacl::text='{postgres=X/postgres}'and p.proconfig=array['search_path=pg_catalog, public, pg_temp'])then raise exception 'SHIFT_TIME_FUNCTION_MISMATCH';end if;
 if (${shiftCheckSql})is distinct from ${literal(JSON.stringify(checks))}::jsonb then raise exception 'SHIFT_TIME_CONSTRAINT_MISMATCH';end if;
 if(select metadata from shift_time_metadata_before)is distinct from(${shiftMetadataSql})then raise exception 'SHIFT_TIME_METADATA_CHANGED';end if;
 if(select records from shift_time_records_before)is distinct from(${records})then raise exception 'SHIFT_TIME_RECORDS_CHANGED';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(shiftVersion)},'preserve_shift_local_dates',array[${literal(source)}]);
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(shiftVersion)}and name='preserve_shift_local_dates'and md5(array_to_string(statements,E'\\n'))=${literal(md5)})then raise exception 'SHIFT_TIME_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(shiftVersion)},'source_md5',${literal(md5)},'function_fingerprint',${literal(newFingerprint)},'checks',${literal(JSON.stringify(checks))}::jsonb,'records_preserved',true,'metadata_preserved',true)release;
commit;\n`;
}
