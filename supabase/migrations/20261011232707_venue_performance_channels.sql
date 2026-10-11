begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Do not infer historical transitions from updated_at: notes and selections also edit it.
alter table public.venue_vip_requests
  add column first_responded_at timestamptz,
  add column confirmed_at timestamptz,
  add column declined_at timestamptz,
  add column cancelled_at timestamptz;
alter table public.internal_roster_requests
  add column acknowledged_at timestamptz,
  add column completed_at timestamptz,
  add column cancelled_at timestamptz;

create table public.venue_performance_tracking (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default clock_timestamp()
);
insert into public.venue_performance_tracking(singleton) values(true);
alter table public.venue_performance_tracking enable row level security;
revoke all on public.venue_performance_tracking from public, anon, authenticated;
grant select on public.venue_performance_tracking to service_role;
create policy venue_performance_tracking_service on public.venue_performance_tracking for select to service_role using(true);

create function public.capture_vip_request_times() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare stamp timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE' then
    new.first_responded_at := old.first_responded_at;
    new.confirmed_at := old.confirmed_at;
    new.declined_at := old.declined_at;
    new.cancelled_at := old.cancelled_at;
    if new.status is not distinct from old.status then return new; end if;
  else
    new.first_responded_at := null; new.confirmed_at := null;
    new.declined_at := null; new.cancelled_at := null;
  end if;
  if new.status in ('confirmed','declined') then new.first_responded_at := coalesce(new.first_responded_at,stamp); end if;
  if new.status = 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at,stamp); end if;
  if new.status = 'declined' then new.declined_at := coalesce(new.declined_at,stamp); end if;
  if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at,stamp); end if;
  return new;
end $$;
create trigger capture_vip_request_times before insert or update on public.venue_vip_requests
  for each row execute function public.capture_vip_request_times();

create function public.capture_internal_request_times() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare stamp timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE' then
    new.acknowledged_at := old.acknowledged_at;
    new.completed_at := old.completed_at;
    new.cancelled_at := old.cancelled_at;
    if new.status is not distinct from old.status then return new; end if;
  else
    new.acknowledged_at := null; new.completed_at := null; new.cancelled_at := null;
  end if;
  if new.status = 'acknowledged' then new.acknowledged_at := coalesce(new.acknowledged_at,stamp); end if;
  if new.status = 'completed' then new.completed_at := coalesce(new.completed_at,stamp); end if;
  if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at,stamp); end if;
  return new;
end $$;
create trigger capture_internal_request_times before insert or update on public.internal_roster_requests
  for each row execute function public.capture_internal_request_times();
revoke all on function public.capture_vip_request_times(), public.capture_internal_request_times() from public,anon,authenticated;

-- Preserve presence intervals even if a shift is reused or removed. Start existing
-- check-ins at deployment, never backfill hours that were not observed.
create table public.venue_dancer_work_sessions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  closed_at timestamptz,
  check(expires_at >= started_at), check(closed_at is null or closed_at >= started_at)
);
create unique index venue_dancer_work_sessions_open on public.venue_dancer_work_sessions(shift_id) where closed_at is null;
create index venue_dancer_work_sessions_period on public.venue_dancer_work_sessions(venue_id,expires_at,started_at);
create index venue_dancer_work_sessions_dancer on public.venue_dancer_work_sessions(dancer_id);
alter table public.venue_dancer_work_sessions enable row level security;
revoke all on public.venue_dancer_work_sessions from public,anon,authenticated;
grant select on public.venue_dancer_work_sessions to service_role;
create policy venue_dancer_work_sessions_service on public.venue_dancer_work_sessions for select to service_role using(true);

-- Definer is needed only for the trigger to write its private ledger. It is not callable by clients.
create function public.capture_venue_work_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare stamp timestamptz := clock_timestamp(); active boolean; session public.venue_dancer_work_sessions;
begin
  if tg_op = 'DELETE' then
    update public.venue_dancer_work_sessions set closed_at=greatest(started_at,least(stamp,expires_at))
      where shift_id=old.id and closed_at is null;
    return old;
  end if;
  active := new.status='posted' and new.checked_in_at is not null and new.checked_out_at is null
    and new.location_status='club_confirmed' and new.location_verification_expires_at>stamp;
  select * into session from public.venue_dancer_work_sessions where shift_id=new.id and closed_at is null for update;
  if found then
    if active and session.expires_at>stamp and session.venue_id=new.venue_id and session.dancer_id=new.dancer_id then
      update public.venue_dancer_work_sessions set expires_at=new.location_verification_expires_at where id=session.id;
      return new;
    end if;
    update public.venue_dancer_work_sessions set closed_at=greatest(started_at,least(stamp,expires_at,new.checked_out_at,new.location_verification_expires_at)) where id=session.id;
  end if;
  if active then
    insert into public.venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at)
      values(new.id,new.venue_id,new.dancer_id,stamp,new.location_verification_expires_at);
  end if;
  return new;
end $$;
create trigger capture_venue_work_session after insert or update of status,venue_id,dancer_id,checked_in_at,checked_out_at,location_status,location_verification_expires_at or delete on public.shifts
  for each row execute function public.capture_venue_work_session();
revoke all on function public.capture_venue_work_session() from public,anon,authenticated;
insert into public.venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at)
select s.id,s.venue_id,s.dancer_id,t.started_at,s.location_verification_expires_at
from public.shifts s cross join public.venue_performance_tracking t
where s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
  and s.location_status='club_confirmed' and s.location_verification_expires_at>clock_timestamp();

create index venue_vip_requests_repeat on public.venue_vip_requests(venue_id,user_id,created_at);
create index venue_vip_requests_scheduled on public.venue_vip_requests(venue_id,starts_at) where status in ('pending','confirmed');
create index internal_roster_requests_period on public.internal_roster_requests(venue_id,created_at,dancer_id);

-- One private aggregate avoids API row limits. Existing click/TV attribution stays intact.
create function public.get_venue_performance_analytics(
  p_venue_id uuid,p_since timestamptz,p_until timestamptz,p_tonight_since timestamptz,p_tonight_until timestamptz
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare base jsonb; result jsonb;
begin
  if p_tonight_since is null or p_tonight_until is null or not isfinite(p_tonight_since) or not isfinite(p_tonight_until)
    or p_tonight_until<=p_tonight_since or p_tonight_until-p_tonight_since>interval '26 hours' then
    raise exception 'Invalid tonight window' using errcode='22023';
  end if;
  base := public.get_venue_subscription_analytics(p_venue_id,p_since,p_until);
  with periods as (
    select 'current'::text label,p_since lo,p_until hi
    union all select 'previous',p_since-(p_until-p_since),p_since
  ), totals as (
    select p.label,jsonb_build_object(
      'guestList',(select count(*) from public.venue_guest_list_entries g where g.venue_id=p_venue_id and g.created_at>=p.lo and g.created_at<p.hi),
      'vipRequests',v.total,'vipPending',v.pending,'vipConfirmed',v.confirmed,'vipDeclined',v.declined,'vipCancelled',v.cancelled,
      'tableRequests',i.total,'tablePending',i.pending,'tableAcknowledged',i.acknowledged,'tableCompleted',i.completed,'tableCancelled',i.cancelled,
      'vipResponseMinutes',v.response_minutes,'vipResponseSamples',v.response_samples,
      'tableResponseMinutes',i.response_minutes,'tableResponseSamples',i.response_samples,
      'tableCompletionMinutes',i.completion_minutes,'tableCompletionSamples',i.completion_samples
    ) metrics from periods p
    cross join lateral (
      select count(*) total,count(*) filter(where status='pending') pending,count(*) filter(where status='confirmed') confirmed,
        count(*) filter(where status='declined') declined,count(*) filter(where status='cancelled') cancelled,
        percentile_cont(0.5) within group(order by extract(epoch from(first_responded_at-created_at))/60)
          filter(where first_responded_at>=created_at) response_minutes,
        count(*) filter(where first_responded_at>=created_at) response_samples
      from public.venue_vip_requests where venue_id=p_venue_id and created_at>=p.lo and created_at<p.hi
    ) v
    cross join lateral (
      select count(*) total,count(*) filter(where status='pending') pending,count(*) filter(where status='acknowledged') acknowledged,
        count(*) filter(where status='completed') completed,count(*) filter(where status='cancelled') cancelled,
        percentile_cont(0.5) within group(order by extract(epoch from(acknowledged_at-created_at))/60)
          filter(where acknowledged_at>=created_at) response_minutes,
        count(*) filter(where acknowledged_at>=created_at) response_samples,
        percentile_cont(0.5) within group(order by extract(epoch from(completed_at-created_at))/60)
          filter(where completed_at>=created_at) completion_minutes,
        count(*) filter(where completed_at>=created_at) completion_samples
      from public.internal_roster_requests where venue_id=p_venue_id and created_at>=p.lo and created_at<p.hi
    ) i
  ), internal as (
    select dancer_id,jsonb_build_object('requests',count(*),'pending',count(*) filter(where status='pending'),
      'acknowledged',count(*) filter(where status='acknowledged'),'completed',count(*) filter(where status='completed'),
      'cancelled',count(*) filter(where status='cancelled'),
      'responseMinutes',percentile_cont(0.5) within group(order by extract(epoch from(acknowledged_at-created_at))/60) filter(where acknowledged_at>=created_at),
      'responseSamples',count(*) filter(where acknowledged_at>=created_at),
      'completionMinutes',percentile_cont(0.5) within group(order by extract(epoch from(completed_at-created_at))/60) filter(where completed_at>=created_at),
      'completionSamples',count(*) filter(where completed_at>=created_at)) metrics
    from public.internal_roster_requests where venue_id=p_venue_id and created_at>=p_since and created_at<p_until group by dancer_id
  ), vip_selections as materialized (
    select distinct r.id,r.user_id,r.created_at,r.status,d.id dancer_id
    from public.venue_vip_requests r cross join lateral jsonb_array_elements(r.dancers) choice
    join public.dancer_profiles d on d.id::text=choice->>'id'
    where r.venue_id=p_venue_id and r.created_at>=p_since and r.created_at<p_until
  ), vip as (
    select s.dancer_id,jsonb_build_object('requests',count(*),'pending',count(*) filter(where s.status='pending'),
      'confirmed',count(*) filter(where s.status='confirmed'),'declined',count(*) filter(where s.status='declined'),
      'cancelled',count(*) filter(where s.status='cancelled'),
      'repeatRequesters',count(distinct s.user_id) filter(where exists(
        select 1 from public.venue_vip_requests earlier where earlier.venue_id=p_venue_id and earlier.user_id=s.user_id
          and earlier.created_at<s.created_at and earlier.dancers @> jsonb_build_array(jsonb_build_object('id',s.dancer_id))
      ))) metrics from vip_selections s group by s.dancer_id
  ), external as (
    select x.id::uuid dancer_id,x.metrics from jsonb_to_recordset(base->'dancers') x(id text,metrics jsonb)
  ), observed as (
    select dancer_id,range_agg(tstzrange(greatest(started_at,p_since),least(expires_at,coalesce(closed_at,expires_at),p_until),'[)')) intervals
    from public.venue_dancer_work_sessions where venue_id=p_venue_id and started_at<p_until
      and least(expires_at,coalesce(closed_at,expires_at))>p_since
      and least(expires_at,coalesce(closed_at,expires_at),p_until)>greatest(started_at,p_since)
    group by dancer_id
  ), hours as (
    select o.dancer_id,(select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(o.intervals) piece) hours,
      (select count(*) from public.internal_roster_requests r where r.venue_id=p_venue_id and r.dancer_id=o.dancer_id
        and r.created_at>=p_since and r.created_at<p_until and o.intervals @> r.created_at) requests
    from observed o
  ), dancer_ids as (
    select dancer_id from internal union select dancer_id from vip union select dancer_id from external union select dancer_id from hours
  ), dancer_rows as (
    select d.id,d.stage_name name,
      coalesce(i.metrics,'{}'::jsonb)||jsonb_build_object('checkedInHours',coalesce(h.hours,0),'requestsDuringHours',coalesce(h.requests,0),
        'requestsPerHour',case when h.hours>0 then h.requests/h.hours else null end) internal,
      coalesce(e.metrics,'{}'::jsonb) external,coalesce(v.metrics,'{}'::jsonb) vip
    from dancer_ids ids join public.dancer_profiles d on d.id=ids.dancer_id
    left join internal i on i.dancer_id=d.id left join external e on e.dancer_id=d.id left join vip v on v.dancer_id=d.id left join hours h on h.dancer_id=d.id
  )
  select jsonb_build_object(
    'trackingStartedAt',(select started_at from public.venue_performance_tracking),
    'current',(select metrics from totals where label='current'),'previous',(select metrics from totals where label='previous'),
    'dancers',coalesce((select jsonb_agg(to_jsonb(d) order by d.name,d.id) from dancer_rows d),'[]'::jsonb),
    'tonight',jsonb_build_object(
      'vipPending',(select count(*) from public.venue_vip_requests where venue_id=p_venue_id and starts_at>=p_tonight_since and starts_at<p_tonight_until and status='pending'),
      'vipConfirmed',(select count(*) from public.venue_vip_requests where venue_id=p_venue_id and starts_at>=p_tonight_since and starts_at<p_tonight_until and status='confirmed'),
      'tablePending',(select count(*) from public.internal_roster_requests where venue_id=p_venue_id and status='pending' and created_at>=p_until-interval '6 hours' and created_at<p_until),
      'tableAcknowledged',(select count(*) from public.internal_roster_requests where venue_id=p_venue_id and status='acknowledged' and created_at>=p_until-interval '6 hours' and created_at<p_until),
      'guestListExpected',(select count(*) from public.venue_guest_list_entries g join public.qr_redemptions q on q.id=g.pass_id and q.venue_id=g.venue_id
        where g.venue_id=p_venue_id and q.status='generated' and q.generated_at<p_until and q.expires_at>p_until and q.generated_at<p_tonight_until)
    )
  ) into result;
  return base||jsonb_build_object('performance',result);
end $$;
revoke all on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;

notify pgrst,'reload schema';
commit;
