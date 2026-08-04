-- Invitation-only claim codes for existing venue cards.

create table if not exists public.venue_claim_codes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  code_digest text not null unique,
  created_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.app_users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.app_users(id) on delete set null,
  constraint venue_claim_codes_digest_check check (length(code_digest) = 64),
  constraint venue_claim_codes_expiry_check check (expires_at > created_at),
  constraint venue_claim_codes_used_pair_check check (
    (used_at is null and used_by is null) or (used_at is not null and used_by is not null)
  ),
  constraint venue_claim_codes_revoked_pair_check check (
    (revoked_at is null and revoked_by is null) or (revoked_at is not null and revoked_by is not null)
  )
);

create unique index if not exists venue_claim_codes_one_unconsumed_idx
  on public.venue_claim_codes (venue_id)
  where used_at is null and revoked_at is null;

create index if not exists venue_claim_codes_admin_queue_idx
  on public.venue_claim_codes (venue_id, created_at desc);

alter table public.venue_claim_codes enable row level security;

drop policy if exists "admins manage venue claim codes" on public.venue_claim_codes;
create policy "admins manage venue claim codes"
  on public.venue_claim_codes
  for all
  using (public.is_admin())
  with check (public.is_admin());

alter table public.venue_ownership_claims
  add column if not exists claim_code_id uuid references public.venue_claim_codes(id) on delete restrict;

create unique index if not exists venue_ownership_claims_claim_code_idx
  on public.venue_ownership_claims (claim_code_id)
  where claim_code_id is not null;

create or replace function public.enforce_available_venue_ownership_claim()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_user_id uuid;
  v_claim_code public.venue_claim_codes;
begin
  select owner_user_id into v_owner_user_id
  from public.venues
  where id = new.venue_id
  for key share;

  if not found then
    raise exception using errcode = '23503', message = 'Venue not found.';
  end if;
  if v_owner_user_id is not null then
    raise exception using errcode = '23505', message = 'This venue is already managed by a verified account.';
  end if;
  if not exists (
    select 1 from public.app_users
    where id = new.claimant_user_id and role = 'venue' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active venue account is required.';
  end if;
  if exists (
    select 1 from public.venues
    where owner_user_id = new.claimant_user_id and id <> new.venue_id
  ) then
    raise exception using errcode = '23505', message = 'This account already manages another venue.';
  end if;

  if new.claim_code_id is null then
    raise exception using errcode = '42501', message = 'A valid venue claim code is required.';
  end if;

  select * into v_claim_code
  from public.venue_claim_codes
  where id = new.claim_code_id
  for update;

  if not found
    or v_claim_code.venue_id <> new.venue_id
    or v_claim_code.expires_at <= now()
    or v_claim_code.used_at is not null
    or v_claim_code.revoked_at is not null
  then
    raise exception using errcode = '42501', message = 'This venue claim code is invalid or no longer active.';
  end if;

  update public.venue_claim_codes
  set used_at = now(), used_by = new.claimant_user_id
  where id = v_claim_code.id;

  return new;
end;
$$;

create or replace function public.issue_venue_claim_code(
  p_venue_id uuid,
  p_admin_id uuid,
  p_code_digest text,
  p_expires_at timestamptz
)
returns public.venue_claim_codes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_venue public.venues;
  v_code public.venue_claim_codes;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.app_users
    where id = p_admin_id and role = 'admin' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active admin account required.';
  end if;
  if p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid venue claim code digest.';
  end if;
  if p_expires_at <= v_now + interval '5 minutes'
    or p_expires_at > v_now + interval '30 days'
  then
    raise exception using errcode = '22023', message = 'Venue claim codes must expire between 5 minutes and 30 days from now.';
  end if;

  select * into v_venue
  from public.venues
  where id = p_venue_id
  for update;

  if not found or v_venue.is_active = false then
    raise exception using errcode = 'P0002', message = 'Active venue not found.';
  end if;
  if v_venue.owner_user_id is not null then
    raise exception using errcode = '23505', message = 'This venue already has a verified manager.';
  end if;

  update public.venue_claim_codes
  set revoked_at = v_now, revoked_by = p_admin_id
  where venue_id = p_venue_id
    and used_at is null
    and revoked_at is null;

  insert into public.venue_claim_codes (
    venue_id,
    code_digest,
    created_by,
    expires_at
  )
  values (
    p_venue_id,
    p_code_digest,
    p_admin_id,
    p_expires_at
  )
  returning * into v_code;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue',
    p_venue_id,
    'issue_venue_claim_code',
    'Claim code expires ' || p_expires_at::text
  );

  return v_code;
end;
$$;

create or replace function public.revoke_venue_claim_code(
  p_code_id uuid,
  p_admin_id uuid
)
returns public.venue_claim_codes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.venue_claim_codes;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.app_users
    where id = p_admin_id and role = 'admin' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active admin account required.';
  end if;

  select * into v_code
  from public.venue_claim_codes
  where id = p_code_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue claim code not found.';
  end if;
  if v_code.used_at is not null then
    raise exception using errcode = '22023', message = 'A used venue claim code cannot be revoked.';
  end if;

  if v_code.revoked_at is null then
    update public.venue_claim_codes
    set revoked_at = v_now, revoked_by = p_admin_id
    where id = v_code.id
    returning * into v_code;

    insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
    values (p_admin_id, 'venue', v_code.venue_id, 'revoke_venue_claim_code', null);
  end if;

  return v_code;
end;
$$;

revoke all on table public.venue_claim_codes from anon, authenticated;
revoke all on function public.issue_venue_claim_code(uuid, uuid, text, timestamptz) from public;
grant execute on function public.issue_venue_claim_code(uuid, uuid, text, timestamptz) to service_role;
revoke all on function public.revoke_venue_claim_code(uuid, uuid) from public;
grant execute on function public.revoke_venue_claim_code(uuid, uuid) to service_role;
revoke all on function public.enforce_available_venue_ownership_claim() from public;
