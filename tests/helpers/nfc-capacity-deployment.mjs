import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
import{slotMetadataSql,slotRecordsSql}from'./profile-video-slot-deployment.mjs';
const schema=JSON.parse(readFileSync(new URL('../fixtures/nfc-capacity-schema.json',import.meta.url),'utf8'));
export const nfcCapacitySignature='public.enforce_active_venue_nfc_capacity()';
export const nfcCapacityVersion='20260912054100';
const literal=s=>s===null?'null':"'"+s.replaceAll("'","''")+"'";
// Reuse the already rehearsed catalog capture. Exclude only this release's
// new function/attachment; the previous video correction is preserved too.
const metadata=slotMetadataSql
 .replace("p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure",`p.oid<>coalesce(to_regprocedure('${nfcCapacitySignature}'),0)`)
 .replace("t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit'","t.tgrelid='public.nfc_tags'::regclass and t.tgname='enforce_active_venue_nfc_capacity'");
if(metadata===slotMetadataSql||metadata.includes('enforce_mydancr_tv_profile_video_limit'))throw new Error('Unexpected catalog template');
export const nfcCapacityTargetSql=`select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,(select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE')))from unnest(array['anon','authenticated','service_role'])r))order by c.relname)from pg_class c where c.oid in('public.nfc_tags'::regclass,'public.admin_actions'::regclass)),
 'columns',(select jsonb_agg(jsonb_build_array(table_name,column_name,ordinal_position,udt_schema,udt_name,is_nullable,column_default,is_identity,is_generated) order by table_name,ordinal_position)from information_schema.columns where table_schema='public' and table_name in('nfc_tags','admin_actions')),
 'constraints',(select jsonb_agg(jsonb_build_array(c.relname,p.conname,pg_get_constraintdef(p.oid),p.convalidated) order by c.relname,p.conname)from pg_constraint p join pg_class c on c.oid=p.conrelid where p.conrelid in('public.nfc_tags'::regclass,'public.admin_actions'::regclass)and p.contype<>'n'),
 'indexes',(select jsonb_agg(jsonb_build_array(t.relname,c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)order by t.relname,c.relname)from pg_index i join pg_class c on c.oid=i.indexrelid join pg_class t on t.oid=i.indrelid where i.indrelid in('public.nfc_tags'::regclass,'public.admin_actions'::regclass)),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname)from pg_policies p where schemaname='public' and tablename in('nfc_tags','admin_actions')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled)order by c.relname,t.tgname),'[]')from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in('public.nfc_tags'::regclass,'public.admin_actions'::regclass)and not t.tgisinternal and t.tgname<>'enforce_active_venue_nfc_capacity')
)`;
const target={relations:schema.relations.map(t=>[t.name,t.owner,t.rls,t.force_rls,t.grants]),columns:schema.columns.map(c=>[c.table_name,c.column_name,c.ordinal_position,c.udt_schema,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.is_generated]),constraints:schema.constraints.map(c=>[c.table_name,c.name,c.definition,c.validated]),indexes:schema.indexes.map(i=>[i.tablename,i.indexname,i.indexdef,i.indisvalid,i.indisready]),policies:schema.policies,triggers:schema.triggers.map(t=>[t.table_name,t.name,t.definition,t.enabled])};
export function buildNfcCapacityDeployment({source,newFingerprint,tables,after=''}={}){
 if(!/^[0-9a-f]{32}$/.test(newFingerprint))throw new Error('Missing native function fingerprint');
 source=source.replaceAll('\r\n','\n');if(!source.includes('\nbegin;')||!source.trimEnd().endsWith('commit;'))throw new Error('Unexpected migration source');
 const body=source.replace('\nbegin;','\n').replace(/commit;\s*$/,'');const records=slotRecordsSql(tables);const sourceMd5=createHash('md5').update(source).digest('hex');
 return `begin;
set local search_path=pg_catalog,public,pg_temp;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.nfc_tags in share row exclusive mode;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(nfcCapacityVersion)})then raise exception 'NFC_CAPACITY_ALREADY_APPLIED';end if;
 if to_regprocedure('${nfcCapacitySignature}')is not null then raise exception 'NFC_CAPACITY_UNEXPECTED_FUNCTION';end if;
 if exists(select 1 from pg_trigger where tgrelid='public.nfc_tags'::regclass and tgname='enforce_active_venue_nfc_capacity')then raise exception 'NFC_CAPACITY_UNEXPECTED_ATTACHMENT';end if;
 if (${nfcCapacityTargetSql})is distinct from ${literal(JSON.stringify(target))}::jsonb then raise exception 'NFC_CAPACITY_SCHEMA_ACCESS_DRIFT';end if;
 ${schema.functions.map(f=>`if not exists(select 1 from pg_proc p where p.oid='public.${f.signature}'::regprocedure and md5(pg_get_functiondef(p.oid))=${literal(f.fingerprint)} and pg_get_userbyid(p.proowner)=${literal(f.owner)} and p.proacl::text is not distinct from ${literal(f.acl)})then raise exception 'NFC_CAPACITY_DEPENDENCY_DRIFT';end if;`).join('\n')}
end $guard$;
create temporary table nfc_capacity_metadata_before on commit drop as ${metadata};
create temporary table nfc_capacity_records_before on commit drop as ${records};
${body}
${after}
do $guard$ begin
 if not exists(select 1 from pg_proc p where p.oid='${nfcCapacitySignature}'::regprocedure and md5(pg_get_functiondef(p.oid))=${literal(newFingerprint)} and pg_get_userbyid(p.proowner)='postgres' and not p.prosecdef and p.proacl::text='{postgres=X/postgres}' and p.proconfig=array['search_path=pg_catalog, public, pg_temp'])then raise exception 'NFC_CAPACITY_FUNCTION_MISMATCH';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.nfc_tags'::regclass and tgname='enforce_active_venue_nfc_capacity'and not tgisinternal and tgenabled='O' and tgtype=21 and tgattr='2 6'::int2vector and tgfoid='${nfcCapacitySignature}'::regprocedure and tgqual is null)then raise exception 'NFC_CAPACITY_ATTACHMENT_MISMATCH';end if;
 if(select metadata from nfc_capacity_metadata_before)is distinct from(${metadata})then raise exception 'NFC_CAPACITY_METADATA_CHANGED';end if;
 if(select records from nfc_capacity_records_before)is distinct from(${records})then raise exception 'NFC_CAPACITY_RECORDS_CHANGED';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(nfcCapacityVersion)},'enforce_active_nfc_sticker_capacity',array[${literal(source)}]);
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(nfcCapacityVersion)} and name='enforce_active_nfc_sticker_capacity' and md5(array_to_string(statements,E'\\n'))=${literal(sourceMd5)})then raise exception 'NFC_CAPACITY_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(nfcCapacityVersion)},'source_md5',${literal(sourceMd5)},'function_fingerprint',${literal(newFingerprint)},'records_preserved',true,'metadata_preserved',true)release;
commit;\n`;
}
