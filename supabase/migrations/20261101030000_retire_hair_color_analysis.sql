begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Stop collection before deploying removal of the application worker and UI.
drop trigger if exists capture_dancer_photo_hair_color on public.dancer_photos;
drop trigger if exists capture_dancer_internal_hair_color on public.dancer_internal_main_photos;

-- Old deployments must neither enqueue nor lease work during the rollout.
create or replace function public.refresh_dancer_hair_color_periods(p_dancer_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin return; end $$;
create or replace function public.claim_dancer_hair_color_jobs(p_limit integer default 4)
returns setof public.dancer_photo_hair_analysis language plpgsql security invoker set search_path = '' as $$
begin return; end $$;
create or replace function public.get_venue_hair_color_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object('retired',true,'trackingStartedAt',null,'internal','[]'::jsonb,'external','[]'::jsonb,
  'currentPhotos',jsonb_build_object('internal','[]'::jsonb,'external','[]'::jsonb));
$$;
revoke all on function public.refresh_dancer_hair_color_periods(uuid),public.claim_dancer_hair_color_jobs(integer),
 public.get_venue_hair_color_analytics(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.refresh_dancer_hair_color_periods(uuid),public.claim_dancer_hair_color_jobs(integer),
 public.get_venue_hair_color_analytics(uuid,timestamptz,timestamptz) to service_role;
revoke all on function public.capture_dancer_hair_color_photo() from public,anon,authenticated,service_role;
revoke insert on public.dancer_photo_hair_analysis,public.dancer_hair_color_periods from service_role;

-- Invalidate outstanding leases so late workers cannot store a result.
update public.dancer_photo_hair_analysis set status='unavailable',locked_until=null,lease_token=null
 where status in ('pending','processing');
-- Close collection periods without rewriting earlier closure/retention clocks.
-- Historical records remain private and subject to existing retention/holds.
update public.dancer_hair_color_periods set ended_at=greatest(started_at,statement_timestamp()) where ended_at is null;
notify pgrst,'reload schema';
commit;
