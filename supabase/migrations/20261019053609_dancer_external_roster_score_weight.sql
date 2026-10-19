begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- External includes Both. Keep the existing Both ledger for attendance reporting.
-- Unknown historical External-only time must not be inferred from current settings.
alter table public.venue_dancer_work_sessions
  add column external_roster_periods tstzmultirange not null default '{}',
  add column external_roster_started_at timestamptz,
  add column external_roster_observed_at timestamptz;

create function public.capture_venue_external_roster_period() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare stamp timestamptz := clock_timestamp(); in_external boolean; finish timestamptz;
begin
  -- Start observing either mode now. Historical Internal/External-only settings
  -- are unknown; known Both intervals remain usable evidence in the report.
  if new.external_roster_observed_at is null and new.dancer_check_in_at is not null
    and new.closed_at is null and new.expires_at>stamp then
    new.external_roster_observed_at := greatest(stamp,new.started_at);
  end if;
  in_external := new.dancer_check_in_at is not null and new.closed_at is null and new.expires_at>stamp
    and exists(select 1 from public.dancer_shift_channels c
      join public.dancer_channel_preferences p on p.dancer_id=c.dancer_id and p.visibility in ('external','both')
      where c.shift_id=new.shift_id and c.dancer_id=new.dancer_id and c.venue_id=new.venue_id
        and c.visibility in ('external','both'));
  if tg_op='UPDATE' and old.external_roster_started_at is not null then
    if in_external and old.expires_at>stamp then
      new.external_roster_started_at := old.external_roster_started_at;
      return new;
    end if;
    finish := least(stamp,new.expires_at,new.closed_at,old.expires_at);
    if finish>old.external_roster_started_at then
      new.external_roster_periods := old.external_roster_periods
        + tstzmultirange(tstzrange(old.external_roster_started_at,finish,'[)'));
    end if;
    new.external_roster_started_at := null;
  end if;
  if in_external then new.external_roster_started_at := greatest(stamp,new.started_at);
  else new.external_roster_started_at := null; end if;
  return new;
end $$;
revoke all on function public.capture_venue_external_roster_period() from public,anon,authenticated,service_role;
create trigger capture_venue_external_roster_period before insert or update on public.venue_dancer_work_sessions
  for each row execute function public.capture_venue_external_roster_period();

-- Existing channel/preference triggers already update each active work session,
-- which now captures External as well as Both transitions, repeat taps and checkout.
update public.venue_dancer_work_sessions set expires_at=expires_at
  where closed_at is null and dancer_check_in_at is not null and expires_at>clock_timestamp();

-- Replace only the scoring layer; preserve automatic results and the API wrapper.
create or replace function public.get_venue_performance_scored_dancers(p_venue_id uuid,p_since timestamptz,p_until timestamptz,p_tonight_since timestamptz,p_tonight_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare base jsonb; dancers jsonb;
begin
  base := public.get_venue_performance_customer_scores(p_venue_id,p_since,p_until,p_tonight_since,p_tonight_until);
  with visits as materialized (
    select s.*,greatest(s.started_at,p_since) lo,least(s.expires_at,coalesce(s.closed_at,s.expires_at),p_until) hi,
      least(s.expires_at,coalesce(s.closed_at,s.expires_at))<=p_until
        and coalesce(s.closure_reason,'expired')<>'interrupted' eligible,
      s.dancer_check_out_at is not null and s.dancer_check_out_at<=s.expires_at and s.dancer_check_out_at<=p_until complete
    from public.venue_dancer_work_sessions s
    where s.venue_id=p_venue_id and s.dancer_check_in_at is not null and s.started_at<p_until
      and least(s.expires_at,coalesce(s.closed_at,s.expires_at),p_until)>greatest(s.started_at,p_since)
  ), days as (
    select dancer_id,check_in_day,bool_or(eligible) eligible,
      bool_and(complete) filter(where eligible) complete,
      bool_or(least(expires_at,coalesce(closed_at,expires_at))>p_until) active
    from visits group by dancer_id,check_in_day
  ), mode_intervals as (
    select dancer_id,lo,hi,
      (both_roster_periods * tstzmultirange(tstzrange(lo,hi,'[)')))
        + case when both_roster_started_at<hi then tstzmultirange(tstzrange(greatest(lo,both_roster_started_at),hi,'[)'))
          else '{}'::tstzmultirange end both_intervals,
      (external_roster_periods * tstzmultirange(tstzrange(lo,hi,'[)')))
        + case when external_roster_started_at<hi then tstzmultirange(tstzrange(greatest(lo,external_roster_started_at),hi,'[)'))
          else '{}'::tstzmultirange end external_intervals,
      case when external_roster_observed_at<hi then tstzmultirange(tstzrange(greatest(lo,external_roster_observed_at),hi,'[)'))
        else '{}'::tstzmultirange end observed_intervals
    from visits
  ), hours as (
    select dancer_id,range_agg(tstzrange(lo,hi,'[)')) intervals,
      range_agg(both_intervals) both_intervals,
      -- Union, never sum: known Both history proves External participation but
      -- overlapping sessions or Both/External records must not earn double credit.
      range_agg(both_intervals + external_intervals) external_intervals,
      range_agg(observed_intervals + both_intervals + external_intervals) external_observed_intervals
    from mode_intervals group by dancer_id
  ), metrics as (
    select h.dancer_id,jsonb_build_object(
      'rosterTrackedHours',(select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.intervals) piece),
      'rosterBothHours',coalesce((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.both_intervals) piece),0),
      'rosterExternalHours',coalesce((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.external_intervals) piece),0),
      'rosterExternalTrackedHours',coalesce((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.external_observed_intervals) piece),0),
      'verifiedCheckInDays',count(*),'checkoutEligibleDays',count(*) filter(where d.eligible),
      'dancerCheckoutDays',count(*) filter(where d.eligible and d.complete),
      'activeCheckInDays',count(*) filter(where d.active)) payload
    from hours h join days d using(dancer_id) group by h.dancer_id,h.intervals,h.both_intervals,h.external_intervals,h.external_observed_intervals
  )
  select coalesce(jsonb_agg(jsonb_set(item,'{internal}',coalesce(item->'internal','{}'::jsonb) || coalesce(m.payload,
    '{"rosterTrackedHours":0,"rosterBothHours":0,"rosterExternalHours":0,"rosterExternalTrackedHours":0,"verifiedCheckInDays":0,"checkoutEligibleDays":0,"dancerCheckoutDays":0,"activeCheckInDays":0}'::jsonb)) order by position),'[]'::jsonb)
  into dancers from jsonb_array_elements(base->'performance'->'dancers') with ordinality entries(item,position)
  left join metrics m on m.dancer_id::text=item->>'id';
  return jsonb_set(base,'{performance,dancers}',dancers);
end $$;
revoke all on function public.get_venue_performance_scored_dancers(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_scored_dancers(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
commit;
