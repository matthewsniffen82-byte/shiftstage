import {createHash} from 'node:crypto';
import {slotMetadataSql,slotRecordsSql} from './profile-video-slot-deployment.mjs';
export const accountLifecycleVersion='20260912113200';
export function accountLifecycleRecordsSql(tables) {
  if(!Array.isArray(tables)||!tables.length||new Set(tables).size!==tables.length)throw new Error('Unique preservation relations required');
  const groups=[];
  // PostgreSQL allows at most 100 function arguments. Each table contributes
  // two jsonb_build_object arguments; bounded groups cover the full catalog.
  for(let offset=0;offset<tables.length;offset+=40)groups.push('('+slotRecordsSql(tables.slice(offset,offset+40))+')');
  return 'select '+groups.join(' || ')+' records';
}
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const newFunctions="array['invalidate_account_self_pause','transition_own_account_safely','change_venue_publication_safely']";
const newTable="coalesce(to_regclass('public.account_self_pauses'),0::oid)";
const newTriggers="array['invalidate_account_pause_after_decision','invalidate_account_pause_after_venue_decision','invalidate_account_pause_after_profile_decision']";
const protectedTables="('public.app_users'::regclass,'public.venues'::regclass)";
const normalizedTableAcl=`case when c.oid in${protectedTables}then(select coalesce(jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)order by x.grantor,x.grantee,x.privilege_type,x.is_grantable),'[]'::jsonb)from aclexplode(c.relacl)x where not(x.grantee='service_role'::regrole and x.privilege_type='UPDATE'))else to_jsonb(c.relacl::text)end`;
const normalizedColumnAcl=`case when a.attrelid in${protectedTables}then(select coalesce(jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)order by x.grantor,x.grantee,x.privilege_type,x.is_grantable),'[]'::jsonb)from aclexplode(a.attacl)x where not(x.grantee='service_role'::regrole and x.privilege_type='UPDATE'))else to_jsonb(a.attacl::text)end`;
export const accountLifecycleMetadataSql=slotMetadataSql
  .replace(" and p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure",` and not(n.nspname='public' and p.proname=any(${newFunctions}))`)
  .replace(" and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')",` and not(t.tgrelid in('public.app_users'::regclass,'public.venues'::regclass,'public.dancer_profiles'::regclass)and t.tgname=any(${newTriggers}))`)
  .replace("and c.relkind in ('r','p','v','m','f','S')",`and c.relkind in ('r','p','v','m','f','S') and c.oid<>${newTable}`)
  .replace("and c.relkind in ('r','p','v','m','f')",`and c.relkind in ('r','p','v','m','f') and c.oid<>${newTable}`)
  .replace("where n.nspname in ('public','auth','storage')),\n 'indexes'",`where n.nspname in ('public','auth','storage') and c.conrelid<>${newTable}),\n 'indexes'`)
  .replace("where n.nspname in ('public','auth','storage')),\n 'policies'",`where n.nspname in ('public','auth','storage') and i.indrelid<>${newTable}),\n 'policies'`)
  .replace("where p.schemaname in ('public','auth','storage'))", "where p.schemaname in ('public','auth','storage')and not(p.schemaname='public'and p.tablename='account_self_pauses'))")
  .replace("'acl',c.relacl::text","'acl',"+normalizedTableAcl)
  .replace("'acl',a.attacl::text","'acl',"+normalizedColumnAcl);
if(accountLifecycleMetadataSql.includes('enforce_mydancr_tv_profile_video_limit')||!accountLifecycleMetadataSql.includes('c.conrelid<>')||!accountLifecycleMetadataSql.includes('i.indrelid<>'))throw new Error('Unexpected account lifecycle preservation template');

export const accountLifecycleTargetSql=`select jsonb_build_object(
  'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text)order by c.relname)from pg_class c where c.oid in('public.app_users'::regclass,'public.venues'::regclass,'public.dancer_profiles'::regclass)),
  'columns',(select jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid))order by a.attrelid::regclass::text,a.attnum)from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid in('public.app_users'::regclass,'public.venues'::regclass,'public.dancer_profiles'::regclass)and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid),convalidated)order by conrelid::regclass::text,conname)from pg_constraint where conrelid in('public.app_users'::regclass,'public.venues'::regclass,'public.dancer_profiles'::regclass)and contype<>'n'),
  'triggers',(select jsonb_agg(jsonb_build_array(tgrelid::regclass::text,tgname,pg_get_triggerdef(oid),tgenabled)order by tgrelid::regclass::text,tgname)from pg_trigger where tgrelid in('public.app_users'::regclass,'public.venues'::regclass,'public.dancer_profiles'::regclass)and not tgisinternal and not(tgname=any(${newTriggers}))))`;

export const accountLifecycleNewObjectsSql=`select jsonb_build_object(
  'serviceUpdateColumns',(select jsonb_agg(jsonb_build_array(a.attrelid::regclass::text,a.attname,has_column_privilege('service_role',a.attrelid,a.attname,'UPDATE'),(select coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable)order by x.grantor,x.privilege_type,x.is_grantable),'[]'::jsonb)from aclexplode(a.attacl)x where x.grantee='service_role'::regrole and x.privilege_type='UPDATE'))order by a.attrelid::regclass::text,a.attnum)from pg_attribute a where a.attrelid in${protectedTables}and a.attnum>0 and not a.attisdropped),
  'serviceTableUpdates',jsonb_build_array(has_table_privilege('service_role','public.app_users','UPDATE'),has_table_privilege('service_role','public.venues','UPDATE')),
  'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'fingerprint',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definer',p.prosecdef,'settings',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'))order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=any(${newFunctions})),
  'table',(select jsonb_build_object('owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'anon',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'authenticated',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'service_select',has_table_privilege('service_role',c.oid,'SELECT'),'service_insert',has_table_privilege('service_role',c.oid,'INSERT'),'service_update',has_table_privilege('service_role',c.oid,'UPDATE'),'service_delete',has_table_privilege('service_role',c.oid,'DELETE'),'service_extra',has_table_privilege('service_role',c.oid,'TRUNCATE,REFERENCES,TRIGGER'))from pg_class c where c.oid=${newTable}),
  'columns',(select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,attacl::text,pg_get_expr(d.adbin,d.adrelid))order by attnum)from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=${newTable}and attnum>0 and not attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid),convalidated)order by conname)from pg_constraint where conrelid=${newTable}and contype<>'n'),
  'indexes',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)order by c.relname)from pg_index i join pg_class c on c.oid=i.indexrelid where indrelid=${newTable}),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p)order by policyname),'[]')from pg_policies p where schemaname='public'and tablename='account_self_pauses'),
  'triggers',(select jsonb_agg(jsonb_build_array(tgrelid::regclass::text,tgname,pg_get_triggerdef(oid),tgenabled)order by tgname)from pg_trigger where tgrelid in('public.app_users'::regclass,'public.venues'::regclass,'public.dancer_profiles'::regclass)and not tgisinternal and tgname=any(${newTriggers})))`;

export const accountPauseLegacyEligibleSql=`select a.id from public.app_users a join auth.users u on u.id=a.id
  where a.account_state='disabled'and a.dmca_suspended_at is null
  and jsonb_typeof(u.raw_app_meta_data->'mydancr_self_disabled_at')='string'
  and u.raw_app_meta_data->>'mydancr_self_disabled_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'`;

export function buildAccountLifecycleDeployment({source,expectedTarget,expectedNewObjects,tables,after=''}) {
  if(expectedTarget?.relations?.length!==3||expectedTarget.columns?.length!==60)throw new Error('Fresh account lifecycle target catalog required');
  if(expectedNewObjects?.functions?.length!==3||expectedNewObjects.columns?.length!==7||expectedNewObjects.triggers?.length!==3||expectedNewObjects.serviceUpdateColumns?.length!==38)throw new Error('Verified native account lifecycle postconditions required');
  source=source.replaceAll('\r\n','\n');
  if(!source.includes('\nbegin;')||!source.trimEnd().endsWith('commit;'))throw new Error('Unexpected account lifecycle transaction source');
  const body=source.replace('\nbegin;','\n').replace(/commit;\s*$/,''),digest=createHash('md5').update(source).digest('hex');
  const records=accountLifecycleRecordsSql(tables);
  const authRecords="select md5(coalesce(string_agg(md5(jsonb_build_array(id,raw_app_meta_data,raw_user_meta_data)::text),''order by id),'')) as fingerprint from auth.users";
  return `begin;
set local search_path=pg_catalog,public,pg_temp;set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.app_users,public.venues,public.dancer_profiles in share row exclusive mode;
lock table auth.users in share mode;
do $guard$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(accountLifecycleVersion)})then raise exception 'ACCOUNT_LIFECYCLE_ALREADY_APPLIED';end if;
  if to_regclass('public.account_self_pauses')is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=any(${newFunctions}))then raise exception 'ACCOUNT_LIFECYCLE_UNEXPECTED_OBJECT';end if;
  if(${accountLifecycleTargetSql})is distinct from ${literal(JSON.stringify(expectedTarget))}::jsonb then raise exception 'ACCOUNT_LIFECYCLE_TARGET_DRIFT';end if;
end $guard$;
create temporary table account_lifecycle_metadata_before on commit drop as ${accountLifecycleMetadataSql};
create temporary table account_lifecycle_records_before on commit drop as ${records};
create temporary table account_lifecycle_auth_before on commit drop as ${authRecords};
${body}
${after}
do $guard$ begin
  if(${accountLifecycleNewObjectsSql})is distinct from ${literal(JSON.stringify(expectedNewObjects))}::jsonb then raise exception 'ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH';end if;
  if(select metadata from account_lifecycle_metadata_before)is distinct from(${accountLifecycleMetadataSql})then raise exception 'ACCOUNT_LIFECYCLE_METADATA_CHANGED';end if;
  if(select records from account_lifecycle_records_before)is distinct from(${records})then raise exception 'ACCOUNT_LIFECYCLE_RECORDS_CHANGED';end if;
  if(select fingerprint from account_lifecycle_auth_before)is distinct from(${authRecords})then raise exception 'ACCOUNT_LIFECYCLE_AUTH_CHANGED';end if;
  if exists((select user_id from public.account_self_pauses except ${accountPauseLegacyEligibleSql})union all(${accountPauseLegacyEligibleSql}except select user_id from public.account_self_pauses))then raise exception 'ACCOUNT_LIFECYCLE_LEGACY_IMPORT_MISMATCH';end if;
  if exists(select 1 from public.account_self_pauses where not legacy_imported or venue_id is not null or venue_was_active is not null or dancer_previous_state->>'is_public'='true')then raise exception 'ACCOUNT_LIFECYCLE_LEGACY_VISIBILITY_MISMATCH';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(accountLifecycleVersion)},'make_self_service_account_transitions_atomic',array[${literal(source)}]);
do $guard$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(accountLifecycleVersion)}and name='make_self_service_account_transitions_atomic'and md5(array_to_string(statements,E'\\n'))=${literal(digest)})then raise exception 'ACCOUNT_LIFECYCLE_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(accountLifecycleVersion)},'source_md5',${literal(digest)},'metadata_preserved',true,'records_preserved',true,'auth_metadata_preserved',true,'legacy_pauses_imported',(select count(*)from public.account_self_pauses))release;
commit;
`;
}
