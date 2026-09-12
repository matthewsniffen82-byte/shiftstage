import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {slotMetadataSql} from './profile-video-slot-deployment.mjs';
import {accountLifecycleRecordsSql} from './account-lifecycle-deployment.mjs';
import {privacyCatalogMetadataSql,privacyGuardDelimiter} from './privacy-catalog-preservation.mjs';
export const ownerPrivacyVersion='20260912150921';
export const ownerPolicyTargets=JSON.parse(readFileSync(new URL('../fixtures/public-owner-policy-current.json',import.meta.url),'utf8')).targets;
export const privateOwnerColumns={venues:['owner_user_id'],dancer_profiles:['user_id','created_at','updated_at','dmca_suspended_at','venue_approved_by_user_id','venue_approved_venue_id','identity_saved_at']};
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const ownedFunctions="array['is_current_venue_owner','is_current_dancer_owner']";
const tables="('public.venues'::regclass,'public.dancer_profiles'::regclass)";
const policyPairs=ownerPolicyTargets.map(p=>'('+literal(p.tablename)+','+literal(p.policyname)+')').join(',');
const ownedPolicy=`p.schemaname='public'and (p.tablename,p.policyname)in(${policyPairs})`;
const privatePairs=Object.entries(privateOwnerColumns).flatMap(([table,cols])=>cols.map(col=>`('public.${table}'::regclass,${literal(col)})`)).join(',');
const normalizedAcl=`case when (a.attrelid,a.attname::text)in(${privatePairs})then(select coalesce(jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)order by x.grantor,x.grantee,x.privilege_type,x.is_grantable),'[]'::jsonb)from aclexplode(a.attacl)x where not(x.privilege_type='SELECT'and x.grantee in(0,'anon'::regrole,'authenticated'::regrole)))else to_jsonb(a.attacl::text)end`;
export const ownerPrivacyMetadataSql=privacyCatalogMetadataSql(slotMetadataSql
 .replace(" and p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure",` and not(n.nspname='public'and p.proname=any(${ownedFunctions}))`)
 .replace(" and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')",'')
 .replace("'acl',a.attacl::text","'acl',"+normalizedAcl)
 .replace('jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname)',`jsonb_agg(case when ${ownedPolicy}then to_jsonb(p)-array['qual','with_check']else to_jsonb(p)end order by p.schemaname,p.tablename,p.policyname)`));
if(ownerPrivacyMetadataSql.includes('enforce_mydancr_tv_profile_video_limit')||!ownerPrivacyMetadataSql.includes("to_jsonb(p)-array['qual','with_check']"))throw Error('Unexpected owner privacy preservation template');
const policySql=`select jsonb_agg(to_jsonb(p)order by p.tablename,p.policyname)from pg_policies p where ${ownedPolicy}`;
const columnSql=`select jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl::text,'permissions',(select jsonb_object_agg(r,has_column_privilege(r,a.attrelid,a.attname,'SELECT'))from unnest(array['anon','authenticated','service_role'])r))order by a.attrelid::regclass::text,a.attnum)from pg_attribute a where a.attrelid in${tables}and a.attnum>0 and not a.attisdropped`;
export const ownerPrivacyTargetSql=`select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text)order by c.relname)from pg_class c where c.oid in${tables}),
 'columns',(${columnSql}),'policies',(${policySql}))`;
export const ownerPrivacyObjectsSql=`select jsonb_build_object('columns',(${columnSql}),'policies',(${policySql}),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'fingerprint',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'))order by p.proname)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=any(${ownedFunctions})))`;
const authSql="select md5(coalesce(string_agg(md5(jsonb_build_array(id,raw_app_meta_data,raw_user_meta_data)::text),''order by id),''))fingerprint from auth.users";
export function buildOwnerPrivacyDeployment({source,expectedTarget,expectedObjects,expectedMetadata,tables:preservedTables,after=''}){
 if(expectedTarget?.relations?.length!==2||expectedTarget.columns?.length!==52||expectedTarget.policies?.length!==43)throw Error('Fresh owner privacy target catalog required');
 if(expectedObjects?.functions?.length!==2||expectedObjects.columns?.length!==52||expectedObjects.policies?.length!==43)throw Error('Verified native owner privacy postconditions required');
 if(!expectedMetadata||!Object.hasOwn(expectedMetadata,'ledger'))throw Error('Fresh owner privacy preservation catalog required');
 source=source.replaceAll('\r\n','\n');if(!source.includes('\nbegin;')||!source.trimEnd().endsWith('commit;'))throw Error('Unexpected owner privacy transaction source');
 const body=source.replace('\nbegin;','\n').replace(/commit;\s*$/,''),md5=createHash('md5').update(source).digest('hex'),records=accountLifecycleRecordsSql(preservedTables);
 const lockTables=[...new Set([...ownerPolicyTargets.map(p=>p.tablename),'venues','dancer_profiles'])].sort().map(table=>'public."'+table+'"').join(',');
 const guardTag=privacyGuardDelimiter(source,after,expectedTarget,expectedObjects,expectedMetadata,ownerPrivacyMetadataSql,ownerPrivacyTargetSql,ownerPrivacyObjectsSql,records,lockTables);
 return `begin;
set local search_path=pg_catalog,public,pg_temp;set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table ${lockTables} in share row exclusive mode;
do ${guardTag} begin
 if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(ownerPrivacyVersion)})then raise exception 'OWNER_PRIVACY_ALREADY_APPLIED';end if;
 if(${ownerPrivacyTargetSql})is distinct from ${literal(JSON.stringify(expectedTarget))}::jsonb then raise exception 'OWNER_PRIVACY_TARGET_DRIFT';end if;
 if(${ownerPrivacyMetadataSql})is distinct from ${literal(JSON.stringify(expectedMetadata))}::jsonb then raise exception 'OWNER_PRIVACY_CATALOG_DRIFT';end if;
end ${guardTag};
create temporary table owner_privacy_metadata_before on commit drop as ${ownerPrivacyMetadataSql};
create temporary table owner_privacy_records_before on commit drop as ${records};
create temporary table owner_privacy_auth_before on commit drop as ${authSql};
${body}
${after}
;
do ${guardTag} begin
 if(${ownerPrivacyObjectsSql})is distinct from ${literal(JSON.stringify(expectedObjects))}::jsonb then raise exception 'OWNER_PRIVACY_OBJECT_MISMATCH';end if;
 if(select metadata from owner_privacy_metadata_before)is distinct from(${ownerPrivacyMetadataSql})then raise exception 'OWNER_PRIVACY_METADATA_CHANGED';end if;
 if(select records from owner_privacy_records_before)is distinct from(${records})then raise exception 'OWNER_PRIVACY_RECORDS_CHANGED';end if;
 if(select fingerprint from owner_privacy_auth_before)is distinct from(${authSql})then raise exception 'OWNER_PRIVACY_AUTH_CHANGED';end if;
end ${guardTag};
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(ownerPrivacyVersion)},'hide_public_account_identifiers',array[${literal(source)}]);
do ${guardTag} begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(ownerPrivacyVersion)}and name='hide_public_account_identifiers'and md5(array_to_string(statements,E'\\n'))=${literal(md5)})then raise exception 'OWNER_PRIVACY_LEDGER_MISMATCH';end if;
end ${guardTag};
select jsonb_build_object('version',${literal(ownerPrivacyVersion)},'source_md5',${literal(md5)},'metadata_preserved',true,'records_preserved',true,'auth_metadata_preserved',true,'policies',43,'functions',2)release;
commit;
`;
}
