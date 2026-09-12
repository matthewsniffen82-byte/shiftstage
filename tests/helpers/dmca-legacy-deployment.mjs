import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dmcaMetadataSql,dmcaEffectsSql,dmcaRecordsSql,dmcaLedgerSql} from './dmca-lifecycle-deployment.mjs';
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const names="'dmca_cases','dmca_counter_notices','dmca_strikes'";
const signature='public.review_venue_ownership_claim(uuid,uuid,text,text)';
const replace=(source,from,to)=>{assert.equal(source.split(from).length,2,'Unique permission-guard anchor');return source.replace(from,to);};
let metadata=replace(dmcaMetadataSql,"'acl',p.proacl::text","'acl',case when p.oid=to_regprocedure("+literal(signature)+")then null else p.proacl::text end");
metadata=replace(metadata,"'acl',c.relacl::text","'acl',case when n.nspname='public'and c.relname in("+names+")then null else c.relacl::text end");
metadata=replace(metadata,"'acl',a.attacl::text","'acl',case when n.nspname='public'and c.relname in("+names+")then null else a.attacl::text end");
assert.ok(metadata.startsWith('select ')&&metadata.endsWith(' metadata'));
export const legacyMetadataSql='select ('+metadata.slice(7,-9)+`||jsonb_build_object(
 'dmca_foundation',(${dmcaEffectsSql}),
 'dmca_types',(select jsonb_agg(to_jsonb(t)order by t.oid)from pg_type t where t.typnamespace='public'::regnamespace and t.typname in('dmca_enforcement_states','_dmca_enforcement_states'))
))metadata`;
export const legacyAccessSql=`select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relacl::text,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,
  (select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,c.oid,'SELECT'),'insert',has_table_privilege(r,c.oid,'INSERT'),'update',has_table_privilege(r,c.oid,'UPDATE'),'delete',has_table_privilege(r,c.oid,'DELETE'),'truncate',has_table_privilege(r,c.oid,'TRUNCATE'),'references',has_table_privilege(r,c.oid,'REFERENCES'),'trigger',has_table_privilege(r,c.oid,'TRIGGER')))from unnest(array['anon','authenticated','service_role'])r))order by c.relname)from pg_class c where c.relnamespace='public'::regnamespace and c.relname in(${names})),
 'columns',(select jsonb_agg(jsonb_build_array(c.relname,a.attname,a.attacl::text,
  (select jsonb_object_agg(r,jsonb_build_object('select',has_column_privilege(r,c.oid,a.attnum,'SELECT'),'insert',has_column_privilege(r,c.oid,a.attnum,'INSERT'),'update',has_column_privilege(r,c.oid,a.attnum,'UPDATE'),'references',has_column_privilege(r,c.oid,a.attnum,'REFERENCES')))from unnest(array['anon','authenticated','service_role'])r))order by c.relname,a.attnum)from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relname in(${names})and a.attnum>0 and not a.attisdropped),
 'retired_writer',(select jsonb_build_array(md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef,p.proconfig)from pg_proc p where p.oid=to_regprocedure(${literal(signature)}))
)`;
export const legacySource=readFileSync(new URL('../../supabase/migrations/20260912181237_retire_legacy_case_and_venue_claim_writes.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
export function buildLegacyDeployment({source=legacySource,version,name,before,after,foundation,tables,expectedLedger,expectedMetadataMd5,injected=''}={}){
 assert.match(version,/^\d{14}$/);assert.match(name,/^[a-z][a-z_]+$/);assert.equal(before.tables.length,3);assert.equal(after.tables.length,3);assert.equal(foundation.functions.length,6);
 assert.ok(Array.isArray(expectedLedger)&&expectedLedger.length>0,'An independently captured ledger is required');
 assert.ok(typeof expectedMetadataMd5==='string'&&/^[a-f0-9]{32}$/.test(expectedMetadataMd5),'An independently captured catalog fingerprint is required');
 assert.equal(new Set(expectedLedger.map(row=>row.version)).size,expectedLedger.length,'Duplicate captured ledger entry');
 for(const row of expectedLedger){assert.match(row.version,/^(?:\d{12}|\d{14})$/);if(row.sql_md5!==null)assert.match(row.sql_md5,/^[a-f0-9]{32}$/);}
 source=source.replaceAll('\r\n','\n');assert.ok(source.includes('\nbegin;')&&source.trimEnd().endsWith('commit;'));
 const body=source.replace('\nbegin;','\n').replace(/commit;\s*$/,''),records=dmcaRecordsSql(tables),hash=createHash('md5').update(source).digest('hex');
 // Dollar quoting encloses the entire procedural body, including SQL string
 // literals within it. Choose a marker absent from every embedded input.
 const embedded=JSON.stringify({source,version,name,before,after,foundation,tables,expectedLedger,expectedMetadataMd5,injected})+legacyMetadataSql+legacyAccessSql+dmcaEffectsSql+records;
 let delimiter='$legacy_boundary_guard$',suffix=0;
 while(embedded.includes(delimiter))delimiter='$legacy_boundary_guard_'+(++suffix)+'$';
 return `begin;
set local search_path=pg_catalog,public,pg_temp;set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.dmca_cases,public.dmca_counter_notices,public.dmca_strikes in share row exclusive mode;
do ${delimiter}begin
 if exists(select 1 from supabase_migrations.schema_migrations where version>=${literal(version)})then raise exception 'LEGACY_BOUNDARY_LEDGER_CHANGED';end if;
 if (${dmcaLedgerSql})is distinct from ${literal(JSON.stringify(expectedLedger))}::jsonb then raise exception 'LEGACY_BOUNDARY_CAPTURED_LEDGER_CHANGED';end if;
 if (${dmcaEffectsSql})is distinct from ${literal(JSON.stringify(foundation))}::jsonb then raise exception 'LEGACY_BOUNDARY_FOUNDATION_CHANGED';end if;
 if (${legacyAccessSql})is distinct from ${literal(JSON.stringify(before))}::jsonb then raise exception 'LEGACY_BOUNDARY_ACCESS_DRIFT';end if;
 if md5((${legacyMetadataSql})::text)is distinct from ${literal(expectedMetadataMd5)} then raise exception 'LEGACY_BOUNDARY_CAPTURED_METADATA_CHANGED';end if;
end ${delimiter};
create temporary table legacy_metadata_before on commit drop as ${legacyMetadataSql};
create temporary table legacy_records_before on commit drop as ${records};
${body}
${injected}
do ${delimiter}begin
 if (${legacyAccessSql})is distinct from ${literal(JSON.stringify(after))}::jsonb then raise exception 'LEGACY_BOUNDARY_EFFECTS_CHANGED';end if;
 if (select metadata from legacy_metadata_before)is distinct from(${legacyMetadataSql})then raise exception 'LEGACY_BOUNDARY_UNRELATED_METADATA_CHANGED';end if;
 if (select records from legacy_records_before)is distinct from(${records})then raise exception 'LEGACY_BOUNDARY_RECORDS_CHANGED';end if;
end ${delimiter};
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(version)},${literal(name)},array[${literal(source)}]);
do ${delimiter}begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(version)}and name=${literal(name)}and md5(array_to_string(statements,E'\\n'))=${literal(hash)})then raise exception 'LEGACY_BOUNDARY_LEDGER_MISMATCH';end if;
end ${delimiter};
select jsonb_build_object('version',${literal(version)},'source_md5',${literal(hash)},'records_preserved',true,'metadata_preserved',true,'permissions_verified',true)release;
commit;\n`;
}
