-- Preserve all operational metrics; add customer-driven VIP inputs for automatic scoring.
alter function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz)
  rename to get_venue_performance_recorded_results;
create function public.get_venue_performance_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz,p_tonight_since timestamptz,p_tonight_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare base jsonb; dancers jsonb;
begin
  -- Existing report enforces valid finite period boundaries, including the explicit All-time boundary.
  base := public.get_venue_performance_recorded_results(p_venue_id,p_since,p_until,p_tonight_since,p_tonight_until);
  with selections as materialized (
    select distinct r.id,r.user_id,r.created_at,d.id dancer_id,
      (r.status='cancelled' and r.reviewed_by is not distinct from r.user_id) withdrawn
    from public.venue_vip_requests r cross join lateral jsonb_array_elements(r.dancers) choice
    join public.dancer_profiles d on d.id::text=choice->>'id'
    where r.venue_id=p_venue_id and r.created_at>=p_since and r.created_at<p_until
  ), metrics as (
    select s.dancer_id,jsonb_build_object(
      'scoringRequests',count(*) filter(where not s.withdrawn),
      'scoringUniqueRequesters',count(distinct s.user_id) filter(where not s.withdrawn),
      'customerWithdrawals',count(*) filter(where s.withdrawn),
      'scoringRepeatRequesters',count(distinct s.user_id) filter(where not s.withdrawn and exists(
        select 1 from public.venue_vip_requests earlier
        where earlier.venue_id=p_venue_id and earlier.user_id=s.user_id and earlier.created_at<s.created_at
          and not (earlier.status='cancelled' and earlier.reviewed_by is not distinct from earlier.user_id)
          and earlier.dancers @> jsonb_build_array(jsonb_build_object('id',s.dancer_id))
      ))) payload from selections s group by s.dancer_id
  )
  select coalesce(jsonb_agg(jsonb_set(item,'{vip}',coalesce(item->'vip','{}'::jsonb) || coalesce(m.payload,
    '{"scoringRequests":0,"scoringUniqueRequesters":0,"scoringRepeatRequesters":0,"customerWithdrawals":0}'::jsonb)) order by position),'[]'::jsonb)
  into dancers from jsonb_array_elements(base->'performance'->'dancers') with ordinality entries(item,position)
  left join metrics m on m.dancer_id::text=item->>'id';
  return jsonb_set(base,'{performance,dancers}',dancers);
end $$;
revoke all on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
revoke all on function public.get_venue_performance_recorded_results(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_recorded_results(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
