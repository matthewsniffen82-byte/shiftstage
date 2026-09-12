import { createHash } from "node:crypto";
import { slotMetadataSql, slotRecordsSql } from "./profile-video-slot-deployment.mjs";

export const dealColumnVersion = "20260912103000";
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const permittedGrant = "x.privilege_type='SELECT' and x.grantee in (0,'anon'::regrole,'authenticated'::regrole)";
function aclSql(acl, target) {
  return `(select coalesce(jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)
    order by x.grantor,x.grantee,x.privilege_type,x.is_grantable),'[]'::jsonb)
    from aclexplode(${acl}) x where not (${target} and ${permittedGrant}))`;
}
// Preserve the complete catalog except SELECT grants to the three browser roles
// on this one table. Exact public/private effective SELECT is checked separately.
export const dealColumnMetadataSql = slotMetadataSql
  .replace(" and p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure", "")
  .replace(" and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')", "")
  .replace("'acl',c.relacl::text", "'acl'," + aclSql("coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::\"char\" else 'r'::\"char\" end,c.relowner))", "c.oid='public.club_deals'::regclass"))
  .replace("'acl',a.attacl::text", "'acl'," + aclSql("a.attacl", "a.attrelid='public.club_deals'::regclass"));
if (dealColumnMetadataSql.includes("enforce_mydancr_tv_profile_video_limit") || !dealColumnMetadataSql.includes("from aclexplode")) throw new Error("Unexpected catalog preservation template");

export const dealColumnTargetSql = `select jsonb_build_object(
  'relation',(select jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.club_deals'::regclass),
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl::text,
    'permissions',(select jsonb_object_agg(r,has_column_privilege(r,a.attrelid,a.attname,'SELECT')) from unnest(array['anon','authenticated','service_role'])r)) order by a.attnum)
    from pg_attribute a where a.attrelid='public.club_deals'::regclass and a.attnum>0 and not a.attisdropped)
)`;

export function buildDealColumnDeployment({ source, expectedTarget, after = "" }) {
  source = source.replaceAll("\r\n", "\n");
  if (!expectedTarget?.relation?.rls || expectedTarget.columns?.length !== 19) throw new Error("Verified deal column catalog required");
  if (!source.includes("\nbegin;") || !source.trimEnd().endsWith("commit;")) throw new Error("Unexpected column migration transaction");
  const body = source.replace("\nbegin;", "\n").replace(/commit;\s*$/, "");
  const md5 = createHash("md5").update(source).digest("hex");
  const records = slotRecordsSql(["public.club_deals"]);
  return `begin;
set local search_path=pg_catalog,public,pg_temp;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.club_deals in share row exclusive mode;
do $guard$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(dealColumnVersion)})then raise exception 'DEAL_COLUMNS_ALREADY_APPLIED';end if;
  if (${dealColumnTargetSql})is distinct from ${literal(JSON.stringify(expectedTarget))}::jsonb then raise exception 'DEAL_COLUMNS_ACCESS_DRIFT';end if;
end $guard$;
create temporary table deal_columns_metadata_before on commit drop as ${dealColumnMetadataSql};
create temporary table deal_columns_records_before on commit drop as ${records};
${body}
${after}
do $guard$ begin
  if(select metadata from deal_columns_metadata_before)is distinct from(${dealColumnMetadataSql})then raise exception 'DEAL_COLUMNS_METADATA_CHANGED';end if;
  if(select records from deal_columns_records_before)is distinct from(${records})then raise exception 'DEAL_COLUMNS_RECORDS_CHANGED';end if;
  if exists(select 1 from pg_attribute a cross join unnest(array['anon','authenticated'])r
    where a.attrelid='public.club_deals'::regclass and a.attnum>0 and not a.attisdropped
    and has_column_privilege(r,a.attrelid,a.attname,'SELECT') is distinct from (a.attname=any(array['id','venue_id','deal_title','deal_description','deal_terms','is_active','valid_days','valid_start_time','valid_end_time','offer_type','booking_url','sort_order'])))
  then raise exception 'DEAL_COLUMNS_PROJECTION_MISMATCH';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(dealColumnVersion)},'minimize_public_deal_columns',array[${literal(source)}]);
do $guard$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(dealColumnVersion)} and name='minimize_public_deal_columns'
    and md5(array_to_string(statements,E'\\n'))=${literal(md5)})then raise exception 'DEAL_COLUMNS_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(dealColumnVersion)},'source_md5',${literal(md5)},'records_preserved',true,'metadata_preserved',true,'public_columns',12,'private_columns',7)release;
commit;\n`;
}
