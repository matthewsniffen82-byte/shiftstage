begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Keep request totals and shift/trend behavior; extend the private report with
-- dancer-owned check-in evidence using the same day rules as venue scoring.
alter function public.get_dancer_performance_analytics(uuid,timestamptz,timestamptz)
  rename to get_dancer_request_results;
create function public.get_dancer_performance_analytics(p_dancer_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare base jsonb; activity jsonb; clubs jsonb;
begin
  -- The existing function validates finite periods and the profile's All time start.
  base:=public.get_dancer_request_results(p_dancer_id,p_since,p_until);
  with scopes as (
    select null::uuid venue_id union all select (c->>'id')::uuid from jsonb_array_elements(base->'clubs') c
  ), visits as materialized (
    select w.*,greatest(started_at,p_since) lo,least(expires_at,coalesce(closed_at,expires_at),p_until) hi,
      least(expires_at,coalesce(closed_at,expires_at))<=p_until and coalesce(closure_reason,'expired')<>'interrupted' eligible,
      dancer_check_out_at is not null and dancer_check_out_at<=expires_at and dancer_check_out_at<=p_until complete
    from public.venue_dancer_work_sessions w where dancer_id=p_dancer_id and started_at<p_until
      and least(expires_at,coalesce(closed_at,expires_at),p_until)>greatest(started_at,p_since)
  ), days as (
    select venue_id,check_in_day,bool_or(eligible) eligible,bool_and(complete) filter(where eligible) complete,
      bool_or(least(expires_at,coalesce(closed_at,expires_at))>p_until) active
    from visits where dancer_check_in_at is not null group by venue_id,check_in_day
  ), hours as (
    select s.venue_id,range_agg(tstzrange(v.lo,v.hi,'[)')) filter(where v.id is not null) intervals,
      range_agg((v.both_roster_periods*tstzmultirange(tstzrange(v.lo,v.hi,'[)')))
        + case when v.both_roster_started_at<v.hi then tstzmultirange(tstzrange(greatest(v.lo,v.both_roster_started_at),v.hi,'[)'))
          else '{}'::tstzmultirange end) filter(where v.dancer_check_in_at is not null) both_intervals
    from scopes s left join visits v on s.venue_id is null or s.venue_id=v.venue_id group by s.venue_id
  ), metrics as (
    select s.venue_id,jsonb_build_object(
      'checkIns',(select count(*) from visits v where v.dancer_check_in_at>=p_since and v.dancer_check_in_at<p_until and (s.venue_id is null or v.venue_id=s.venue_id)),
      'dancerCheckouts',(select count(*) from public.venue_dancer_work_sessions w where w.dancer_id=p_dancer_id
        and w.dancer_check_in_at is not null and w.dancer_check_out_at>=p_since and w.dancer_check_out_at<p_until and (s.venue_id is null or w.venue_id=s.venue_id)),
      'recordedHours',coalesce((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.intervals) piece),0),
      'bothRosterHours',coalesce((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.both_intervals) piece),0),
      'checkoutEligibleDays',(select count(*) from days d where d.eligible and (s.venue_id is null or d.venue_id=s.venue_id)),
      'dancerCheckoutDays',(select count(*) from days d where d.eligible and d.complete and (s.venue_id is null or d.venue_id=s.venue_id)),
      'activeDays',(select count(*) from days d where d.active and (s.venue_id is null or d.venue_id=s.venue_id))
    ) payload from scopes s join hours h on h.venue_id is not distinct from s.venue_id
  ) select jsonb_object_agg(coalesce(venue_id::text,'all'),payload) into activity from metrics;
  select coalesce(jsonb_agg(c||jsonb_build_object('roster',activity->(c->>'id')) order by position),'[]'::jsonb)
    into clubs from jsonb_array_elements(base->'clubs') with ordinality entries(c,position);
  return base||jsonb_build_object('roster',activity->'all','clubs',clubs);
end $$;
revoke all on function public.get_dancer_request_results(uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.get_dancer_performance_analytics(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_dancer_request_results(uuid,timestamptz,timestamptz) to service_role;
grant execute on function public.get_dancer_performance_analytics(uuid,timestamptz,timestamptz) to service_role;
commit;
