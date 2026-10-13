begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Aggregate existing customer actions and presence records; no staff-maintained outcomes.
create function public.get_venue_automatic_period(p_venue_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb; club_zone text;
begin
  if p_venue_id is null or p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until)
    or p_since>=p_until or (p_since<>timestamptz '1970-01-01 00:00:00+00' and p_until-p_since>interval '31 days') then
    raise exception 'Invalid automatic report period' using errcode='22023';
  end if;
  select coalesce(nullif(timezone,''),'UTC') into club_zone from public.venues where id=p_venue_id;
  club_zone:=coalesce(club_zone,'UTC');
  with visits as materialized (
    select s.*,greatest(started_at,p_since) lo,least(expires_at,coalesce(closed_at,expires_at),p_until) hi,
      least(expires_at,coalesce(closed_at,expires_at))<=p_until and coalesce(closure_reason,'expired')<>'interrupted' eligible,
      dancer_check_out_at is not null and dancer_check_out_at<=expires_at and dancer_check_out_at<=p_until complete
    from public.venue_dancer_work_sessions s where venue_id=p_venue_id and started_at<p_until
      and least(expires_at,coalesce(closed_at,expires_at),p_until)>greatest(started_at,p_since)
  ), days as (
    select dancer_id,check_in_day,bool_or(eligible) eligible,bool_and(complete) filter(where eligible) complete
    from visits where dancer_check_in_at is not null group by dancer_id,check_in_day
  ), hours as (
    select dancer_id,range_agg(tstzrange(lo,hi,'[)')) intervals,
      range_agg((both_roster_periods*tstzmultirange(tstzrange(lo,hi,'[)')))
        + case when dancer_check_in_at is not null and both_roster_started_at<hi
          then tstzmultirange(tstzrange(greatest(lo,both_roster_started_at),hi,'[)')) else '{}'::tstzmultirange end) both_intervals
    from visits group by dancer_id
  ), roster as (
    select count(*) dancers,
      coalesce(sum((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(intervals) piece)),0) hours,
      coalesce(sum((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(both_intervals) piece)),0) both_hours
    from hours
  ), requests as materialized (
    select r.*,r.status='cancelled' and r.reviewed_by is not distinct from r.user_id withdrawn
    from public.venue_vip_requests r where venue_id=p_venue_id and created_at>=p_since and created_at<p_until
  ), selections as (
    select distinct r.id,d.id dancer_id from requests r cross join lateral jsonb_array_elements(r.dancers) choice
      join public.dancer_profiles d on d.id::text=choice->>'id' where not r.withdrawn
  ), vip as (
    select count(*) requests,count(*) filter(where withdrawn) withdrawals,
      count(distinct user_id) filter(where not withdrawn) customers,
      count(distinct user_id) filter(where not r.withdrawn and exists(select 1 from public.venue_vip_requests earlier
        where earlier.venue_id=p_venue_id and earlier.user_id=r.user_id and earlier.created_at<r.created_at
          and not(earlier.status='cancelled' and earlier.reviewed_by is not distinct from earlier.user_id))) repeat_customers
    from requests r
  ), table_requests as materialized (
    select * from public.internal_roster_requests where venue_id=p_venue_id and created_at>=p_since and created_at<p_until
  ), pickups as materialized (
    select * from public.club_shuttle_requests where venue_id=p_venue_id and created_at>=p_since and created_at<p_until
  ), passes as (
    select count(*) filter(where generated_at>=p_since and generated_at<p_until) claims,
      count(*) filter(where status='redeemed' and redeemed_at>=p_since and redeemed_at<p_until) admissions,
      count(*) filter(where generated_at>=p_since and generated_at<p_until and status='redeemed'
        and redeemed_at>=generated_at and redeemed_at<p_until) cohort_admissions
    from public.qr_redemptions where venue_id=p_venue_id and admission_pass_version=1 and voided_at is null and status<>'voided'
      and ((generated_at>=p_since and generated_at<p_until) or (redeemed_at>=p_since and redeemed_at<p_until))
  ), actions as (
    select count(*) filter(where event_type='dancer_profile') profiles,
      count(*) filter(where event_type='directions') directions,count(*) filter(where event_type='share_completed') shares,
      count(*) filter(where event_type='transport') transport
    from public.venue_interactions where venue_id=p_venue_id and occurred_at>=p_since and occurred_at<p_until
  ), time_events as (
    select 'vipDates' kind,to_char(starts_at at time zone club_zone,'YYYY-MM-DD') label from requests where not withdrawn and starts_at is not null
    union all select 'vipHours',to_char(starts_at at time zone club_zone,'HH24:00') from requests where not withdrawn and starts_at is not null
    union all select 'tableHours',to_char(created_at at time zone club_zone,'HH24:00') from table_requests
    union all select 'pickupHours',to_char(created_at at time zone club_zone,'HH24:00') from pickups
  ), time_counts as (
    select kind,label,count(*) total from time_events group by kind,label
  ), ranked_times as (
    select *,row_number() over(partition by kind order by total desc,label) position from time_counts
  ), buckets as (
    select kind,jsonb_agg(jsonb_build_object('label',label,'total',total) order by total desc,label) items
    from ranked_times where position<=5 group by kind
  ), top_tables as (
    select r.link_id,coalesce(l.label,'Removed table') label,count(*) total
    from table_requests r left join public.internal_roster_links l on l.id=r.link_id and l.venue_id=p_venue_id
    group by r.link_id,l.label order by count(*) desc,coalesce(l.label,'Removed table'),r.link_id limit 5
  )
  select jsonb_build_object(
    'dancersCheckedIn',roster.dancers,'checkedInHours',roster.hours,'bothRosterHours',roster.both_hours,
    'checkIns',(select count(*) from visits where dancer_check_in_at>=p_since and dancer_check_in_at<p_until),
    'dancerCheckouts',(select count(*) from public.venue_dancer_work_sessions where venue_id=p_venue_id and dancer_check_in_at is not null and dancer_check_out_at>=p_since and dancer_check_out_at<p_until),
    'expiredCheckins',(select count(*) from visits where dancer_check_in_at is not null and expires_at>=p_since and expires_at<p_until
      and (closure_reason='expired' or closed_at is null)),
    'checkoutEligibleDays',(select count(*) from days where eligible),'dancerCheckoutDays',(select count(*) from days where eligible and complete),
    'claims',passes.claims,'admissions',passes.admissions,'cohortAdmissions',passes.cohort_admissions,
    'guestList',(select count(*) from public.venue_guest_list_entries where venue_id=p_venue_id and created_at>=p_since and created_at<p_until),
    'vipRequests',vip.requests,'vipCustomers',vip.customers,'vipRepeatCustomers',vip.repeat_customers,'vipWithdrawals',vip.withdrawals,
    'vipSelections',(select count(*) from selections),
    'tableRequests',(select count(*) from table_requests),
    'tableRequestsDuringHours',(select count(*) from table_requests r join hours h on h.dancer_id=r.dancer_id and h.intervals @> r.created_at),
    'clubVisits',(select count(*) from public.venue_page_events where venue_id=p_venue_id and event_type='page_view' and occurred_at>=p_since and occurred_at<p_until),
    'uniqueBrowsers',(select count(distinct session_id) from public.venue_page_events where venue_id=p_venue_id and event_type='page_view' and occurred_at>=p_since and occurred_at<p_until),
    'profileOpens',actions.profiles,'directions',actions.directions,'completedShares',actions.shares,'transportClicks',actions.transport,
    'followers',(select count(*) from public.venue_follows where venue_id=p_venue_id and created_at>=p_since and created_at<p_until),
    'going',(select count(*) from public.going_signals g join public.shifts s on s.id=g.shift_id where s.venue_id=p_venue_id and g.created_at>=p_since and g.created_at<p_until),
    'pickups',(select count(*) from pickups),
    'passengers',(select coalesce(sum((select (notice->'payload'->>'partySize')::integer from jsonb_array_elements(r.notification_rows) notice
      where notice->'payload'->>'kind'='club_shuttle_request' and notice->'payload'->>'requestId'=r.id::text and notice->'payload'->>'venueId'=r.venue_id::text
      and notice->'payload'->>'partySize' ~ '^[0-9]{1,3}$' limit 1)),0) from pickups r),
    'vipDates',coalesce((select items from buckets where kind='vipDates'),'[]'::jsonb),
    'vipHours',coalesce((select items from buckets where kind='vipHours'),'[]'::jsonb),
    'tableHours',coalesce((select items from buckets where kind='tableHours'),'[]'::jsonb),
    'pickupHours',coalesce((select items from buckets where kind='pickupHours'),'[]'::jsonb),
    'tables',coalesce((select jsonb_agg(jsonb_build_object('label',label,'total',total) order by total desc,label,link_id) from top_tables),'[]'::jsonb)
  ) into result from roster cross join vip cross join passes cross join actions;
  return result;
end $$;
revoke all on function public.get_venue_automatic_period(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_automatic_period(uuid,timestamptz,timestamptz) to service_role;

alter function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz)
  rename to get_venue_performance_scored_dancers;
create function public.get_venue_performance_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz,p_tonight_since timestamptz,p_tonight_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare base jsonb; live jsonb;
begin
  base:=public.get_venue_performance_scored_dancers(p_venue_id,p_since,p_until,p_tonight_since,p_tonight_until);
  with active as (
    select distinct on(s.dancer_id) s.dancer_id,
      c.visibility in ('internal','both') and p.visibility in ('internal','both') internal,
      c.visibility in ('external','both') and p.visibility in ('external','both') external
    from public.shifts s left join public.dancer_shift_channels c on c.shift_id=s.id and c.dancer_id=s.dancer_id and c.venue_id=s.venue_id
      left join public.dancer_channel_preferences p on p.dancer_id=s.dancer_id
    where s.venue_id=p_venue_id and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
      and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
      and s.shift_source in ('scheduled','nfc_presence') and s.nfc_tag_id is not null
    order by s.dancer_id,s.checked_in_at desc,s.id
  ) select jsonb_build_object('total',count(*),'internal',count(*) filter(where internal and not external),
    'external',count(*) filter(where external and not internal),'both',count(*) filter(where internal and external),
    'unknown',count(*) filter(where not coalesce(internal or external,false))) into live from active;
  return base||jsonb_build_object('automatic',jsonb_build_object(
    'current',public.get_venue_automatic_period(p_venue_id,p_since,p_until),
    'previous',case when p_since<>timestamptz '1970-01-01 00:00:00+00' then public.get_venue_automatic_period(p_venue_id,p_since-(p_until-p_since),p_since) end,
    'liveRoster',live,'liveAsOf',now()));
end $$;
revoke all on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
revoke all on function public.get_venue_performance_scored_dancers(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_scored_dancers(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
commit;
