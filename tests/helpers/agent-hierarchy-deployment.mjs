import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
import{slotMetadataSql,slotRecordsSql}from'./profile-video-slot-deployment.mjs';
const schema=JSON.parse(readFileSync(new URL('../fixtures/agent-hierarchy-schema.json',import.meta.url),'utf8'));
export const agentVersion='20260912063000';
export const agentLockSignature='public.lock_sales_agent_hierarchy_writes()';
export const agentReplaced=schema.functions.filter(f=>['assign_admin_venue_sales_agent','attribute_approved_venue_agent_referral'].includes(f.name));
const signatures=[agentLockSignature,...agentReplaced.map(f=>'public.'+f.signature)];
const literal=s=>s===null?'null':"'"+s.replaceAll("'","''")+"'";
const metadata=slotMetadataSql.replace("p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure",'p.oid not in('+signatures.map(s=>'coalesce(to_regprocedure('+literal(s)+'),0)').join(',')+')')
 .replace("t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit'","t.tgrelid='public.sales_agents'::regclass and t.tgname='lock_sales_agent_hierarchy_writes'");
if(metadata===slotMetadataSql||metadata.includes('enforce_mydancr_tv_profile_video_limit'))throw new Error('Unexpected agent metadata template');
const names=schema.relations.map(t=>literal(t.name)).join(',');const relations=schema.relations.map(t=>literal('public.'+t.name)+'::regclass').join(',');
export const agentTargetSql=`select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_array(c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,(select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE')))from unnest(array['anon','authenticated','service_role'])r))order by c.relname)from pg_class c where c.oid in(${relations})),
 'columns',(select jsonb_agg(jsonb_build_array(table_name,column_name,ordinal_position,udt_schema,udt_name,is_nullable,column_default,is_identity,is_generated)order by table_name,ordinal_position)from information_schema.columns where table_schema='public'and table_name in(${names})),
 'constraints',(select jsonb_agg(jsonb_build_array(c.relname,p.conname,pg_get_constraintdef(p.oid),p.convalidated)order by c.relname,p.conname)from pg_constraint p join pg_class c on c.oid=p.conrelid where p.conrelid in(${relations})and p.contype<>'n'),
 'indexes',(select jsonb_agg(jsonb_build_array(t.relname,c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)order by t.relname,c.relname)from pg_index i join pg_class c on c.oid=i.indexrelid join pg_class t on t.oid=i.indrelid where i.indrelid in(${relations})),
 'policies',(select jsonb_agg(to_jsonb(p)order by tablename,policyname)from pg_policies p where schemaname='public'and tablename in(${names})),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled)order by c.relname,t.tgname),'[]')from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in(${relations})and not t.tgisinternal and t.tgname<>'lock_sales_agent_hierarchy_writes')
)`;
const target={relations:schema.relations.map(t=>[t.name,t.owner,t.rls,t.force_rls,t.grants]),columns:schema.columns.map(c=>[c.table_name,c.column_name,c.ordinal_position,c.udt_schema,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.is_generated]),constraints:schema.constraints.map(c=>[c.table_name,c.name,c.definition,c.validated]),indexes:schema.indexes.map(i=>[i.tablename,i.indexname,i.indexdef,i.indisvalid,i.indisready]),policies:schema.policies,triggers:schema.triggers.filter(t=>schema.relations.some(r=>r.name===t.table_name)).map(t=>[t.table_name,t.name,t.definition,t.enabled])};
export function buildAgentDeployment({source,fingerprints,tables,after=''}={}){
 for(const signature of signatures)if(!/^[0-9a-f]{32}$/.test(fingerprints?.[signature]||''))throw new Error('Missing native function fingerprint: '+signature);
 source=source.replaceAll('\r\n','\n');if(!source.includes('\nbegin;')||!source.trimEnd().endsWith('commit;'))throw new Error('Unexpected migration source');
 const body=source.replace('\nbegin;','\n').replace(/commit;\s*$/,'');const records=slotRecordsSql(tables),sourceMd5=createHash('md5').update(source).digest('hex');
 return `begin;
set local search_path=pg_catalog,public,pg_temp;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.sales_agents,public.venue_sales_attributions,public.venue_signup_requests in share row exclusive mode;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(agentVersion)})then raise exception 'AGENT_GRAPH_ALREADY_APPLIED';end if;
 if to_regprocedure('${agentLockSignature}')is not null then raise exception 'AGENT_GRAPH_UNEXPECTED_FUNCTION';end if;
 if exists(select 1 from pg_trigger where tgrelid='public.sales_agents'::regclass and tgname='lock_sales_agent_hierarchy_writes')then raise exception 'AGENT_GRAPH_UNEXPECTED_ATTACHMENT';end if;
 if (${agentTargetSql})is distinct from ${literal(JSON.stringify(target))}::jsonb then raise exception 'AGENT_GRAPH_SCHEMA_ACCESS_DRIFT';end if;
 ${schema.functions.map(f=>`if not exists(select 1 from pg_proc p where p.oid='public.${f.signature}'::regprocedure and md5(pg_get_functiondef(p.oid))=${literal(f.fingerprint)} and pg_get_userbyid(p.proowner)=${literal(f.owner)} and p.proacl::text is not distinct from ${literal(f.acl)})then raise exception 'AGENT_GRAPH_DEPENDENCY_DRIFT';end if;`).join('\n')}
 ${schema.triggers.filter(t=>t.table_name==='venue_signup_requests').map(t=>`if not exists(select 1 from pg_trigger where tgrelid='public.venue_signup_requests'::regclass and tgname=${literal(t.name)} and pg_get_triggerdef(oid)=${literal(t.definition)} and tgenabled='O')then raise exception 'AGENT_GRAPH_APPROVAL_ATTACHMENT_DRIFT';end if;`).join('\n')}
end $guard$;
create temporary table agent_graph_metadata_before on commit drop as ${metadata};
create temporary table agent_graph_records_before on commit drop as ${records};
${body}
${after}
do $guard$ begin
 if not exists(select 1 from pg_proc p where p.oid='${agentLockSignature}'::regprocedure and md5(pg_get_functiondef(p.oid))=${literal(fingerprints[agentLockSignature])} and pg_get_userbyid(p.proowner)='postgres' and not p.prosecdef and p.proacl::text='{postgres=X/postgres}' and p.proconfig=array['search_path=pg_catalog, public, pg_temp','lock_timeout=3s'])then raise exception 'AGENT_GRAPH_LOCK_FUNCTION_MISMATCH';end if;
 ${agentReplaced.map(f=>`if not exists(select 1 from pg_proc p where p.oid='public.${f.signature}'::regprocedure and md5(pg_get_functiondef(p.oid))=${literal(fingerprints['public.'+f.signature])} and pg_get_userbyid(p.proowner)=${literal(f.owner)} and p.proacl::text is not distinct from ${literal(f.acl)} and p.prosecdef and p.proconfig=array['search_path=public, pg_temp'])then raise exception 'AGENT_GRAPH_CALLER_MISMATCH';end if;`).join('\n')}
 if not exists(select 1 from pg_trigger where tgrelid='public.sales_agents'::regclass and tgname='lock_sales_agent_hierarchy_writes'and not tgisinternal and tgenabled='O'and tgtype=22 and tgattr='3 4 5'::int2vector and tgfoid='${agentLockSignature}'::regprocedure and tgqual is null)then raise exception 'AGENT_GRAPH_ATTACHMENT_MISMATCH';end if;
 if(select metadata from agent_graph_metadata_before)is distinct from(${metadata})then raise exception 'AGENT_GRAPH_METADATA_CHANGED';end if;
 if(select records from agent_graph_records_before)is distinct from(${records})then raise exception 'AGENT_GRAPH_RECORDS_CHANGED';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(agentVersion)},'serialize_sales_agent_hierarchy',array[${literal(source)}]);
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(agentVersion)}and name='serialize_sales_agent_hierarchy'and md5(array_to_string(statements,E'\\n'))=${literal(sourceMd5)})then raise exception 'AGENT_GRAPH_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(agentVersion)},'source_md5',${literal(sourceMd5)},'function_fingerprints',${literal(JSON.stringify(fingerprints))}::jsonb,'records_preserved',true,'metadata_preserved',true)release;
commit;\n`;
}
