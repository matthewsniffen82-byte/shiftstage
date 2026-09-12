import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const schema=JSON.parse(readFileSync(new URL('../fixtures/profile-video-slot-schema.json',import.meta.url),'utf8'));
export const slotSignature='public.enforce_mydancr_tv_profile_video_limit()';
export const slotVersion='20260912052200';
export const oldSlotFingerprint='93f69eb8ee43fe394349521fb3cf25ab';
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const digest=s=>createHash('md5').update(s).digest('hex');
const namespace="n.nspname in ('public','auth','storage')";
export const slotTargetSql=`select jsonb_build_object(
 'columns',(select jsonb_agg(jsonb_build_array(column_name,ordinal_position,udt_schema,udt_name,is_nullable,column_default,is_identity,is_generated) order by ordinal_position)from information_schema.columns where table_schema='public' and table_name='mydancr_tv_videos'),
 'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid),convalidated) order by conname)from pg_constraint where conrelid='public.mydancr_tv_videos'::regclass and contype<>'n'),
 'indexes',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) order by c.relname)from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid='public.mydancr_tv_videos'::regclass),
 'triggers',(select jsonb_agg(jsonb_build_array(tgname,pg_get_triggerdef(oid),tgenabled) order by tgname)from pg_trigger where tgrelid='public.mydancr_tv_videos'::regclass and not tgisinternal and tgname<>'enforce_mydancr_tv_profile_video_limit')
)`;
export const expectedSlotTarget={
 columns:schema.columns.map(c=>[c.column_name,c.ordinal_position,c.udt_schema,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.is_generated]),
 constraints:schema.constraints.map(c=>[c.name,c.definition,c.validated]),
 indexes:schema.indexes.map(i=>[i.indexname,i.indexdef,i.indisvalid,i.indisready]),
 triggers:schema.triggers.map(t=>[t.name,t.definition,t.enabled]),
};
// Ignore exactly the replacement body and new attachment. Their complete
// postconditions are checked separately; all other captured metadata must match.
export const slotMetadataSql=`select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('id',p.oid::regprocedure::text,'definition',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'owner',p.proowner,'settings',p.proconfig,'definer',p.prosecdef) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${namespace} and p.prokind='f' and p.oid<>'${slotSignature}'::regprocedure),
 'relations',(select jsonb_agg(jsonb_build_object('id',c.oid::regclass::text,'kind',c.relkind,'owner',c.relowner,'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'options',c.reloptions) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${namespace} and c.relkind in ('r','p','v','m','f','S')),
 'columns',(select jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'name',a.attname,'num',a.attnum,'type',a.atttypid,'mod',a.atttypmod,'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where ${namespace} and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) order by c.oid) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where ${namespace}),
 'indexes',(select jsonb_agg(jsonb_build_object('table',i.indrelid::regclass::text,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) order by i.indexrelid) from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where ${namespace}),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname) from pg_policies p where p.schemaname in ('public','auth','storage')),
 'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${namespace} and not t.tgisinternal and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')),
 'views',(select jsonb_agg(to_jsonb(v) order by v.schemaname,v.viewname)from pg_views v where v.schemaname in ('public','auth','storage')),
 'event_triggers',(select jsonb_agg(to_jsonb(e) order by e.oid) from pg_event_trigger e),
 'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'create_role',rolcreaterole,'create_db',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass',rolbypassrls,'config',rolconfig) order by rolname)from pg_roles),
 'memberships',(select jsonb_agg(to_jsonb(m) order by m.roleid,m.member) from pg_auth_members m),
 'ledger',(select jsonb_agg(to_jsonb(m) order by m.version) from supabase_migrations.schema_migrations m)
) metadata`;

export function slotRecordsSql(tables){
 if(tables.some(t=>!/^((public|storage)\.)[a-z_]+$/.test(t)))throw new Error('Invalid preservation relation');
 return 'select jsonb_build_object('+tables.map(t=>literal(t)+",(select jsonb_build_object('count',count(*),'fingerprint',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),''))) from "+t+' r)').join(',')+') records';
}

export function buildSlotDeployment({source,newFingerprint,tables,between='',after='',targetSnapshot=expectedSlotTarget}={}){
 if(!/^[0-9a-f]{32}$/.test(newFingerprint))throw new Error('Missing verified new definition fingerprint');
 source=source.replaceAll('\r\n','\n');
 if(!/\nbegin;/.test(source)||!source.trimEnd().endsWith('commit;'))throw new Error('Unexpected transaction source');
 const body=source.replace(/\nbegin;/,'\n').replace(/commit;\s*$/,'');
 const records=slotRecordsSql(tables);
 return `begin;
set local search_path = pg_catalog, public, pg_temp;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.mydancr_tv_videos in share row exclusive mode;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(slotVersion)}) then raise exception 'SLOT_RELEASE_ALREADY_APPLIED'; end if;
 if (select md5(pg_get_functiondef('${slotSignature}'::regprocedure))) is distinct from ${literal(oldSlotFingerprint)} then raise exception 'SLOT_RELEASE_DEFINITION_DRIFT'; end if;
 if not exists(select 1 from pg_proc p where p.oid='${slotSignature}'::regprocedure and not p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}' and p.proconfig=array['search_path=public, pg_temp']) then raise exception 'SLOT_RELEASE_ACCESS_DRIFT'; end if;
 if exists(select 1 from pg_trigger where tgrelid='public.mydancr_tv_videos'::regclass and tgname='enforce_mydancr_tv_profile_video_limit') then raise exception 'SLOT_RELEASE_UNEXPECTED_ATTACHMENT'; end if;
 if not exists(select 1 from pg_class where oid='public.mydancr_tv_videos'::regclass and relrowsecurity and not relforcerowsecurity and pg_get_userbyid(relowner)='postgres') then raise exception 'SLOT_RELEASE_RELATION_DRIFT'; end if;
 if has_table_privilege('anon','public.mydancr_tv_videos','INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.mydancr_tv_videos','INSERT,UPDATE,DELETE') then raise exception 'SLOT_RELEASE_TABLE_ACCESS_DRIFT'; end if;
 if (${slotTargetSql}) is distinct from ${literal(JSON.stringify(targetSnapshot))}::jsonb then raise exception 'SLOT_RELEASE_SCHEMA_DRIFT'; end if;
end $guard$;
create temporary table slot_release_metadata_before on commit drop as ${slotMetadataSql};
create temporary table slot_release_records_before on commit drop as ${records};
${between}
${body}
${after}
do $guard$ begin
 if (select md5(pg_get_functiondef('${slotSignature}'::regprocedure))) is distinct from ${literal(newFingerprint)} then raise exception 'SLOT_RELEASE_NEW_DEFINITION_MISMATCH'; end if;
 if not exists(select 1 from pg_proc p where p.oid='${slotSignature}'::regprocedure and not p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proacl::text='{postgres=X/postgres}' and p.proconfig=array['search_path=pg_catalog, public, pg_temp']) then raise exception 'SLOT_RELEASE_NEW_ACCESS_MISMATCH'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.mydancr_tv_videos'::regclass and tgname='enforce_mydancr_tv_profile_video_limit' and not tgisinternal and tgenabled='O' and tgtype=21 and tgattr='2 36 13'::int2vector and tgfoid='${slotSignature}'::regprocedure and tgqual is null) then raise exception 'SLOT_RELEASE_ATTACHMENT_MISMATCH'; end if;
 if (select metadata from slot_release_metadata_before) is distinct from (${slotMetadataSql}) then raise exception 'SLOT_RELEASE_METADATA_CHANGED'; end if;
 if (select records from slot_release_records_before) is distinct from (${records}) then raise exception 'SLOT_RELEASE_RECORDS_CHANGED'; end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(slotVersion)},'enforce_profile_video_slot_limit',array[${literal(source)}]);
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(slotVersion)} and name='enforce_profile_video_slot_limit' and md5(array_to_string(statements,E'\\n'))=${literal(digest(source))}) then raise exception 'SLOT_RELEASE_LEDGER_MISMATCH'; end if;
end $guard$;
select jsonb_build_object('version',${literal(slotVersion)},'source_md5',${literal(digest(source))},'function_fingerprint',${literal(newFingerprint)},'records_preserved',true,'metadata_preserved',true) release;
commit;
`;
}
