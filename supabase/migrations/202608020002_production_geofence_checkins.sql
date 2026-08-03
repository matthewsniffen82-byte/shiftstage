begin;

alter table public.shifts
  add column if not exists checkin_accuracy_meters numeric(8,2),
  add column if not exists checkin_captured_at timestamptz,
  add column if not exists last_location_latitude numeric(9,6),
  add column if not exists last_location_longitude numeric(9,6),
  add column if not exists last_location_accuracy_meters numeric(8,2),
  add column if not exists last_location_captured_at timestamptz,
  add column if not exists last_location_verified_at timestamptz,
  add column if not exists location_verification_expires_at timestamptz;

alter table public.shifts
  add constraint shifts_checkin_accuracy_nonnegative
    check (checkin_accuracy_meters is null or checkin_accuracy_meters >= 0),
  add constraint shifts_last_location_latitude_range
    check (last_location_latitude is null or last_location_latitude between -90 and 90),
  add constraint shifts_last_location_longitude_range
    check (last_location_longitude is null or last_location_longitude between -180 and 180),
  add constraint shifts_last_location_accuracy_nonnegative
    check (last_location_accuracy_meters is null or last_location_accuracy_meters >= 0),
  add constraint shifts_location_verification_expiry_order
    check (
      location_verification_expires_at is null
      or last_location_verified_at is null
      or location_verification_expires_at >= last_location_verified_at
    );

create index if not exists shifts_location_verification_expires_idx
  on public.shifts (location_verification_expires_at)
  where checked_in_at is not null and checked_out_at is null;

create table if not exists public.shift_location_events (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  event_type text not null check (event_type in ('check_in', 'refresh')),
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  accuracy_meters numeric(8,2) not null check (accuracy_meters >= 0),
  captured_at timestamptz not null,
  distance_feet numeric(9,2),
  accepted boolean not null,
  reason_code text,
  occurred_at timestamptz not null default now()
);

create index if not exists shift_location_events_dancer_occurred_idx
  on public.shift_location_events (dancer_id, occurred_at desc);
create index if not exists shift_location_events_shift_occurred_idx
  on public.shift_location_events (shift_id, occurred_at desc);

alter table public.shift_location_events enable row level security;

drop policy if exists "dancers read own location events" on public.shift_location_events;
create policy "dancers read own location events"
on public.shift_location_events
for select
using (
  exists (
    select 1
    from public.dancer_profiles dp
    where dp.id = dancer_id
      and dp.user_id = auth.uid()
  )
  or public.is_admin()
);

revoke all on public.shift_location_events from anon, authenticated;
grant select on public.shift_location_events to authenticated;
grant all on public.shift_location_events to service_role;

-- These building coordinates resolve active duplicate venue records to one geofence.
update public.venues
set latitude = 36.129225, longitude = -115.177789, updated_at = now()
where lower(name) = 'spearmint rhino las vegas';

update public.venues
set latitude = 36.153595, longitude = -115.161645, updated_at = now()
where lower(name) = 'little darlings las vegas';

update public.venues
set latitude = 36.130895, longitude = -115.173916, updated_at = now()
where lower(name) = 'deja vu showgirls las vegas';

update public.shifts
set
  last_location_latitude = checkin_latitude,
  last_location_longitude = checkin_longitude,
  last_location_verified_at = checked_in_at,
  location_verification_expires_at = least(ends_at, checked_in_at + interval '30 minutes')
where location_status = 'location_confirmed'
  and checked_in_at is not null
  and checked_out_at is null
  and last_location_verified_at is null;

create or replace function public.process_dancer_location_verification(
  p_user_id uuid,
  p_shift_id uuid,
  p_event_type text,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric,
  p_captured_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_dancer_id uuid;
  v_shift public.shifts%rowtype;
  v_venue_latitude numeric;
  v_venue_longitude numeric;
  v_venue_active boolean;
  v_attempt_count integer;
  v_a double precision;
  v_distance_feet numeric;
  v_expires_at timestamptz;
  v_shift_json jsonb;
begin
  if p_event_type not in ('check_in', 'refresh') then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid_event', 'error', 'Unknown location verification action.');
  end if;

  select dp.id
  into v_dancer_id
  from public.dancer_profiles dp
  where dp.user_id = p_user_id
    and dp.status = 'approved'
  limit 1;

  if v_dancer_id is null then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'profile_not_approved', 'error', 'An approved dancer profile is required to check in.');
  end if;

  select s.*
  into v_shift
  from public.shifts s
  where s.id = p_shift_id
    and s.dancer_id = v_dancer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'shift_not_found', 'error', 'Shift not found.');
  end if;

  select v.latitude, v.longitude, v.is_active
  into v_venue_latitude, v_venue_longitude, v_venue_active
  from public.venues v
  where v.id = v_shift.venue_id;

  if v_shift.status <> 'posted' then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'shift_not_posted', 'error', 'Only posted shifts can be checked in.');
  end if;

  if v_venue_active is distinct from true or v_venue_latitude is null or v_venue_longitude is null then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'venue_location_missing', 'error', 'The venue location is not available for check-in.');
  end if;

  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid_coordinates', 'error', 'A valid location reading is required to check in.');
  end if;

  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 75 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'poor_accuracy', 'error', 'Location accuracy must be within 75 meters. Move near an entrance or window and try again.');
  end if;

  if p_captured_at is null
    or p_captured_at < v_now - interval '30 seconds'
    or p_captured_at > v_now + interval '10 seconds' then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'stale_location', 'error', 'A fresh phone location reading is required. Try again.');
  end if;

  select count(*)::integer
  into v_attempt_count
  from public.shift_location_events e
  where e.dancer_id = v_dancer_id
    and e.occurred_at >= v_now - interval '1 minute';

  if v_attempt_count >= 10 then
    return jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited', 'error', 'Too many location checks. Wait one minute and try again.');
  end if;

  if p_event_type = 'check_in' and v_shift.checked_in_at is not null and v_shift.checked_out_at is null then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'already_checked_in', 'error', 'This shift is already checked in.');
  end if;

  if p_event_type = 'refresh' and (v_shift.checked_in_at is null or v_shift.checked_out_at is not null) then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'not_checked_in', 'error', 'Check in before refreshing your location.');
  end if;

  -- Timestamptz comparison correctly supports shifts that cross midnight.
  if v_now < v_shift.starts_at or v_now > v_shift.ends_at then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'outside_shift_hours', 'error', 'Check-in is only available during your posted shift hours.');
  end if;

  v_a :=
    power(sin(radians((v_venue_latitude::double precision - p_latitude::double precision) / 2)), 2)
    + cos(radians(p_latitude::double precision))
      * cos(radians(v_venue_latitude::double precision))
      * power(sin(radians((v_venue_longitude::double precision - p_longitude::double precision) / 2)), 2);
  v_distance_feet := round((20902231 * 2 * asin(least(1, sqrt(greatest(0, v_a)))))::numeric, 2);

  if v_distance_feet > 300 then
    insert into public.shift_location_events (
      shift_id, dancer_id, user_id, event_type, latitude, longitude,
      accuracy_meters, captured_at, distance_feet, accepted, reason_code
    ) values (
      v_shift.id, v_dancer_id, p_user_id, p_event_type, p_latitude, p_longitude,
      p_accuracy_meters, p_captured_at, v_distance_feet, false, 'outside_geofence'
    );

    if p_event_type = 'refresh' then
      update public.shifts
      set
        location_status = 'self_reported',
        working_status = 'self_reported',
        location_verification_expires_at = v_now,
        commission_tracking_stopped_at = v_now,
        updated_at = v_now
      where id = v_shift.id;
    end if;

    return jsonb_build_object(
      'ok', false,
      'status', 403,
      'code', 'outside_geofence',
      'error', 'Outside the club check-in radius. Move closer to the club and try again.',
      'distanceFeet', round(v_distance_feet),
      'requiredRadiusFeet', 300
    );
  end if;

  v_expires_at := least(v_shift.ends_at, v_now + interval '30 minutes');

  update public.shifts
  set
    checked_in_at = case when p_event_type = 'check_in' then v_now else checked_in_at end,
    checked_out_at = null,
    checkin_latitude = case when p_event_type = 'check_in' then p_latitude else checkin_latitude end,
    checkin_longitude = case when p_event_type = 'check_in' then p_longitude else checkin_longitude end,
    checkin_distance_feet = case when p_event_type = 'check_in' then v_distance_feet else checkin_distance_feet end,
    checkin_accuracy_meters = case when p_event_type = 'check_in' then p_accuracy_meters else checkin_accuracy_meters end,
    checkin_captured_at = case when p_event_type = 'check_in' then p_captured_at else checkin_captured_at end,
    last_location_latitude = p_latitude,
    last_location_longitude = p_longitude,
    last_location_accuracy_meters = p_accuracy_meters,
    last_location_captured_at = p_captured_at,
    last_location_verified_at = v_now,
    location_verification_expires_at = v_expires_at,
    location_status = 'location_confirmed',
    working_status = 'checked_in',
    commission_tracking_started_at = coalesce(commission_tracking_started_at, v_now),
    commission_tracking_stopped_at = null,
    ended_at = null,
    ended_reason = null,
    updated_at = v_now
  where id = v_shift.id
  returning jsonb_build_object(
    'id', id,
    'checked_in_at', checked_in_at,
    'checked_out_at', checked_out_at,
    'checkin_distance_feet', checkin_distance_feet,
    'checkin_accuracy_meters', checkin_accuracy_meters,
    'last_location_verified_at', last_location_verified_at,
    'location_verification_expires_at', location_verification_expires_at,
    'location_status', location_status,
    'working_status', working_status,
    'commission_tracking_started_at', commission_tracking_started_at,
    'commission_tracking_stopped_at', commission_tracking_stopped_at,
    'ended_at', ended_at,
    'ended_reason', ended_reason,
    'shift_summary', shift_summary
  ) into v_shift_json;

  insert into public.shift_location_events (
    shift_id, dancer_id, user_id, event_type, latitude, longitude,
    accuracy_meters, captured_at, distance_feet, accepted, reason_code
  ) values (
    v_shift.id, v_dancer_id, p_user_id, p_event_type, p_latitude, p_longitude,
    p_accuracy_meters, p_captured_at, v_distance_feet, true, null
  );

  return jsonb_build_object('ok', true, 'status', 200, 'shift', v_shift_json);
end;
$$;

revoke all on function public.process_dancer_location_verification(uuid, uuid, text, numeric, numeric, numeric, timestamptz)
from public, anon, authenticated;
grant execute on function public.process_dancer_location_verification(uuid, uuid, text, numeric, numeric, numeric, timestamptz)
to service_role;

comment on function public.process_dancer_location_verification(uuid, uuid, text, numeric, numeric, numeric, timestamptz)
is 'Atomically validates a fresh, accurate dancer location and records an auditable geofence result.';

notify pgrst, 'reload schema';

commit;
