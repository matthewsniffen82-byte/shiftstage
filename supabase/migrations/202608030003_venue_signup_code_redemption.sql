-- Redeem an administrator-issued venue access code directly during venue signup.

create or replace function public.redeem_venue_signup_code(
  p_code_id uuid,
  p_user_id uuid
)
returns public.venues
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venue_id uuid;
  v_venue public.venues;
  v_code public.venue_claim_codes;
begin
  select venue_id into v_venue_id
  from public.venue_claim_codes
  where id = p_code_id;

  if not found then
    raise exception using errcode = '42501', message = 'This venue access code is invalid or no longer active.';
  end if;

  -- Keep the same venue-then-code lock order used when administrators issue codes.
  select * into v_venue
  from public.venues
  where id = v_venue_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'This venue is not available for account access.';
  end if;

  select * into v_code
  from public.venue_claim_codes
  where id = p_code_id
  for update;

  if not found
    or v_code.venue_id <> v_venue_id
    or v_code.expires_at <= now()
    or v_code.used_at is not null
    or v_code.revoked_at is not null
  then
    raise exception using errcode = '42501', message = 'This venue access code is invalid or no longer active.';
  end if;

  if v_venue.is_active = false then
    raise exception using errcode = '42501', message = 'This venue is not available for account access.';
  end if;
  if v_venue.owner_user_id is not null then
    raise exception using errcode = '23505', message = 'This venue already has a manager account.';
  end if;
  if not exists (
    select 1 from public.app_users
    where id = p_user_id and role = 'venue' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active venue account is required.';
  end if;
  if exists (
    select 1 from public.venues
    where owner_user_id = p_user_id and id <> v_venue.id
  ) then
    raise exception using errcode = '23505', message = 'This account already manages another venue.';
  end if;

  update public.venues
  set owner_user_id = p_user_id, updated_at = now()
  where id = v_venue.id
  returning * into v_venue;

  update public.venue_claim_codes
  set used_at = now(), used_by = p_user_id
  where id = v_code.id;

  return v_venue;
end;
$$;

revoke all on function public.redeem_venue_signup_code(uuid, uuid) from public;
grant execute on function public.redeem_venue_signup_code(uuid, uuid) to service_role;
