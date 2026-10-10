begin;
set local lock_timeout = '3s';

-- Private, short-lived ordering snapshots. No client can write scores or read
-- another visitor's interests. Existing content and analytics remain intact.
create table public.discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  viewer_hash text not null check (viewer_hash ~ '^[a-f0-9]{64}$'),
  visit_id text not null check (length(visit_id) between 8 and 80),
  scope_hash text not null check (scope_hash ~ '^[a-f0-9]{64}$'),
  surface text not null check (surface in ('grid','tv')),
  ordered_ids uuid[] not null check (cardinality(ordered_ids) <= 5000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  unique (viewer_hash,visit_id,scope_hash)
);
create index discovery_sessions_expiry on public.discovery_sessions(expires_at);
create table public.discovery_events (
  id uuid primary key default gen_random_uuid(),
  viewer_hash text not null check (viewer_hash ~ '^[a-f0-9]{64}$'),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  entity_id uuid not null,
  surface text not null check (surface in ('grid','tv')),
  event_type text not null check (event_type in ('impression','engaged','completed','profile_click','follow','schedule','directions','show_less')),
  position integer not null check (position between 0 and 4999),
  occurred_on date not null default (now() at time zone 'UTC')::date,
  occurred_at timestamptz not null default now(),
  unique (viewer_hash,entity_id,surface,event_type,occurred_on)
);
create index discovery_events_metrics on public.discovery_events(surface,entity_id,occurred_at);
create index discovery_events_history on public.discovery_events(viewer_hash,occurred_at);
alter table public.discovery_sessions enable row level security;
alter table public.discovery_events enable row level security;
revoke all on public.discovery_sessions, public.discovery_events from public, anon, authenticated;
grant all on public.discovery_sessions, public.discovery_events to service_role;

-- Candidates are eligible before any score is calculated. The bounded pool is
-- sampled by dancer, not by upload volume or lifetime popularity.
create function public.get_discovery_candidates(
  p_surface text, p_city text, p_venue uuid default null,
  p_dancer_ids uuid[] default null, p_seed text default 'discovery', p_selected_video uuid default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_surface not in ('grid','tv') or length(p_city) > 80 or length(p_seed) > 160
     or cardinality(p_dancer_ids) > 800 then
    raise exception 'Invalid discovery scope';
  end if;
  with eligible as (
    select d.id, d.city, coalesce(live.venue_id,upcoming.venue_id) venue_id, live.expires, upcoming.starts_at, upcoming.ends_at
    from public.dancer_profiles d
    left join lateral (
      select s.venue_id, s.location_verification_expires_at expires
      from public.shifts s join public.venues v on v.id=s.venue_id
      where s.dancer_id=d.id and s.status='posted' and s.checked_in_at is not null
        and s.checked_out_at is null and s.location_status='club_confirmed'
        and s.location_verification_expires_at > now() and isfinite(s.location_verification_expires_at)
        and v.is_active and public.has_active_club_deal(v)
      order by s.location_verification_expires_at desc, s.id limit 1
    ) live on true
    left join lateral (
      select s.starts_at, s.ends_at, s.venue_id from public.shifts s join public.venues v on v.id=s.venue_id
      where s.dancer_id=d.id and s.status='posted' and s.ends_at > now()
        and s.starts_at <= now()+interval '7 days' and s.checked_out_at is null
        and isfinite(s.starts_at) and isfinite(s.ends_at)
        and v.is_active and public.has_active_club_deal(v)
      order by s.starts_at,s.id limit 1
    ) upcoming on true
    where d.status='approved' and d.verification_status='approved' and d.is_public=true and d.disabled_at is null
      and (p_city='' or lower(d.city)=lower(p_city))
      and (p_dancer_ids is null or d.id=any(p_dancer_ids))
      and (p_venue is null or live.venue_id=p_venue)
    order by (d.id=(select dancer_id from public.mydancr_tv_videos where id=p_selected_video)) desc nulls last,
      md5(p_seed || d.id::text), d.id limit 800
  ), items as (
    select d.id, d.id dancer_id, d.city, d.venue_id, d.expires, d.starts_at,d.ends_at,
      greatest((select max(p.created_at) from public.dancer_photos p where p.dancer_id=d.id and p.review_status='approved'),
        (select max(v.published_at) from public.mydancr_tv_videos v where v.dancer_id=d.id and v.status='approved'
          and v.published_at<=now() and (v.expires_at is null or v.expires_at>now()))) fresh_at,
      0::numeric duration_seconds
    from eligible d where p_surface='grid'
    union all
    select v.id,d.id,d.city,d.venue_id,d.expires,d.starts_at,d.ends_at,v.published_at,v.duration_seconds
    from eligible d join lateral (
      select v.* from public.mydancr_tv_videos v where v.dancer_id=d.id and v.status='approved'
        and v.duration_seconds between 1 and 30 and v.published_at<=now()
        and (v.expires_at is null or v.expires_at>now())
      order by (v.id=p_selected_video) desc nulls last,v.published_at desc,v.id limit 50
    ) v on true where p_surface='tv'
  ), selected as (
    select * from (select items.*, row_number() over(partition by dancer_id order by (id=p_selected_video) desc nulls last,fresh_at desc,id) slot from items) pool
    order by (id=p_selected_video) desc nulls last, slot, md5(p_seed || dancer_id::text), id limit 5000
  ), observations as (
    select e.entity_id,e.viewer_hash,e.occurred_on,
      min(case when e.position<3 then 0 when e.position<12 then 1 else 2 end) filter(where e.event_type='impression') bucket,
      bool_or(e.event_type in ('profile_click','follow','schedule','directions')) acted,
      bool_or(e.event_type='engaged') engaged, bool_or(e.event_type='completed') completed
    from public.discovery_events e join selected i on i.id=e.entity_id
    where e.surface=p_surface and e.occurred_at>now()-interval '14 days'
    group by e.entity_id,e.viewer_hash,e.occurred_on
  ), aggregates as (
    select entity_id,bucket,
      sum(power(0.5,((now() at time zone 'UTC')::date-occurred_on)::numeric/7)) impressions,
      sum(case when acted then power(0.5,((now() at time zone 'UTC')::date-occurred_on)::numeric/7) else 0 end) actions,
      sum(case when engaged then power(0.5,((now() at time zone 'UTC')::date-occurred_on)::numeric/7) else 0 end) engaged,
      sum(case when completed then power(0.5,((now() at time zone 'UTC')::date-occurred_on)::numeric/7) else 0 end) completed
    from observations where bucket is not null group by entity_id,bucket
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'dancerId',i.dancer_id,'city',i.city,'venueId',i.venue_id,
    'availableUntil',i.expires,'nextShiftAt',i.starts_at,'nextShiftEndsAt',i.ends_at,
    -- One capped freshness bonus per UTC day, independent of upload count.
    'freshAt',date_trunc('day',i.fresh_at at time zone 'UTC') at time zone 'UTC','duration',i.duration_seconds,
    'buckets',(select jsonb_agg(jsonb_build_object('impressions',coalesce(a.impressions,0),
      'actions',coalesce(a.actions,0),'engaged',coalesce(a.engaged,0),'completed',coalesce(a.completed,0)) order by b)
      from generate_series(0,2) b left join aggregates a on a.entity_id=i.id and a.bucket=b))), '[]'::jsonb)
    into result from selected i;
  return result;
end $$;
revoke all on function public.get_discovery_candidates(text,text,uuid,uuid[],text,uuid) from public,anon,authenticated;
grant execute on function public.get_discovery_candidates(text,text,uuid,uuid[],text,uuid) to service_role;

-- Prune only this feature's transient data; call from the server at most daily.
create function public.prune_discovery_history() returns void
language sql security invoker set search_path='' as $$
  delete from public.discovery_sessions where expires_at<now()-interval '1 day';
  delete from public.discovery_events where occurred_at<now()-interval '30 days';
$$;
revoke all on function public.prune_discovery_history() from public,anon,authenticated;
grant execute on function public.prune_discovery_history() to service_role;
commit;
