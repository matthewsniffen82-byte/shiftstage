begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Observe actual time in Both prospectively; current settings cannot prove past mode.
alter table public.venue_dancer_work_sessions
  add column both_roster_periods tstzmultirange not null default '{}',
  add column both_roster_started_at timestamptz;

create function public.capture_venue_both_roster_period() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare stamp timestamptz := clock_timestamp(); in_both boolean; finish timestamptz;
begin
  in_both := new.dancer_check_in_at is not null and new.closed_at is null and new.expires_at>stamp
    and exists(select 1 from public.dancer_shift_channels c
      join public.dancer_channel_preferences p on p.dancer_id=c.dancer_id and p.visibility='both'
      where c.shift_id=new.shift_id and c.dancer_id=new.dancer_id and c.venue_id=new.venue_id and c.visibility='both');
  if tg_op='UPDATE' and old.both_roster_started_at is not null then
    if in_both and old.expires_at>stamp then
      new.both_roster_started_at := old.both_roster_started_at;
      return new;
    end if;
    finish := least(stamp,new.expires_at,new.closed_at,old.expires_at);
    if finish>old.both_roster_started_at then
      new.both_roster_periods := old.both_roster_periods
        + tstzmultirange(tstzrange(old.both_roster_started_at,finish,'[)'));
    end if;
    new.both_roster_started_at := null;
  end if;
  if in_both then new.both_roster_started_at := greatest(stamp,new.started_at);
  else new.both_roster_started_at := null; end if;
  return new;
end $$;
revoke all on function public.capture_venue_both_roster_period() from public,anon,authenticated,service_role;
create trigger capture_venue_both_roster_period before insert or update on public.venue_dancer_work_sessions
  for each row execute function public.capture_venue_both_roster_period();

-- The verified tap writes the shift before its channel record; observe both writes.
-- Preferences can also narrow an existing shift's visibility, so observe them too.
create function public.capture_venue_roster_mode_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare previous_id uuid; next_id uuid;
begin
  if tg_table_name='dancer_shift_channels' then
    if tg_op<>'INSERT' then previous_id:=old.shift_id; end if;
    if tg_op<>'DELETE' then next_id:=new.shift_id; end if;
    update public.venue_dancer_work_sessions set expires_at=expires_at
      where shift_id in (previous_id,next_id) and closed_at is null and dancer_check_in_at is not null;
  else
    if tg_op<>'INSERT' then previous_id:=old.dancer_id; end if;
    if tg_op<>'DELETE' then next_id:=new.dancer_id; end if;
    update public.venue_dancer_work_sessions set expires_at=expires_at
      where dancer_id in (previous_id,next_id) and closed_at is null and dancer_check_in_at is not null;
  end if;
  return null;
end $$;
revoke all on function public.capture_venue_roster_mode_change() from public,anon,authenticated,service_role;
create trigger capture_venue_shift_roster_mode after insert or update or delete on public.dancer_shift_channels
  for each row execute function public.capture_venue_roster_mode_change();
create trigger capture_venue_preferred_roster_mode after insert or update or delete on public.dancer_channel_preferences
  for each row execute function public.capture_venue_roster_mode_change();

-- Begin observing existing verified visits now, without crediting earlier hours.
update public.venue_dancer_work_sessions set expires_at=expires_at
  where closed_at is null and dancer_check_in_at is not null and expires_at>clock_timestamp();

create or replace function public.get_venue_performance_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz,p_tonight_since timestamptz,p_tonight_until timestamptz)
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
  ), hours as (
    select dancer_id,range_agg(tstzrange(lo,hi,'[)')) intervals,
      range_agg((both_roster_periods * tstzmultirange(tstzrange(lo,hi,'[)')))
        + case when both_roster_started_at<hi then tstzmultirange(tstzrange(greatest(lo,both_roster_started_at),hi,'[)'))
          else '{}'::tstzmultirange end) both_intervals
    from visits group by dancer_id
  ), metrics as (
    select h.dancer_id,jsonb_build_object(
      'rosterTrackedHours',(select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.intervals) piece),
      'rosterBothHours',coalesce((select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.both_intervals) piece),0),
      'verifiedCheckInDays',count(*),'checkoutEligibleDays',count(*) filter(where d.eligible),
      'dancerCheckoutDays',count(*) filter(where d.eligible and d.complete),
      'activeCheckInDays',count(*) filter(where d.active)) payload
    from hours h join days d using(dancer_id) group by h.dancer_id,h.intervals,h.both_intervals
  )
  select coalesce(jsonb_agg(jsonb_set(item,'{internal}',coalesce(item->'internal','{}'::jsonb) || coalesce(m.payload,
    '{"rosterTrackedHours":0,"rosterBothHours":0,"verifiedCheckInDays":0,"checkoutEligibleDays":0,"dancerCheckoutDays":0,"activeCheckInDays":0}'::jsonb)) order by position),'[]'::jsonb)
  into dancers from jsonb_array_elements(base->'performance'->'dancers') with ordinality entries(item,position)
  left join metrics m on m.dancer_id::text=item->>'id';
  return jsonb_set(base,'{performance,dancers}',dancers);
end $$;
revoke all on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
commit;
