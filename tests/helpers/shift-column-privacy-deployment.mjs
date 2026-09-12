import { createHash } from "node:crypto";
import { slotMetadataSql, slotRecordsSql } from "./profile-video-slot-deployment.mjs";

export const shiftPrivacyVersion = "20260912110619";
export const publicShiftColumns = ["id","dancer_id","venue_id","starts_at","ends_at","timezone","status","location_status","checked_in_at","checked_out_at","location_verification_expires_at","shift_date","shift_source"];
export const retiredShiftColumns = ["created_at","updated_at","checkin_distance_feet","last_location_verified_at","working_status","venue_affiliation_id","nfc_tag_id","nfc_last_tapped_at"];
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const array = values => "array[" + values.map(literal).join(",") + "]";
const normalizedColumnAcl = `(select coalesce(jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)
  order by x.grantor,x.grantee,x.privilege_type,x.is_grantable),'[]'::jsonb)from aclexplode(a.attacl)x
  where not(a.attrelid='public.shifts'::regclass and a.attname=any(${array(retiredShiftColumns)})
    and x.privilege_type='SELECT' and x.grantee in(0,'anon'::regrole,'authenticated'::regrole)))`;
export const shiftPrivacyMetadataSql = slotMetadataSql
  .replace(" and p.oid<>'public.enforce_mydancr_tv_profile_video_limit()'::regprocedure", "")
  .replace(" and not(t.tgrelid='public.mydancr_tv_videos'::regclass and t.tgname='enforce_mydancr_tv_profile_video_limit')", "")
  .replace("'acl',a.attacl::text", "'acl'," + normalizedColumnAcl);
if (shiftPrivacyMetadataSql.includes("enforce_mydancr_tv_profile_video_limit") || !shiftPrivacyMetadataSql.includes("aclexplode")) throw new Error("Unexpected shift privacy catalog template");
export const shiftPrivacyTargetSql = `select jsonb_build_object(
  'relation',(select jsonb_build_object('owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl::text)from pg_class where oid='public.shifts'::regclass),
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'acl',a.attacl::text,
    'permissions',(select jsonb_object_agg(r,has_column_privilege(r,a.attrelid,a.attname,'SELECT'))from unnest(array['anon','authenticated','service_role'])r))order by a.attnum)
    from pg_attribute a where a.attrelid='public.shifts'::regclass and a.attnum>0 and not a.attisdropped))`;

export function buildShiftPrivacyDeployment({ source, expectedTarget, after = "" }) {
  source = source.replaceAll("\r\n", "\n");
  if (!expectedTarget?.relation?.rls || expectedTarget.columns?.length !== 38) throw new Error("Verified shift column catalog required");
  if (!source.includes("\nbegin;") || !source.trimEnd().endsWith("commit;")) throw new Error("Unexpected shift privacy migration transaction");
  const body = source.replace("\nbegin;", "\n").replace(/commit;\s*$/, "");
  const md5 = createHash("md5").update(source).digest("hex");
  const records = slotRecordsSql(["public.shifts"]);
  return `begin;
set local search_path=pg_catalog,public,pg_temp;set local lock_timeout='3s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode;
lock table public.shifts in share row exclusive mode;
do $guard$ begin
  if exists(select 1 from supabase_migrations.schema_migrations where version=${literal(shiftPrivacyVersion)})then raise exception 'SHIFT_PRIVACY_ALREADY_APPLIED';end if;
  if(${shiftPrivacyTargetSql})is distinct from ${literal(JSON.stringify(expectedTarget))}::jsonb then raise exception 'SHIFT_PRIVACY_ACCESS_DRIFT';end if;
end $guard$;
create temporary table shift_privacy_metadata_before on commit drop as ${shiftPrivacyMetadataSql};
create temporary table shift_privacy_records_before on commit drop as ${records};
${body}
${after}
do $guard$ begin
  if(select metadata from shift_privacy_metadata_before)is distinct from(${shiftPrivacyMetadataSql})then raise exception 'SHIFT_PRIVACY_METADATA_CHANGED';end if;
  if(select records from shift_privacy_records_before)is distinct from(${records})then raise exception 'SHIFT_PRIVACY_RECORDS_CHANGED';end if;
  if exists(select 1 from pg_attribute a cross join unnest(array['anon','authenticated'])r where a.attrelid='public.shifts'::regclass and a.attnum>0 and not a.attisdropped
    and has_column_privilege(r,a.attrelid,a.attname,'SELECT')is distinct from(a.attname=any(${array(publicShiftColumns)})))then raise exception 'SHIFT_PRIVACY_PROJECTION_MISMATCH';end if;
end $guard$;
insert into supabase_migrations.schema_migrations(version,name,statements)values(${literal(shiftPrivacyVersion)},'minimize_public_shift_location_columns',array[${literal(source)}]);
do $guard$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version=${literal(shiftPrivacyVersion)} and name='minimize_public_shift_location_columns'
    and md5(array_to_string(statements,E'\\n'))=${literal(md5)})then raise exception 'SHIFT_PRIVACY_LEDGER_MISMATCH';end if;
end $guard$;
select jsonb_build_object('version',${literal(shiftPrivacyVersion)},'source_md5',${literal(md5)},'records_preserved',true,'metadata_preserved',true,'public_columns',13,'private_columns',25)release;
commit;\n`;
}
