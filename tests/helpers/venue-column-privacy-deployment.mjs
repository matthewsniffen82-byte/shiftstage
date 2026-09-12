import { createHash } from "node:crypto";
import { slotMetadataSql, slotRecordsSql } from "./profile-video-slot-deployment.mjs";

export const venuePrivacyVersion = "20260912123000";
export const publicVenueColumns = ["id","name","slug","city","state","address","phone","website","timezone","opens_at","closes_at","is_active","latitude","longitude","cover_image_storage_path","cover_image_updated_at","published_at","logo_storage_path","logo_updated_at","owner_user_id"];
export const privateVenueColumns = ["created_at","updated_at","qr_code_storage_path","qr_code_label","qr_code_updated_at","page_review_status","page_review_sent_at","page_reviewed_at","page_reviewed_by_user_id","page_review_notes"];
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const array = values => "array[" + values.map(literal).join(",") + "]";
const normalizedAcl = (relation, acl) => `case when ${relation}='public.venues'::regclass then(select coalesce(jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)order by x.grantor,x.grantee,x.privilege_type,x.is_grantable),'[]'::jsonb)from aclexplode(${acl})x where not(x.privilege_type='SELECT'and x.grantee in(0,'anon'::regrole,'authenticated'::regrole)))else to_jsonb(${acl}::text)end`;
export const venuePrivacyMetadataSql = slotMetadataSql
  .replace(" and p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure", "")
  .replace(" and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')", "")
  .replace("'acl',a.attacl::text", "'acl'," + normalizedAcl('a.attrelid','a.attacl'))
  .replace("'acl',c.relacl::text", "'acl'," + normalizedAcl('c.oid','c.relacl'));
if (venuePrivacyMetadataSql.includes("enforce_mydancr_tv_profile_video_limit") || !venuePrivacyMetadataSql.includes("aclexplode")) throw new Error("Unexpected venue privacy catalog template");
export const venuePrivacyTargetSql = `select jsonb_build_object(
  'relation',(select jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl::text)from pg_class where oid='public.venues'::regclass),
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl::text,
    'permissions',(select jsonb_object_agg(r,has_column_privilege(r,a.attrelid,a.attname,'SELECT'))from unnest(array['anon','authenticated','service_role'])r))order by a.attnum)
    from pg_attribute a where a.attrelid='public.venues'::regclass and a.attnum>0 and not a.attisdropped))`;

export function buildVenuePrivacyDeployment({ source, expectedTarget, after = "" }) {
  source = source.replaceAll("\r\n", "\n");
  if (!expectedTarget?.relation?.rls || expectedTarget.columns?.length !== 30) throw new Error("Verified venue column catalog required");
  if (!source.includes("\nbegin;") || !source.trimEnd().endsWith("commit;")) throw new Error("Unexpected venue privacy migration transaction");
  const body = source.replace("\nbegin;", "\n").replace(/commit;\s*$/, "");
  const md5 = createHash("md5").update(source).digest("hex");
  const records = slotRecordsSql(["public.venues"]);
  return `begin;
set local search_path=pg_catalog,public,pg_temp;set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.venues in share row exclusive mode;
do $guard$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(venuePrivacyVersion)})then raise exception 'VENUE_PRIVACY_ALREADY_APPLIED';end if;
  if(${venuePrivacyTargetSql})is distinct from ${literal(JSON.stringify(expectedTarget))}::jsonb then raise exception 'VENUE_PRIVACY_ACCESS_DRIFT';end if;
end $guard$;
create temporary table venue_privacy_metadata_before on commit drop as ${venuePrivacyMetadataSql};
create temporary table venue_privacy_records_before on commit drop as ${records};
${body}
${after}
do $guard$ begin
  if(select metadata from venue_privacy_metadata_before)is distinct from(${venuePrivacyMetadataSql})then raise exception 'VENUE_PRIVACY_METADATA_CHANGED';end if;
  if(select records from venue_privacy_records_before)is distinct from(${records})then raise exception 'VENUE_PRIVACY_RECORDS_CHANGED';end if;
  if exists(select 1 from pg_attribute a cross join unnest(array['anon','authenticated'])r where a.attrelid='public.venues'::regclass and a.attnum>0 and not a.attisdropped
    and has_column_privilege(r,a.attrelid,a.attname,'SELECT')is distinct from(a.attname=any(${array(publicVenueColumns)})))then raise exception 'VENUE_PRIVACY_PROJECTION_MISMATCH';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(venuePrivacyVersion)},'minimize_public_venue_review_columns',array[${literal(source)}]);
do $guard$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(venuePrivacyVersion)} and name='minimize_public_venue_review_columns'
    and md5(array_to_string(statements,E'\\n'))=${literal(md5)})then raise exception 'VENUE_PRIVACY_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(venuePrivacyVersion)},'source_md5',${literal(md5)},'records_preserved',true,'metadata_preserved',true,'public_columns',20,'private_columns',10)release;
commit;\n`;
}
