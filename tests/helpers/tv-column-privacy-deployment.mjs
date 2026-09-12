import { createHash } from "node:crypto";
import { slotMetadataSql } from "./profile-video-slot-deployment.mjs";
import { accountLifecycleRecordsSql } from "./account-lifecycle-deployment.mjs";
import { privacyCatalogMetadataSql, privacyGuardDelimiter } from "./privacy-catalog-preservation.mjs";

export const tvPrivacyVersion = "20260912150922";
export const publicTvColumns = ["id","dancer_id","venue_id","shift_id","caption","duration_seconds","width","height","status","venue_tag_status","venue_featured","published_at","expires_at","distribution_scope","like_count","is_pinned"];
export const privateTvColumns = ["submitted_by","storage_path","storage_mime","file_size_bytes","consent_confirmed","rights_confirmed","review_notes","reviewed_by","submitted_at","reviewed_at","created_at","updated_at","moderation_decision","moderation_reason_codes","moderation_category_scores","moderation_provider_flagged","moderation_frame_count","moderation_model","moderation_details","moderation_attempt_count","moderation_started_at","moderation_completed_at"];
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const array = values => "array[" + values.map(literal).join(",") + "]";
const normalizedAcl = (relation, acl) => `case when ${relation}='public.mydancr_tv_videos'::regclass then(select coalesce(jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)order by x.grantor,x.grantee,x.privilege_type,x.is_grantable),'[]'::jsonb)from aclexplode(${acl})x where not(x.privilege_type='SELECT'and x.grantee in(0,'anon'::regrole,'authenticated'::regrole)))else to_jsonb(${acl}::text)end`;
export const tvPrivacyMetadataSql = privacyCatalogMetadataSql(slotMetadataSql
  .replace(" and p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure", "")
  .replace(" and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')", "")
  .replace("'acl',a.attacl::text", "'acl'," + normalizedAcl('a.attrelid','a.attacl'))
  .replace("'acl',c.relacl::text", "'acl'," + normalizedAcl('c.oid','c.relacl')));
if (tvPrivacyMetadataSql.includes("enforce_mydancr_tv_profile_video_limit") || !tvPrivacyMetadataSql.includes("aclexplode")) throw new Error("Unexpected TV privacy catalog template");
export const tvPrivacyTargetSql = `select jsonb_build_object(
  'relation',(select jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl::text)from pg_class where oid='public.mydancr_tv_videos'::regclass),
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl::text,
    'permissions',(select jsonb_object_agg(r,has_column_privilege(r,a.attrelid,a.attname,'SELECT'))from unnest(array['anon','authenticated','service_role'])r))order by a.attnum)
    from pg_attribute a where a.attrelid='public.mydancr_tv_videos'::regclass and a.attnum>0 and not a.attisdropped))`;

const authSql = "select md5(coalesce(string_agg(md5(jsonb_build_array(id,raw_app_meta_data,raw_user_meta_data)::text),''order by id),''))fingerprint from auth.users";
export function buildTvPrivacyDeployment({ source, expectedTarget, expectedMetadata, tables, after = "" }) {
  source = source.replaceAll("\r\n", "\n");
  if (!expectedTarget?.relation?.rls || expectedTarget.columns?.length !== 38) throw new Error("Verified TV column catalog required");
  if (!expectedMetadata || !Object.hasOwn(expectedMetadata, "ledger")) throw new Error("Fresh TV preservation catalog required");
  if (!source.includes("\nbegin;") || !source.trimEnd().endsWith("commit;")) throw new Error("Unexpected TV privacy migration transaction");
  const body = source.replace("\nbegin;", "\n").replace(/commit;\s*$/, "");
  const md5 = createHash("md5").update(source).digest("hex");
  if (!Array.isArray(tables) || !tables.includes("public.mydancr_tv_videos")) throw new Error("TV record preservation relations required");
  const records = accountLifecycleRecordsSql(tables);
  const guardTag = privacyGuardDelimiter(source,after,expectedTarget,expectedMetadata,tvPrivacyMetadataSql,tvPrivacyTargetSql,records);
  return `begin;
set local search_path=pg_catalog,public,pg_temp;set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.mydancr_tv_videos in share row exclusive mode;
do ${guardTag} begin
  if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(tvPrivacyVersion)})then raise exception 'TV_PRIVACY_ALREADY_APPLIED';end if;
  if(${tvPrivacyTargetSql})is distinct from ${literal(JSON.stringify(expectedTarget))}::jsonb then raise exception 'TV_PRIVACY_ACCESS_DRIFT';end if;
  if(${tvPrivacyMetadataSql})is distinct from ${literal(JSON.stringify(expectedMetadata))}::jsonb then raise exception 'TV_PRIVACY_CATALOG_DRIFT';end if;
end ${guardTag};
create temporary table tv_privacy_metadata_before on commit drop as ${tvPrivacyMetadataSql};
create temporary table tv_privacy_records_before on commit drop as ${records};
create temporary table tv_privacy_auth_before on commit drop as ${authSql};
${body}
${after}
;
do ${guardTag} begin
  if(select metadata from tv_privacy_metadata_before)is distinct from(${tvPrivacyMetadataSql})then raise exception 'TV_PRIVACY_METADATA_CHANGED';end if;
  if(select records from tv_privacy_records_before)is distinct from(${records})then raise exception 'TV_PRIVACY_RECORDS_CHANGED';end if;
  if(select fingerprint from tv_privacy_auth_before)is distinct from(${authSql})then raise exception 'TV_PRIVACY_AUTH_CHANGED';end if;
  if exists(select 1 from pg_attribute a cross join unnest(array['anon','authenticated'])r where a.attrelid='public.mydancr_tv_videos'::regclass and a.attnum>0 and not a.attisdropped
    and has_column_privilege(r,a.attrelid,a.attname,'SELECT')is distinct from(a.attname=any(${array(publicTvColumns)})))then raise exception 'TV_PRIVACY_PROJECTION_MISMATCH';end if;
end ${guardTag};
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(tvPrivacyVersion)},'protect_public_tv_moderation_columns',array[${literal(source)}]);
do ${guardTag} begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(tvPrivacyVersion)} and name='protect_public_tv_moderation_columns'
    and md5(array_to_string(statements,E'\\n'))=${literal(md5)})then raise exception 'TV_PRIVACY_LEDGER_MISMATCH';end if;
end ${guardTag};
select jsonb_build_object('version',${literal(tvPrivacyVersion)},'source_md5',${literal(md5)},'records_preserved',true,'metadata_preserved',true,'auth_metadata_preserved',true,'public_columns',16,'private_columns',22)release;
commit;\n`;
}
