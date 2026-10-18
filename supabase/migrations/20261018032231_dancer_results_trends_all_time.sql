begin;
set local lock_timeout='5s';
set local statement_timeout='60s';


-- Server-only aggregates: the API resolves the dancer from the verified user.
create or replace function public.get_dancer_performance_analytics(p_dancer_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_dancer_id is null or p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until)
   or p_until<=p_since or (p_until-p_since>interval '31 days' and not exists(
     select 1 from public.dancer_profiles where id=p_dancer_id and created_at=p_since)) then
   raise exception 'Invalid dancer analytics window' using errcode='22023';
 end if;
 with periods as (
   select 'current' label,p_since lo,p_until hi
   union all select 'previous',p_since-(p_until-p_since),p_since
 ), table_requests as materialized (
   select r.venue_id,r.created_at,r.status from public.internal_roster_requests r
   where r.dancer_id=p_dancer_id and r.created_at>=p_since-(p_until-p_since) and r.created_at<p_until
 ), vip_requests as materialized (
   select r.venue_id,r.user_id,r.created_at,r.status,
     exists(select 1 from public.venue_vip_requests earlier
       where earlier.venue_id=r.venue_id and earlier.user_id=r.user_id and earlier.created_at<r.created_at
       and earlier.dancers @> jsonb_build_array(jsonb_build_object('id',p_dancer_id))) repeated
   from public.venue_vip_requests r
   where r.dancers @> jsonb_build_array(jsonb_build_object('id',p_dancer_id))
     and r.created_at>=p_since-(p_until-p_since) and r.created_at<p_until
 ), passes as materialized (
   select venue_id,generated_at,redeemed_at,status from public.qr_redemptions
   where dancer_id=p_dancer_id and admission_pass_version=1
     and ((generated_at>=p_since and generated_at<p_until) or (status='redeemed' and redeemed_at>=p_since and redeemed_at<p_until))
 ), subscribers as materialized (
   -- Following now drives both regular and VIP alerts. Legacy opt-in rows are not a second subscription.
   select f.customer_id from public.follows f
   join public.app_users u on u.id=f.customer_id and u.role='customer' and u.account_state='active'
   left join public.customer_profiles c on c.user_id=f.customer_id
   where f.dancer_id=p_dancer_id
     and coalesce(c.notification_settings->'followAlertsEnabled','true'::jsonb)<>'false'::jsonb
     and coalesce(c.notification_settings->'workingNow','true'::jsonb)<>'false'::jsonb
 ), vip_subscribers as materialized (
   select distinct s.customer_id,m.venue_id from subscribers s
   join public.venue_vip_members m on m.user_id=s.customer_id and m.active
   join public.venues v on v.id=m.venue_id and v.is_active
   join public.app_users owner_account on owner_account.id=v.owner_user_id and owner_account.role='venue' and owner_account.account_state='active'
   join public.venue_dancer_affiliations a on a.venue_id=m.venue_id and a.dancer_id=p_dancer_id
     and a.status='active' and a.revoked_at is null and not a.reentry_blocked
 ), observed as materialized (
   select coalesce(w.shift_id,w.id) id,w.venue_id,
     coalesce(bool_or(w.started_at<p_since or least(w.expires_at,coalesce(w.closed_at,w.expires_at))>p_until
       or w.started_at<=(select started_at from public.venue_performance_tracking where singleton)),false) partial,
     min(greatest(w.started_at,p_since)) started_at,
     max(least(w.expires_at,coalesce(w.closed_at,w.expires_at),p_until)) ended_at,
     range_agg(tstzrange(greatest(w.started_at,p_since),least(w.expires_at,coalesce(w.closed_at,w.expires_at),p_until),'[)')) intervals
   from public.venue_dancer_work_sessions w
   where w.dancer_id=p_dancer_id and w.started_at<p_until
     and least(w.expires_at,coalesce(w.closed_at,w.expires_at))>p_since
     and least(w.expires_at,coalesce(w.closed_at,w.expires_at),p_until)>greatest(w.started_at,p_since)
   group by coalesce(w.shift_id,w.id),w.venue_id
 ), venue_ids as (
   select venue_id from table_requests union select venue_id from vip_requests union select venue_id from passes
   union select venue_id from observed union select venue_id from vip_subscribers
   union select venue_id from public.venue_dancer_affiliations where dancer_id=p_dancer_id and status='active' and revoked_at is null and not reentry_blocked
 ), scopes as (select null::uuid venue_id union all select venue_id from venue_ids where venue_id is not null),
 counts as (
   select scope.venue_id,p.label,jsonb_build_object(
     'tableRequests',t.total,'tablePending',t.pending,'tableAcknowledged',t.acknowledged,'tableCompleted',t.completed,'tableCancelled',t.cancelled,
     'vipRequests',v.total,'vipPending',v.pending,'vipConfirmed',v.confirmed,'vipDeclined',v.declined,'vipCancelled',v.cancelled,'repeatVips',v.repeated
   ) metrics from scopes scope cross join periods p
   cross join lateral (
     select count(*) total,count(*) filter(where status='pending') pending,count(*) filter(where status='acknowledged') acknowledged,
       count(*) filter(where status='completed') completed,count(*) filter(where status='cancelled') cancelled
     from table_requests where created_at>=p.lo and created_at<p.hi and (scope.venue_id is null or venue_id=scope.venue_id)
   ) t
   cross join lateral (
     select count(*) total,count(*) filter(where status='pending') pending,count(*) filter(where status='confirmed') confirmed,
       count(*) filter(where status='declined') declined,count(*) filter(where status='cancelled') cancelled,
       count(distinct user_id) filter(where repeated) repeated
     from vip_requests where created_at>=p.lo and created_at<p.hi and (scope.venue_id is null or venue_id=scope.venue_id)
   ) v
 ), external_counts as (
   select scope.venue_id,jsonb_build_object(
     'claims',count(*) filter(where generated_at>=p_since and generated_at<p_until),
     'admissions',count(*) filter(where status='redeemed' and redeemed_at>=p_since and redeemed_at<p_until)
   ) metrics from scopes scope left join passes on (scope.venue_id is null or passes.venue_id=scope.venue_id) group by scope.venue_id
 ), club_rows as (
   select v.id,v.name,v.timezone,c.metrics current,p.metrics previous,e.metrics external,
     (select count(*) from vip_subscribers s where s.venue_id=v.id) "vipSubscribers"
   from venue_ids ids join public.venues v on v.id=ids.venue_id
   join counts c on c.venue_id=v.id and c.label='current'
   join counts p on p.venue_id=v.id and p.label='previous'
   join external_counts e on e.venue_id=v.id
 ), shift_rows as (
   select o.id,o.venue_id "venueId",v.name "venueName",v.timezone,o.partial,o.started_at "startedAt",o.ended_at "endedAt",
     round((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(o.intervals) piece)::numeric,2) hours,
     (select count(*) from table_requests r where r.venue_id=o.venue_id and o.intervals @> r.created_at) requests
   from observed o join public.venues v on v.id=o.venue_id
 )
 select jsonb_build_object(
   'current',(select metrics from counts where venue_id is null and label='current'),
   'previous',(select metrics from counts where venue_id is null and label='previous'),
   'external',(select metrics from external_counts where venue_id is null),
   'alerts',jsonb_build_object('total',(select count(*) from subscribers),'vip',(select count(distinct customer_id) from vip_subscribers)),
   'clubs',coalesce((select jsonb_agg(to_jsonb(c) order by name,id) from club_rows c),'[]'::jsonb),
   'shifts',coalesce((select jsonb_agg(to_jsonb(s) order by "startedAt" desc,id) from shift_rows s),'[]'::jsonb),
   'workTrackingStartedAt',(select started_at from public.venue_performance_tracking where singleton)
 ) into result;
 return result;
end;
$$;
revoke all on function public.get_dancer_performance_analytics(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_dancer_performance_analytics(uuid,timestamptz,timestamptz) to service_role;
comment on function public.get_dancer_performance_analytics(uuid,timestamptz,timestamptz) is 'Private dancer-owned request, follower alert, attributed pass and recorded shift totals; never returns guest identities.';

-- Return at most 30 aggregate points; no visitor or VIP identities leave SQL.
-- Buckets cover the exact half-open reporting window, including zero activity.
create function public.get_dancer_activity_trend(p_dancer_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  result jsonb;
  bucket_seconds numeric;
begin
  if p_dancer_id is null or p_since is null or p_until is null
    or not isfinite(p_since) or not isfinite(p_until) or p_until<=p_since then
    raise exception 'Invalid dancer trend window' using errcode='22023';
  end if;
  -- Hourly for Tonight, daily for short ranges, grouped days for All time.
  bucket_seconds := case when p_until-p_since<=interval '25 hours' then 3600
    else greatest(86400,ceil(extract(epoch from(p_until-p_since))/86400/30)*86400) end;
  with events as (
    select viewed_at happened_at,'views' kind from public.profile_views
      where dancer_id=p_dancer_id and viewed_at>=p_since and viewed_at<p_until
    union all select created_at,'followers' from public.follows
      where dancer_id=p_dancer_id and created_at>=p_since and created_at<p_until
    union all select created_at,'requests' from public.internal_roster_requests
      where dancer_id=p_dancer_id and created_at>=p_since and created_at<p_until
    union all select created_at,'requests' from public.venue_vip_requests
      where dancers @> jsonb_build_array(jsonb_build_object('id',p_dancer_id))
        and created_at>=p_since and created_at<p_until
  ), totals as (
    select floor(extract(epoch from(happened_at-p_since))/bucket_seconds)::int bucket,
      count(*) filter(where kind='views') views,
      count(*) filter(where kind='followers') followers,
      count(*) filter(where kind='requests') requests
    from events group by 1
  ), points as (
    select p_since + (bucket_seconds*b.bucket)*interval '1 second' start,
      least(p_until,p_since + (bucket_seconds*(b.bucket+1))*interval '1 second') "end",
      coalesce(t.views,0) views,coalesce(t.followers,0) followers,coalesce(t.requests,0) requests
    from generate_series(0,ceil(extract(epoch from(p_until-p_since))/bucket_seconds)::int-1) b(bucket)
    left join totals t using(bucket)
  ) select coalesce(jsonb_agg(to_jsonb(p) order by p.start),'[]'::jsonb) into result from points p;
  return result;
end;
$$;
revoke all on function public.get_dancer_activity_trend(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_dancer_activity_trend(uuid,timestamptz,timestamptz) to service_role;
comment on function public.get_dancer_activity_trend(uuid,timestamptz,timestamptz) is 'Server-only dancer-owned aggregate activity. Requests include table and VIP requests; followers are still-active follows by creation time.';
commit;
