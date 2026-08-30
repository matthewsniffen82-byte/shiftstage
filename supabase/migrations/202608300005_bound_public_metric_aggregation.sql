begin;

-- Public discovery filters by the second column of the legacy composite keys.
-- Give those bounded aggregate queries direct lookup paths as the tables grow.
create index if not exists follows_dancer_idx
  on public.follows (dancer_id);
create index if not exists venue_follows_venue_idx
  on public.venue_follows (venue_id);
create index if not exists direction_requests_venue_requested_idx
  on public.direction_requests (venue_id, requested_at desc);

create or replace function public.get_public_dancer_metric_counts(
  p_dancer_ids uuid[],
  p_shift_ids uuid[],
  p_profile_views_since timestamptz
)
returns table(metric text, entity_id uuid, total bigint)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select 'followers'::text, follow.dancer_id, count(*)::bigint
  from public.follows as follow
  where follow.dancer_id = any(coalesce(p_dancer_ids, '{}'::uuid[]))
  group by follow.dancer_id

  union all

  select 'notifications'::text, follow.dancer_id, count(*)::bigint
  from public.follows as follow
  where follow.dancer_id = any(coalesce(p_dancer_ids, '{}'::uuid[]))
    and follow.notifications_enabled = true
  group by follow.dancer_id

  union all

  select 'profile_views'::text, view.dancer_id, count(*)::bigint
  from public.profile_views as view
  where view.dancer_id = any(coalesce(p_dancer_ids, '{}'::uuid[]))
    and view.viewed_at >= p_profile_views_since
  group by view.dancer_id

  union all

  select 'going'::text, signal.shift_id, count(*)::bigint
  from public.going_signals as signal
  where signal.shift_id = any(coalesce(p_shift_ids, '{}'::uuid[]))
  group by signal.shift_id;
$$;

create or replace function public.get_public_venue_metric_counts(
  p_venue_ids uuid[],
  p_activity_since timestamptz
)
returns table(metric text, entity_id uuid, total bigint)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select 'followers'::text, follow.venue_id, count(*)::bigint
  from public.venue_follows as follow
  where follow.venue_id = any(coalesce(p_venue_ids, '{}'::uuid[]))
  group by follow.venue_id

  union all

  select 'directions'::text, request.venue_id, count(*)::bigint
  from public.direction_requests as request
  where request.venue_id = any(coalesce(p_venue_ids, '{}'::uuid[]))
    and request.requested_at >= p_activity_since
  group by request.venue_id

  union all

  select 'profile_views'::text, event.venue_id, count(*)::bigint
  from public.venue_page_events as event
  where event.venue_id = any(coalesce(p_venue_ids, '{}'::uuid[]))
    and event.event_type = 'page_view'
    and event.occurred_at >= p_activity_since
  group by event.venue_id;
$$;

revoke execute on function public.get_public_dancer_metric_counts(uuid[], uuid[], timestamptz)
  from public, anon, authenticated;
revoke execute on function public.get_public_venue_metric_counts(uuid[], timestamptz)
  from public, anon, authenticated;

grant execute on function public.get_public_dancer_metric_counts(uuid[], uuid[], timestamptz)
  to service_role;
grant execute on function public.get_public_venue_metric_counts(uuid[], timestamptz)
  to service_role;

commit;
