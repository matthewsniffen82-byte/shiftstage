begin;

create or replace function public.enforce_shift_verification_server_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Service-role requests are the only application path allowed to mutate proof.
  -- Direct database maintenance remains available to the database owner.
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.location_status <> 'self_reported'
      or new.checked_in_at is not null
      or new.checked_out_at is not null
      or new.checkin_latitude is not null
      or new.checkin_longitude is not null
      or new.checkin_distance_feet is not null
      or new.checkin_accuracy_meters is not null
      or new.checkin_captured_at is not null
      or new.last_location_latitude is not null
      or new.last_location_longitude is not null
      or new.last_location_accuracy_meters is not null
      or new.last_location_captured_at is not null
      or new.last_location_verified_at is not null
      or new.location_verification_expires_at is not null
      or new.working_status <> 'self_reported'
      or new.commission_tracking_started_at is not null
      or new.commission_tracking_stopped_at is not null
      or new.ended_at is not null
      or new.ended_reason is not null
      or new.checkout_latitude is not null
      or new.checkout_longitude is not null
      or new.shift_summary <> '{}'::jsonb then
      raise exception using
        errcode = '42501',
        message = 'Shift verification state can only be set by the check-in service.';
    end if;
    return new;
  end if;

  if new.location_status is distinct from old.location_status
    or new.checked_in_at is distinct from old.checked_in_at
    or new.checked_out_at is distinct from old.checked_out_at
    or new.checkin_latitude is distinct from old.checkin_latitude
    or new.checkin_longitude is distinct from old.checkin_longitude
    or new.checkin_distance_feet is distinct from old.checkin_distance_feet
    or new.checkin_accuracy_meters is distinct from old.checkin_accuracy_meters
    or new.checkin_captured_at is distinct from old.checkin_captured_at
    or new.last_location_latitude is distinct from old.last_location_latitude
    or new.last_location_longitude is distinct from old.last_location_longitude
    or new.last_location_accuracy_meters is distinct from old.last_location_accuracy_meters
    or new.last_location_captured_at is distinct from old.last_location_captured_at
    or new.last_location_verified_at is distinct from old.last_location_verified_at
    or new.location_verification_expires_at is distinct from old.location_verification_expires_at
    or new.working_status is distinct from old.working_status
    or new.commission_tracking_started_at is distinct from old.commission_tracking_started_at
    or new.commission_tracking_stopped_at is distinct from old.commission_tracking_stopped_at
    or new.ended_at is distinct from old.ended_at
    or new.ended_reason is distinct from old.ended_reason
    or new.checkout_latitude is distinct from old.checkout_latitude
    or new.checkout_longitude is distinct from old.checkout_longitude
    or new.shift_summary is distinct from old.shift_summary then
    raise exception using
      errcode = '42501',
      message = 'Shift verification state can only be changed by the check-in service.';
  end if;

  if old.checked_in_at is not null
    and old.checked_out_at is null
    and (
      new.venue_id is distinct from old.venue_id
      or new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at
      or new.timezone is distinct from old.timezone
      or new.status is distinct from old.status
    ) then
    raise exception using
      errcode = '42501',
      message = 'An active checked-in shift cannot be edited or cancelled.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_shift_verification_server_only on public.shifts;
create trigger enforce_shift_verification_server_only
before insert or update on public.shifts
for each row execute function public.enforce_shift_verification_server_only();

revoke all on function public.enforce_shift_verification_server_only() from public, anon, authenticated;

-- Public schedules need status and timing, never a dancer's raw device coordinates.
revoke select on public.shifts from anon, authenticated;
grant select (
  id,
  dancer_id,
  venue_id,
  starts_at,
  ends_at,
  timezone,
  status,
  created_at,
  updated_at,
  location_status,
  checked_in_at,
  checked_out_at,
  checkin_distance_feet,
  working_status,
  last_location_verified_at,
  location_verification_expires_at
) on public.shifts to anon, authenticated;

comment on function public.enforce_shift_verification_server_only()
is 'Rejects client-side shift check-in, checkout, location, commission, and summary mutations.';

notify pgrst, 'reload schema';

commit;
