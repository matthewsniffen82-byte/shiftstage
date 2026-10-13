begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Capture provenance prospectively. Historical session actors cannot be inferred.
alter table public.venue_dancer_work_sessions
  add column dancer_check_in_at timestamptz,
  add column check_in_day date,
  add column dancer_check_out_at timestamptz,
  add column closure_reason text check (closure_reason in ('dancer','expired','venue','interrupted'));
create index venue_work_accuracy_period on public.venue_dancer_work_sessions(venue_id,started_at)
  where dancer_check_in_at is not null;

-- Keep this trigger-only ledger writer private. Shift verification fields are server-owned.
create or replace function public.capture_venue_work_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare stamp timestamptz := clock_timestamp(); active boolean; session public.venue_dancer_work_sessions;
  own_checkout boolean; verified boolean; club_zone text;
begin
  if tg_op='DELETE' then
    update public.venue_dancer_work_sessions
      set closed_at=greatest(started_at,least(stamp,expires_at)),
        closure_reason=case when expires_at<=stamp then 'expired' else 'interrupted' end
      where shift_id=old.id and closed_at is null;
    return old;
  end if;
  active := new.status='posted' and new.checked_in_at is not null and new.checked_out_at is null
    and new.location_status='club_confirmed' and new.location_verification_expires_at>stamp;
  verified := new.shift_source in ('nfc_presence','scheduled') and new.nfc_tag_id is not null;
  select * into session from public.venue_dancer_work_sessions where shift_id=new.id and closed_at is null for update;
  if found then
    if active and session.expires_at>stamp and session.venue_id=new.venue_id and session.dancer_id=new.dancer_id then
      update public.venue_dancer_work_sessions set expires_at=new.location_verification_expires_at where id=session.id;
      return new;
    end if;
    own_checkout := tg_op='UPDATE' and new.ended_reason='manual' and old.checked_out_at is null
      and new.checked_out_at>=session.started_at and new.checked_out_at<=session.expires_at
      and new.venue_id=session.venue_id and new.dancer_id=session.dancer_id
      and session.dancer_check_in_at is not null;
    update public.venue_dancer_work_sessions
      set closed_at=greatest(started_at,least(stamp,expires_at,new.checked_out_at,new.location_verification_expires_at)),
        dancer_check_out_at=case when own_checkout then new.checked_out_at end,
        closure_reason=case when own_checkout then 'dancer' when session.expires_at<=stamp then 'expired'
          when new.ended_reason='venue_checkout' then 'venue' else 'interrupted' end
      where id=session.id;
  end if;
  if active then
    select timezone into club_zone from public.venues where id=new.venue_id;
    insert into public.venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at,dancer_check_in_at,check_in_day)
      values(new.id,new.venue_id,new.dancer_id,stamp,new.location_verification_expires_at,
        case when verified then stamp end,case when verified then (stamp at time zone coalesce(nullif(club_zone,''),'UTC'))::date end);
  end if;
  return new;
end $$;
revoke all on function public.capture_venue_work_session() from public,anon,authenticated,service_role;

alter function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz)
  rename to get_venue_performance_customer_scores;
create function public.get_venue_performance_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz,p_tonight_since timestamptz,p_tonight_until timestamptz)
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
    select dancer_id,range_agg(tstzrange(lo,hi,'[)')) intervals from visits group by dancer_id
  ), metrics as (
    select h.dancer_id,jsonb_build_object(
      'rosterTrackedHours',(select sum(extract(epoch from(upper(piece)-lower(piece))))/3600 from unnest(h.intervals) piece),
      'verifiedCheckInDays',count(*),'checkoutEligibleDays',count(*) filter(where d.eligible),
      'dancerCheckoutDays',count(*) filter(where d.eligible and d.complete),
      'activeCheckInDays',count(*) filter(where d.active)) payload
    from hours h join days d using(dancer_id) group by h.dancer_id,h.intervals
  )
  select coalesce(jsonb_agg(jsonb_set(item,'{internal}',coalesce(item->'internal','{}'::jsonb) || coalesce(m.payload,
    '{"rosterTrackedHours":0,"verifiedCheckInDays":0,"checkoutEligibleDays":0,"dancerCheckoutDays":0,"activeCheckInDays":0}'::jsonb)) order by position),'[]'::jsonb)
  into dancers from jsonb_array_elements(base->'performance'->'dancers') with ordinality entries(item,position)
  left join metrics m on m.dancer_id::text=item->>'id';
  return jsonb_set(base,'{performance,dancers}',dancers);
end $$;
revoke all on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
revoke all on function public.get_venue_performance_customer_scores(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_performance_customer_scores(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
commit;
