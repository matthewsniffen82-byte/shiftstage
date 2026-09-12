-- Allocate signup links without taking a current or retained link from another dancer.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.unique_dancer_slug(stage_name text, user_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
set lock_timeout = '3s'
as $function$
declare
  base_slug text;
  candidate text;
  suffix integer := 0;
begin
  -- Use the assignment trigger's existing lock before reading either link registry.
  -- VOLATILE gives the reads a fresh snapshot after a competing signup commits.
  perform pg_catalog.pg_advisory_xact_lock(7682451001::bigint);
  base_slug := public.slugify(stage_name);
  if base_slug = '' then
    base_slug := 'dancer';
  end if;
  candidate := base_slug;

  while exists (
    select 1 from public.dancer_profiles profile
    where profile.slug = candidate
      and profile.user_id is distinct from unique_dancer_slug.user_id
  ) or exists (
    select 1 from public.dancer_profile_slug_aliases alias
    where alias.slug = candidate
      and alias.dancer_id is distinct from (
        select profile.id from public.dancer_profiles profile
        where profile.user_id = unique_dancer_slug.user_id
      )
  ) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;
  return candidate;
end;
$function$;

-- This remains an internal allocator called by the trusted Auth bootstrap.
revoke all on function public.unique_dancer_slug(text, uuid)
  from public, anon, authenticated, service_role;
commit;
