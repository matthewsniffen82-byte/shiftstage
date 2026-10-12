begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.venue_performance_tracking add column results_started_at timestamptz not null default clock_timestamp();
alter table public.internal_roster_requests
  add column attendance text check(attendance in ('arrived','no_show')),
  add column attendance_recorded_at timestamptz,
  add column attendance_recorded_by uuid references public.app_users(id) on delete set null;
create index internal_requests_attendance_actor on public.internal_roster_requests(attendance_recorded_by);

-- An explicit checkout is distinct from the expiry of a verified presence window.
-- No historical check-ins or attendance confirmations are invented.
create table public.venue_dancer_attendance_events (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  kind text not null check(kind in ('check_in','check_out')),
  occurred_at timestamptz not null,
  unique(shift_id,kind,occurred_at)
);
create index venue_dancer_attendance_period on public.venue_dancer_attendance_events(venue_id,occurred_at,dancer_id);
create index venue_dancer_attendance_dancer on public.venue_dancer_attendance_events(dancer_id);
alter table public.venue_dancer_attendance_events enable row level security;
revoke all on public.venue_dancer_attendance_events from public,anon,authenticated,service_role;
grant select on public.venue_dancer_attendance_events to service_role;
create policy venue_dancer_attendance_service on public.venue_dancer_attendance_events for select to service_role using(true);

-- Only the shift trigger can append to this private ledger; no direct RPC access.
create function public.capture_dancer_attendance_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='posted' and new.checked_in_at is not null and new.checked_out_at is null
    and new.location_status='club_confirmed' and new.location_verification_expires_at>clock_timestamp()
    and (tg_op='INSERT' or new.checked_in_at is distinct from old.checked_in_at or old.location_status is distinct from 'club_confirmed') then
    insert into public.venue_dancer_attendance_events(shift_id,venue_id,dancer_id,kind,occurred_at)
      values(new.id,new.venue_id,new.dancer_id,'check_in',new.checked_in_at) on conflict do nothing;
  end if;
  if tg_op='UPDATE' and new.checked_out_at is not null and old.checked_out_at is distinct from new.checked_out_at
    and old.checked_in_at is not null and new.checked_out_at>=old.checked_in_at then
    insert into public.venue_dancer_attendance_events(shift_id,venue_id,dancer_id,kind,occurred_at)
      values(new.id,old.venue_id,old.dancer_id,'check_out',new.checked_out_at) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.capture_dancer_attendance_event() from public,anon,authenticated,service_role;
create trigger capture_dancer_attendance_event after insert or update of checked_in_at,checked_out_at,location_status on public.shifts
for each row execute function public.capture_dancer_attendance_event();

create function public.record_internal_request_attendance(p_actor uuid,p_venue uuid,p_request uuid,p_expected_status text,p_attendance text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.internal_roster_requests;
begin
  if not public.internal_roster_access(p_actor,p_venue) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_attendance is null or p_attendance not in ('arrived','no_show') then raise exception 'INVALID_ATTENDANCE' using errcode='22023'; end if;
  select * into r from public.internal_roster_requests where id=p_request and venue_id=p_venue for update;
  if not found then raise exception 'REQUEST_UNAVAILABLE' using errcode='P0002'; end if;
  if r.attendance=p_attendance then return jsonb_build_object('id',r.id,'attendance',r.attendance); end if;
  if r.attendance is not null or r.status is distinct from p_expected_status or r.status<>'acknowledged' then
    raise exception 'REQUEST_CHANGED' using errcode='40001';
  end if;
  update public.internal_roster_requests set attendance=p_attendance,attendance_recorded_at=clock_timestamp(),attendance_recorded_by=p_actor,
    status=case when p_attendance='no_show' then 'cancelled' else status end,updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('id',r.id,'attendance',p_attendance);
end $$;
revoke all on function public.record_internal_request_attendance(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_internal_request_attendance(uuid,uuid,uuid,text,text) to service_role;

-- Keep the established report intact and add private aggregates to its dancer rows.
alter function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) rename to get_venue_performance_channels;
create function public.get_venue_performance_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz,p_tonight_since timestamptz,p_tonight_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare base jsonb; additions jsonb; merged jsonb;
begin
  base := public.get_venue_performance_channels(p_venue_id,p_since,p_until,p_tonight_since,p_tonight_until);
  with periods as (
    select 'current'::text label,p_since lo,p_until hi union all select 'previous',p_since-(p_until-p_since),p_since
  ), passes as materialized (
    select q.id,q.dancer_id,q.generated_at,case when q.status='redeemed' then q.redeemed_at end converted_at
    from public.qr_redemptions q where q.venue_id=p_venue_id and q.source_type='dancer_profile' and q.dancer_id is not null
      and q.admission_pass_version=1 and q.status in ('generated','redeemed','expired') and q.voided_at is null
      and (q.generated_at>=p_since-(p_until-p_since) or q.redeemed_at>=p_since-(p_until-p_since))
  ), ids as (
    select (x->>'id')::uuid id from jsonb_array_elements(base->'performance'->'dancers') x
    union select dancer_id from public.venue_dancer_attendance_events where venue_id=p_venue_id and occurred_at>=p_since and occurred_at<p_until
    union select dancer_id from passes where converted_at>=p_since and converted_at<p_until
  ), dimensions as (
    select p.*,null::uuid dancer_id from periods p
    union all select 'dancer',p_since,p_until,id from ids
  ), rows as (
    select p.label,p.dancer_id,jsonb_build_object(
      'checkIns',a.check_ins,'checkOuts',a.check_outs,'lastCheckInAt',a.last_in,'lastCheckOutAt',a.last_out,
      'tableArrived',r.arrived,'tableNoShows',r.no_shows,'tableAttendanceUnrecorded',r.unrecorded,
      'showUpPercent',case when r.arrived+r.no_shows>0 then round(100.0*r.arrived/(r.arrived+r.no_shows),1) end,
      'profileConversions',q.conversions,'profileClaims',q.claims,
      'profileCohortConversions',q.cohort,'profileConversionPercent',case when q.claims>0 then round(100.0*q.cohort/q.claims,1) end
    ) metrics from dimensions p
    cross join lateral (
      select count(*) filter(where kind='check_in') check_ins,count(*) filter(where kind='check_out') check_outs,
        max(occurred_at) filter(where kind='check_in') last_in,max(occurred_at) filter(where kind='check_out') last_out
      from public.venue_dancer_attendance_events where venue_id=p_venue_id and occurred_at>=p.lo and occurred_at<p.hi and (p.dancer_id is null or dancer_id=p.dancer_id)
    ) a
    cross join lateral (
      select count(*) filter(where attendance='arrived') arrived,count(*) filter(where attendance='no_show') no_shows,
        count(*) filter(where attendance is null and status<>'cancelled') unrecorded
      from public.internal_roster_requests where venue_id=p_venue_id and created_at>=p.lo and created_at<p.hi and (p.dancer_id is null or dancer_id=p.dancer_id)
    ) r
    cross join lateral (
      select count(*) filter(where converted_at>=p.lo and converted_at<p.hi) conversions,
        count(*) filter(where generated_at>=p.lo and generated_at<p.hi) claims,
        count(*) filter(where generated_at>=p.lo and generated_at<p.hi and converted_at<p.hi) cohort
      from passes where p.dancer_id is null or dancer_id=p.dancer_id
    ) q
  ) select jsonb_build_object('current',(select metrics from rows where label='current'),
    'previous',(select metrics from rows where label='previous'),
    'dancers',coalesce((select jsonb_agg(jsonb_build_object('id',dancer_id,'metrics',metrics)) from rows where label='dancer'),'[]'::jsonb)) into additions;

  select coalesce(jsonb_agg(coalesce(old.value,jsonb_build_object('id',d.id,'name',d.stage_name,'internal','{}'::jsonb,'external','{}'::jsonb,'vip','{}'::jsonb))
    ||jsonb_build_object('results',x->'metrics') order by d.stage_name,d.id),'[]'::jsonb) into merged
  from jsonb_array_elements(additions->'dancers') x join public.dancer_profiles d on d.id=(x->>'id')::uuid
  left join lateral (select value from jsonb_array_elements(base->'performance'->'dancers') where value->>'id'=d.id::text) old on true;
  base := jsonb_set(base,'{performance,dancers}',merged);
  base := jsonb_set(base,'{performance,current}',(base#>'{performance,current}')||(additions->'current'));
  base := jsonb_set(base,'{performance,previous}',(base#>'{performance,previous}')||(additions->'previous'));
  return jsonb_set(base,'{performance,resultsStartedAt}',to_jsonb((select results_started_at from public.venue_performance_tracking)));
end $$;
revoke all on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
