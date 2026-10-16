begin;
set local lock_timeout = '3s';

-- Request sizes bound individual reads; neither directory has a total ceiling.
alter table public.discovery_sessions drop constraint discovery_sessions_ordered_ids_check;
alter table public.discovery_events drop constraint discovery_events_position_check;
alter table public.discovery_events alter column position type bigint;
alter table public.discovery_events add constraint discovery_events_position_check check (position >= 0);

create function public.get_public_directory_candidates(p_city text, p_after uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'city', d.city,
    'venueId', live.venue_id, 'availableUntil', live.expires) order by d.id), '[]'::jsonb)
  from (
    select id, city from public.dancer_profiles
    where status='approved' and verification_status='approved' and is_public=true and disabled_at is null
      and (p_city='' or lower(city)=lower(p_city)) and (p_after is null or id>p_after)
    order by id limit 1000
  ) d
  left join lateral (
    select s.venue_id, s.location_verification_expires_at expires
    from public.shifts s join public.venues v on v.id=s.venue_id
    where s.dancer_id=d.id and s.status='posted' and s.checked_in_at is not null
      and s.checked_out_at is null and s.location_status='club_confirmed'
      and s.location_verification_expires_at>now() and isfinite(s.location_verification_expires_at)
      and v.is_active and public.has_active_club_deal(v)
    order by s.starts_at, s.id limit 1
  ) live on true;
$$;

create function public.get_public_tv_ranking_candidates(p_city text, p_after uuid default null, p_venue uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.id), '[]'::jsonb)
  from (
    select video.id, d.id as "dancerId", d.city, coalesce(live.venue_id,upcoming.venue_id) as "venueId",
      live.expires as "availableUntil", upcoming.starts_at as "nextShiftAt", upcoming.ends_at as "nextShiftEndsAt",
      video.published_at as "freshAt", video.duration_seconds as duration
    from public.mydancr_tv_videos video join public.dancer_profiles d on d.id=video.dancer_id
    left join lateral (
      select s.venue_id, s.location_verification_expires_at expires
      from public.shifts s join public.venues v on v.id=s.venue_id
      where s.dancer_id=d.id and s.status='posted' and s.checked_in_at is not null
        and s.checked_out_at is null and s.location_status='club_confirmed'
        and s.location_verification_expires_at>now() and isfinite(s.location_verification_expires_at)
        and v.is_active and public.has_active_club_deal(v)
      order by s.location_verification_expires_at desc, s.id limit 1
    ) live on true
    left join lateral (
      select s.venue_id, s.starts_at, s.ends_at from public.shifts s join public.venues v on v.id=s.venue_id
      where s.dancer_id=d.id and s.status='posted' and s.ends_at>now()
        and s.starts_at<=now()+interval '7 days' and s.checked_out_at is null
        and isfinite(s.starts_at) and isfinite(s.ends_at)
        and v.is_active and public.has_active_club_deal(v)
      order by s.starts_at,s.id limit 1
    ) upcoming on true
    where d.status='approved' and d.verification_status='approved' and d.is_public=true and d.disabled_at is null
      and (p_city='' or lower(d.city)=lower(p_city)) and (p_after is null or video.id>p_after)
      and (p_venue is null or live.venue_id=p_venue)
      and video.status='approved' and video.duration_seconds between 1 and 30 and video.published_at<=now()
      and (video.expires_at is null or video.expires_at>now())
    order by video.id limit 1000
  ) candidate;
$$;

revoke all on function public.get_public_directory_candidates(text,uuid),
  public.get_public_tv_ranking_candidates(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_public_directory_candidates(text,uuid),
  public.get_public_tv_ranking_candidates(text,uuid,uuid) to service_role;
commit;
