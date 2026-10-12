begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Preserve insertion order for a one-time queue of existing photos. Dancers with
-- recent activity go first; new uploads continue through the existing triggers.
alter table public.dancer_photo_hair_analysis alter column created_at set default clock_timestamp();
do $$
declare dancer record;
begin
  for dancer in
    with activity as (
      select dancer_id,created_at happened_at from public.internal_roster_requests where created_at>now()-interval '30 days'
      union all select dancer_id,occurred_at from public.venue_interactions where dancer_id is not null and occurred_at>now()-interval '30 days'
      union all select dancer_id,generated_at from public.qr_redemptions where dancer_id is not null and generated_at>now()-interval '30 days'
    ), recent as (select dancer_id,max(happened_at) latest from activity group by dancer_id)
    select d.id from public.dancer_profiles d left join recent r on r.dancer_id=d.id
    where d.disabled_at is null
      and exists(select 1 from public.dancer_photos p where p.dancer_id=d.id and p.review_status='approved')
      and not exists(select 1 from public.dancer_hair_color_periods h where h.dancer_id=d.id)
    order by r.latest desc nulls last,d.id
  loop
    -- Starts history now. Never assign today's photo to previously untracked events.
    perform public.refresh_dancer_hair_color_periods(dancer.id);
  end loop;
end $$;

create or replace function public.get_venue_hair_color_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_venue_id is null or p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until)
    or p_until<=p_since or p_until-p_since>interval '93 days' then raise exception 'Invalid report period' using errcode='22023'; end if;
  with internal_events as (
    select dancer_id,created_at occurred_at,status from public.internal_roster_requests
      where venue_id=p_venue_id and dancer_id is not null and created_at>=p_since and created_at<p_until
  ), external_events as (
    select dancer_id,occurred_at,event_type metric from public.venue_interactions
      where venue_id=p_venue_id and dancer_id is not null and occurred_at>=p_since and occurred_at<p_until
        and event_type in ('dancer_profile','club_page','directions','free_entry','transport')
    union all select s.dancer_id,g.created_at,'going' from public.going_signals g join public.shifts s on s.id=g.shift_id
      where s.venue_id=p_venue_id and s.dancer_id is not null and g.created_at>=p_since and g.created_at<p_until
    union all select dancer_id,generated_at,'claims' from public.qr_redemptions
      where venue_id=p_venue_id and admission_pass_version=1 and dancer_id is not null and generated_at>=p_since and generated_at<p_until
    union all select dancer_id,generated_at,'admissions' from public.qr_redemptions
      where venue_id=p_venue_id and admission_pass_version=1 and dancer_id is not null and status='redeemed' and redeemed_at>=p_since and redeemed_at<p_until
  ), internal_colors as (
    select e.*,coalesce(a.color,'unknown') color from internal_events e
    left join public.dancer_hair_color_periods h on h.dancer_id=e.dancer_id and h.channel='internal'
      and e.occurred_at>=h.started_at and (h.ended_at is null or e.occurred_at<h.ended_at)
    left join public.dancer_photo_hair_analysis a on a.id=h.analysis_id and a.status='complete'
  ), external_colors as (
    select e.*,coalesce(a.color,'unknown') color from external_events e
    left join public.dancer_hair_color_periods h on h.dancer_id=e.dancer_id and h.channel='external'
      and e.occurred_at>=h.started_at and (h.ended_at is null or e.occurred_at<h.ended_at)
    left join public.dancer_photo_hair_analysis a on a.id=h.analysis_id and a.status='complete'
  ), internal_groups as (
    select color,count(distinct dancer_id) dancers,jsonb_build_object(
      'requests',count(*),'completed',count(*) filter(where status='completed'),'pending',count(*) filter(where status='pending'),
      'acknowledged',count(*) filter(where status='acknowledged'),'cancelled',count(*) filter(where status='cancelled')) metrics
    from internal_colors group by color
  ), external_totals as (
    select color,metric,count(*) total from external_colors group by color,metric
  ), external_groups as (
    select color,(select count(distinct dancer_id) from external_colors e where e.color=t.color) dancers,
      jsonb_object_agg(metric,total) metrics from external_totals t group by color
  ), active_dancers as (
    select distinct dancer_id,'internal'::text channel from internal_events
    union select distinct dancer_id,'external' from external_events
  ), current_photos as (
    select d.channel,coalesce(a.color,'unknown') color,
      case when h.analysis_id is null then 'no_photo'
        when a.status in ('pending','processing') then 'scanning'
        when a.status='complete' then 'ready' else 'unavailable' end state,
      count(*) dancers
    from active_dancers d
    left join public.dancer_hair_color_periods h on h.dancer_id=d.dancer_id and h.channel=d.channel and h.ended_at is null
    left join public.dancer_photo_hair_analysis a on a.id=h.analysis_id
    group by d.channel,coalesce(a.color,'unknown'),
      case when h.analysis_id is null then 'no_photo'
        when a.status in ('pending','processing') then 'scanning'
        when a.status='complete' then 'ready' else 'unavailable' end
  ) select jsonb_build_object(
    'trackingStartedAt',(select started_at from public.dancer_hair_color_tracking where singleton),
    'internal',coalesce((select jsonb_agg(to_jsonb(g) order by (g.color='unknown'),g.color) from internal_groups g),'[]'::jsonb),
    'external',coalesce((select jsonb_agg(to_jsonb(g) order by (g.color='unknown'),g.color) from external_groups g),'[]'::jsonb),
    'currentPhotos',jsonb_build_object(
      'internal',coalesce((select jsonb_agg(to_jsonb(c)-'channel' order by (c.color='unknown'),c.color,c.state) from current_photos c where c.channel='internal'),'[]'::jsonb),
      'external',coalesce((select jsonb_agg(to_jsonb(c)-'channel' order by (c.color='unknown'),c.color,c.state) from current_photos c where c.channel='external'),'[]'::jsonb)
    )
  ) into result;
  return result;
end $$;
revoke all on function public.get_venue_hair_color_analytics(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_hair_color_analytics(uuid,timestamptz,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
