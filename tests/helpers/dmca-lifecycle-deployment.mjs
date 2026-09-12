import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {slotMetadataSql} from './profile-video-slot-deployment.mjs';
const schema=JSON.parse(readFileSync(new URL('../fixtures/dmca-lifecycle-current.json',import.meta.url),'utf8'));
const literal=s=>s===null?'null':"'"+s.replaceAll("'","''")+"'";
export const dmcaSignatures=['public.apply_dmca_takedown(uuid,uuid,text)','public.restore_dmca_case(uuid,uuid,text)','public.submit_dmca_counter_notice_safely(uuid,uuid,jsonb)','public.invalidate_dmca_enforcement_state()','public.transition_dmca_admin_case(uuid,uuid,text,text,timestamptz,text)','public.confirm_dmca_counter_forwarding(uuid,uuid)'];
export const dmcaTriggers=[['app_users','invalidate_dmca_account_enforcement'],['dancer_profiles','invalidate_dmca_profile_enforcement'],['mydancr_tv_videos','invalidate_dmca_video_enforcement']];
const table='dmca_enforcement_states';
const targets=schema.scope.fullTargets.map(literal).join(',');
const triggerPredicate=dmcaTriggers.map(([relation,name])=>`(t.tgrelid='public.${relation}'::regclass and t.tgname=${literal(name)})`).join(' or ');
function replace(source,from,to){assert.equal(source.split(from).length,2,'Expected one guard template anchor: '+from);return source.replace(from,to);}
let metadata=replace(slotMetadataSql,"p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure",dmcaSignatures.map(signature=>`p.oid is distinct from to_regprocedure(${literal(signature)})`).join(' and '));
metadata=replace(metadata,"and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')",'and not('+triggerPredicate+')');
metadata=replace(metadata,"and c.relkind in ('r','p','v','m','f','S')","and c.relkind in ('r','p','v','m','f','S') and not(n.nspname='public' and c.relname='"+table+"')");
metadata=replace(metadata,"and c.relkind in ('r','p','v','m','f') and a.attnum>0","and c.relkind in ('r','p','v','m','f') and not(n.nspname='public' and c.relname='"+table+"') and a.attnum>0");
metadata=replace(metadata,"from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','auth','storage')","from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','auth','storage') and c.conrelid is distinct from to_regclass('public."+table+"')");
metadata=replace(metadata,"from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage')","from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and i.indrelid is distinct from to_regclass('public."+table+"')");
metadata=replace(metadata,"from pg_policies p where p.schemaname in ('public','auth','storage')","from pg_policies p where p.schemaname in ('public','auth','storage') and not(p.schemaname='public' and p.tablename='"+table+"')");
metadata=replace(metadata," 'ledger',"," 'default_privileges',(select jsonb_agg(to_jsonb(d)order by oid)from pg_default_acl d),\n 'schemas',(select jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl::text)order by nspname)from pg_namespace where nspname in('public','auth','storage')),\n 'enums',(select jsonb_agg(jsonb_build_array(e.enumtypid,e.enumsortorder,e.enumlabel)order by e.enumtypid,e.enumsortorder)from pg_enum e),\n 'extensions',(select jsonb_agg(jsonb_build_array(extname,extowner,extnamespace,extrelocatable,extversion,extconfig,extcondition)order by extname)from pg_extension),\n 'ledger',");
metadata=replace(metadata," 'ledger',"," 'types',(select jsonb_agg(to_jsonb(t)order by t.oid)from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in('public','auth','storage')and not(n.nspname='public'and t.typname in('dmca_enforcement_states','_dmca_enforcement_states'))),\n 'ledger',");
export const dmcaMetadataSql=metadata;
export function dmcaRecordsSql(tables){
 assert.ok(Array.isArray(tables)&&tables.length>0,'A preservation scope is required');
 assert.equal(new Set(tables).size,tables.length,'Duplicate preservation relation');
 assert.ok(tables.every(t=>/^(public|storage)\.[a-z_]+$/.test(t)),'Invalid preservation relation');
 const groups=[];
 for(let offset=0;offset<tables.length;offset+=40){
  groups.push('jsonb_build_object('+tables.slice(offset,offset+40).map(t=>literal(t)+",(select jsonb_build_object('count',count(*),'fingerprint',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),''))) from "+t+' r)').join(',')+')');
 }
 return 'select ('+groups.join('||')+') records';
}
export const dmcaTargetSql=`select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,(select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE')))from unnest(array['anon','authenticated','service_role'])r))order by c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relname in(${targets})),
 'columns',(select jsonb_agg(jsonb_build_array(table_name,column_name,ordinal_position,udt_schema,udt_name,is_nullable,column_default,is_identity,is_generated)order by table_name,ordinal_position)from information_schema.columns where table_schema='public'and table_name in(${targets})),
 'constraints',(select jsonb_agg(jsonb_build_array(c.conrelid::regclass::text,c.conname,pg_get_constraintdef(c.oid),c.convalidated)order by c.conrelid::regclass::text,c.conname)from pg_constraint c where c.conrelid in(select oid from pg_class where relnamespace='public'::regnamespace and relname in(${targets}))and c.contype<>'n'),
 'indexes',(select jsonb_agg(jsonb_build_array(i.indrelid::regclass::text,c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)order by i.indrelid::regclass::text,c.relname)from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid in(select oid from pg_class where relnamespace='public'::regnamespace and relname in(${targets}))),
 'policies',(select jsonb_agg(to_jsonb(p)order by p.tablename,p.policyname)from pg_policies p where p.schemaname='public'and p.tablename in(${targets})),
 'triggers',(select jsonb_agg(jsonb_build_array(t.tgrelid::regclass::text,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled)order by t.tgrelid::regclass::text,t.tgname)from pg_trigger t where t.tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace and relname in(${targets}))and not t.tgisinternal and not(${triggerPredicate})),
 'table_access',(select jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl::text,
  'effective',(select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE'),'truncate',has_table_privilege(r,c.oid,'TRUNCATE'),'references',has_table_privilege(r,c.oid,'REFERENCES'),'trigger',has_table_privilege(r,c.oid,'TRIGGER')))from unnest(array['anon','authenticated','service_role'])r))order by c.relname)from pg_class c where c.relnamespace='public'::regnamespace and c.relname in(${targets})),
 'column_access',(select jsonb_agg(jsonb_build_array(c.relname,a.attname,a.attacl::text)order by c.relname,a.attnum)from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relname in(${targets})and a.attnum>0 and not a.attisdropped)
)`;
export const expectedDmcaTarget={
 relations:schema.relations.map(r=>[r.name,r.owner,r.rls,r.force_rls,r.grants]),
 columns:schema.columns.map(c=>[c.table_name,c.column_name,c.ordinal_position,c.udt_schema,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.is_generated]),
 constraints:schema.constraints.map(c=>[c.table_name,c.name,c.definition,c.validated]),
 indexes:schema.indexes.map(i=>[i.tablename,i.indexname,i.indexdef,i.indisvalid,i.indisready]),
 policies:schema.policies,
 triggers:schema.triggers.map(t=>[t.table,t.name,t.definition,t.enabled]),
 column_access:schema.columnAccess.map(c=>[c.table,c.column,c.acl]),
 table_access:schema.tableAccess
};
export const dmcaEffectsSql=`select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef,p.proconfig)order by p.oid::regprocedure::text)from pg_proc p where ${dmcaSignatures.map(signature=>`p.oid=to_regprocedure(${literal(signature)})`).join(' or ')}),
 'triggers',(select jsonb_agg(jsonb_build_array(t.tgrelid::regclass::text,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled)order by t.tgrelid::regclass::text,t.tgname)from pg_trigger t where ${triggerPredicate}),
 'table',(select jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text,
  'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attacl::text,pg_get_expr(d.adbin,d.adrelid))order by a.attnum)from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid),convalidated)order by conname)from pg_constraint where conrelid=c.oid and contype<>'n'),
  'indexes',(select jsonb_agg(jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready)order by indexrelid::regclass::text)from pg_index where indrelid=c.oid),
  'policies',(select count(*)from pg_policies where schemaname='public'and tablename='${table}'))from pg_class c where c.oid=to_regclass('public.${table}'))
)`;
export const dmcaVersion='20260912140704';
export const dmcaMigrationPath='supabase/migrations/20260912140704_preserve_owned_dmca_lifecycle_states.sql';
export const draftDmcaSource=readFileSync(new URL('../../supabase/migrations/20260912140704_preserve_owned_dmca_lifecycle_states.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const expectedSource="-- Preserve later independent account, profile and video decisions during copyright enforcement.\nbegin;\n"+["ownership.sql","takedown.sql","restoration.sql","admin-transition.sql","counter-submission.sql","counter-forwarding.sql"].map(path=>'-- DMCA_COMPONENT: '+path+'\n'+readFileSync(new URL('../fixtures/dmca-lifecycle/'+path,import.meta.url),'utf8').replaceAll('\r\n','\n')).join('\n')+'\ncommit;\n';
assert.equal(draftDmcaSource,expectedSource,'Native components must match the exact committed migration source');
export const dmcaLedgerSql="select jsonb_agg(jsonb_build_object('version',version,'name',name,'sql_md5',md5(array_to_string(statements,E'\\n')))order by version)from supabase_migrations.schema_migrations";
export function buildDmcaDeployment({source,version,name,effects,tables,expectedLedger,target=expectedDmcaTarget,after=''}={}){
 assert.match(version,/^\d{14}$/);assert.match(name,/^[a-z][a-z_]+$/);assert.equal(effects.functions.length,6);assert.equal(effects.triggers.length,3);
 assert.ok(Array.isArray(expectedLedger)&&expectedLedger.length>0,'An independently captured ledger is required');
 assert.equal(new Set(expectedLedger.map(row=>row.version)).size,expectedLedger.length,'Duplicate captured ledger entry');
 for(const row of expectedLedger){assert.match(row.version,/^(?:\d{12}|\d{14})$/);if(row.sql_md5!==null)assert.match(row.sql_md5,/^[a-f0-9]{32}$/);}
 source=source.replaceAll('\r\n','\n');assert.ok(source.includes('\nbegin;')&&source.trimEnd().endsWith('commit;'));
 const body=source.replace('\nbegin;','\n').replace(/commit;\s*$/,'');const records=dmcaRecordsSql(tables),hash=createHash('md5').update(source).digest('hex');
 return `begin;
set local search_path=pg_catalog,public,pg_temp;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table ${schema.scope.fullTargets.map(t=>'public.'+t).join(',')} in share row exclusive mode;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version>=${literal(version)})then raise exception 'DMCA_LEDGER_CHANGED_OR_ALREADY_APPLIED';end if;
 if (${dmcaLedgerSql})is distinct from ${literal(JSON.stringify(expectedLedger))}::jsonb then raise exception 'DMCA_CAPTURED_LEDGER_CHANGED';end if;
 if to_regclass('public.${table}')is not null or ${dmcaSignatures.slice(3).map(s=>`to_regprocedure(${literal(s)})is not null`).join(' or ')} then raise exception 'DMCA_UNEXPECTED_NEW_OBJECT';end if;
 if exists(select 1 from pg_trigger t where ${triggerPredicate})then raise exception 'DMCA_UNEXPECTED_ATTACHMENT';end if;
 if (${dmcaTargetSql})is distinct from ${literal(JSON.stringify(target))}::jsonb then raise exception 'DMCA_SCHEMA_ACCESS_DRIFT';end if;
 ${schema.functions.map(f=>`if not exists(select 1 from pg_proc p where p.oid='public.${f.signature}'::regprocedure and md5(pg_get_functiondef(p.oid))=${literal(f.fingerprint)}and pg_get_userbyid(p.proowner)=${literal(f.owner)}and p.proacl::text is not distinct from ${literal(f.acl)})then raise exception 'DMCA_DEPENDENCY_DRIFT';end if;`).join('\n')}
 if exists(select 1 from public.dmca_cases)or exists(select 1 from public.dmca_counter_notices)or exists(select 1 from public.dmca_strikes)
  or exists(select 1 from public.app_users where dmca_suspended_at is not null)or exists(select 1 from public.dancer_profiles where dmca_suspended_at is not null)then raise exception 'DMCA_EXISTING_ENFORCEMENT_REQUIRES_SEPARATE_TRANSITION';end if;
end $guard$;
create temporary table dmca_metadata_before on commit drop as ${dmcaMetadataSql};
create temporary table dmca_records_before on commit drop as ${records};
${body}
${after}
do $guard$ begin
 if (${dmcaEffectsSql})is distinct from ${literal(JSON.stringify(effects))}::jsonb then raise exception 'DMCA_NEW_EFFECTS_MISMATCH';end if;
 if exists(select 1 from public.${table})then raise exception 'DMCA_UNEXPECTED_ENFORCEMENT_DATA';end if;
 if (select metadata from dmca_metadata_before)is distinct from(${dmcaMetadataSql})then raise exception 'DMCA_UNRELATED_METADATA_CHANGED';end if;
 if (select records from dmca_records_before)is distinct from(${records})then raise exception 'DMCA_RECORDS_CHANGED';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(version)},${literal(name)},array[${literal(source)}]);
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(version)}and name=${literal(name)}and md5(array_to_string(statements,E'\\n'))=${literal(hash)})then raise exception 'DMCA_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(version)},'source_md5',${literal(hash)},'new_effects_verified',true,'records_preserved',true,'metadata_preserved',true)release;
commit;\n`;
}
