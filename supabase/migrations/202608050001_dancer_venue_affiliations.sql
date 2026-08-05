begin;

alter type public.notification_type add value if not exists 'venue_affiliation_status';

create table if not exists public.venue_dancer_affiliations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  status text not null default 'active',
  approved_by_user_id uuid not null references public.app_users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  revoked_by_user_id uuid references public.app_users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_dancer_affiliations_unique unique (venue_id, dancer_id),
  constraint venue_dancer_affiliations_status_check check (status in ('active', 'revoked')),
  constraint venue_dancer_affiliations_revoke_pair_check check (
    (status = 'active' and revoked_at is null and revoked_by_user_id is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by_user_id is not null)
  ),
  constraint venue_dancer_affiliations_reason_check check (
    revoke_reason is null or length(trim(revoke_reason)) between 2 and 500
  )
);

create index if not exists venue_dancer_affiliations_dancer_idx
  on public.venue_dancer_affiliations (dancer_id, status, updated_at desc);
create index if not exists venue_dancer_affiliations_venue_idx
  on public.venue_dancer_affiliations (venue_id, status, updated_at desc);

create table if not exists public.venue_dancer_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  created_by_user_id uuid not null references public.app_users(id) on delete cascade,
  token_digest text not null unique,
  request_ip_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_user_id uuid references public.app_users(id) on delete set null,
  revoked_at timestamptz,
  constraint venue_dancer_verification_tokens_digest_check check (token_digest ~ '^[0-9a-f]{64}$'),
  constraint venue_dancer_verification_tokens_ip_check check (request_ip_hash ~ '^[0-9a-f]{64}$'),
  constraint venue_dancer_verification_tokens_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '15 minutes'
  ),
  constraint venue_dancer_verification_tokens_used_pair_check check (
    (used_at is null and used_by_user_id is null) or (used_at is not null and used_by_user_id is not null)
  )
);

create unique index if not exists venue_dancer_verification_tokens_one_active_idx
  on public.venue_dancer_verification_tokens (venue_id, dancer_id)
  where used_at is null and revoked_at is null;
create index if not exists venue_dancer_verification_tokens_rate_user_idx
  on public.venue_dancer_verification_tokens (created_by_user_id, created_at desc);
create index if not exists venue_dancer_verification_tokens_rate_ip_idx
  on public.venue_dancer_verification_tokens (request_ip_hash, created_at desc);

create table if not exists public.venue_dancer_affiliation_events (
  id uuid primary key default gen_random_uuid(),
  affiliation_id uuid references public.venue_dancer_affiliations(id) on delete set null,
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  actor_user_id uuid not null references public.app_users(id) on delete restrict,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint venue_dancer_affiliation_events_type_check check (
    event_type in ('token_issued', 'affiliation_approved', 'affiliation_revoked')
  )
);

create index if not exists venue_dancer_affiliation_events_venue_idx
  on public.venue_dancer_affiliation_events (venue_id, occurred_at desc);
create index if not exists venue_dancer_affiliation_events_dancer_idx
  on public.venue_dancer_affiliation_events (dancer_id, occurred_at desc);

alter table public.venue_dancer_affiliations enable row level security;
alter table public.venue_dancer_verification_tokens enable row level security;
alter table public.venue_dancer_affiliation_events enable row level security;

revoke all on table public.venue_dancer_affiliations from anon, authenticated;
revoke all on table public.venue_dancer_verification_tokens from anon, authenticated;
revoke all on table public.venue_dancer_affiliation_events from anon, authenticated;

create or replace function public.issue_dancer_venue_verification_token(
  p_dancer_id uuid,
  p_user_id uuid,
  p_venue_id uuid,
  p_token_digest text,
  p_request_ip_hash text,
  p_expires_at timestamptz
)
returns public.venue_dancer_verification_tokens
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.venue_dancer_verification_tokens;
  v_now timestamptz := now();
begin
  if p_token_digest !~ '^[0-9a-f]{64}$' or p_request_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid dancer verification token.';
  end if;
  if p_expires_at < v_now + interval '5 minutes' or p_expires_at > v_now + interval '15 minutes' then
    raise exception using errcode = '22023', message = 'Dancer verification links must expire in 5 to 15 minutes.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_dancer_id::text), hashtext(p_venue_id::text));

  if not exists (
    select 1
    from public.dancer_profiles dancer
    join public.app_users account on account.id = dancer.user_id
    where dancer.id = p_dancer_id
      and dancer.user_id = p_user_id
      and dancer.status = 'approved'
      and dancer.is_public = true
      and account.role = 'dancer'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An approved active dancer profile is required.';
  end if;

  if not exists (
    select 1
    from public.venues venue
    join public.app_users owner on owner.id = venue.owner_user_id
    where venue.id = p_venue_id
      and venue.is_active = true
      and owner.role = 'venue'
      and owner.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'This venue does not have a verified manager yet.';
  end if;

  if (
    select count(*)
    from public.venue_dancer_verification_tokens token
    where token.created_by_user_id = p_user_id
      and token.created_at >= v_now - interval '1 hour'
  ) >= 5 then
    raise exception using errcode = '42901', message = 'Too many verification links were created. Try again later.';
  end if;

  if (
    select count(*)
    from public.venue_dancer_verification_tokens token
    where token.request_ip_hash = p_request_ip_hash
      and token.created_at >= v_now - interval '24 hours'
  ) >= 20 then
    raise exception using errcode = '42901', message = 'Too many verification links were created from this connection.';
  end if;

  update public.venue_dancer_verification_tokens
  set revoked_at = v_now
  where venue_id = p_venue_id
    and dancer_id = p_dancer_id
    and used_at is null
    and revoked_at is null;

  insert into public.venue_dancer_verification_tokens (
    venue_id,
    dancer_id,
    created_by_user_id,
    token_digest,
    request_ip_hash,
    expires_at
  ) values (
    p_venue_id,
    p_dancer_id,
    p_user_id,
    p_token_digest,
    p_request_ip_hash,
    p_expires_at
  ) returning * into v_token;

  insert into public.venue_dancer_affiliation_events (
    venue_id,
    dancer_id,
    actor_user_id,
    event_type,
    event_payload
  ) values (
    p_venue_id,
    p_dancer_id,
    p_user_id,
    'token_issued',
    jsonb_build_object('tokenId', v_token.id, 'expiresAt', p_expires_at)
  );

  return v_token;
end;
$$;

create or replace function public.approve_dancer_venue_affiliation(
  p_token_digest text,
  p_manager_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.venue_dancer_verification_tokens;
  v_affiliation public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_now timestamptz := now();
begin
  select * into v_token
  from public.venue_dancer_verification_tokens
  where token_digest = p_token_digest
  for update;

  if not found
    or v_token.expires_at <= v_now
    or v_token.used_at is not null
    or v_token.revoked_at is not null
  then
    raise exception using errcode = '42501', message = 'This dancer verification link is invalid or expired.';
  end if;

  select * into v_venue
  from public.venues
  where id = v_token.venue_id
  for key share;

  if not found
    or v_venue.is_active = false
    or v_venue.owner_user_id is distinct from p_manager_user_id
    or not exists (
      select 1 from public.app_users
      where id = p_manager_user_id and role = 'venue' and account_state = 'active'
    )
  then
    raise exception using errcode = '42501', message = 'Only this venue''s verified manager can approve the dancer.';
  end if;

  select * into v_dancer
  from public.dancer_profiles
  where id = v_token.dancer_id
  for key share;

  if not found
    or v_dancer.status <> 'approved'
    or v_dancer.is_public = false
    or not exists (
      select 1 from public.app_users
      where id = v_dancer.user_id and role = 'dancer' and account_state = 'active'
    )
  then
    raise exception using errcode = '42501', message = 'This dancer profile is not eligible for venue verification.';
  end if;

  insert into public.venue_dancer_affiliations (
    venue_id,
    dancer_id,
    status,
    approved_by_user_id,
    approved_at,
    revoked_by_user_id,
    revoked_at,
    revoke_reason,
    updated_at
  ) values (
    v_token.venue_id,
    v_token.dancer_id,
    'active',
    p_manager_user_id,
    v_now,
    null,
    null,
    null,
    v_now
  )
  on conflict (venue_id, dancer_id) do update
  set
    status = 'active',
    approved_by_user_id = excluded.approved_by_user_id,
    approved_at = excluded.approved_at,
    revoked_by_user_id = null,
    revoked_at = null,
    revoke_reason = null,
    updated_at = excluded.updated_at
  returning * into v_affiliation;

  update public.venue_dancer_verification_tokens
  set used_at = v_now, used_by_user_id = p_manager_user_id
  where id = v_token.id;

  update public.venue_dancer_verification_tokens
  set revoked_at = v_now
  where venue_id = v_token.venue_id
    and dancer_id = v_token.dancer_id
    and id <> v_token.id
    and used_at is null
    and revoked_at is null;

  insert into public.venue_dancer_affiliation_events (
    affiliation_id,
    venue_id,
    dancer_id,
    actor_user_id,
    event_type,
    event_payload
  ) values (
    v_affiliation.id,
    v_affiliation.venue_id,
    v_affiliation.dancer_id,
    p_manager_user_id,
    'affiliation_approved',
    jsonb_build_object('tokenId', v_token.id)
  );

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'approvedAt', v_affiliation.approved_at,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$$;

create or replace function public.revoke_dancer_venue_affiliation(
  p_affiliation_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_affiliation public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
begin
  select * into v_affiliation
  from public.venue_dancer_affiliations
  where id = p_affiliation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue affiliation not found.';
  end if;

  select * into v_dancer from public.dancer_profiles where id = v_affiliation.dancer_id;
  select * into v_venue from public.venues where id = v_affiliation.venue_id;

  if p_actor_user_id is distinct from v_dancer.user_id
    and p_actor_user_id is distinct from v_venue.owner_user_id
  then
    raise exception using errcode = '42501', message = 'Only the dancer or verified venue manager can remove this affiliation.';
  end if;

  if v_affiliation.status = 'active' then
    update public.venue_dancer_affiliations
    set
      status = 'revoked',
      revoked_by_user_id = p_actor_user_id,
      revoked_at = v_now,
      revoke_reason = coalesce(v_reason, 'Affiliation removed by an authorized account.'),
      updated_at = v_now
    where id = v_affiliation.id
    returning * into v_affiliation;

    update public.shifts
    set
      checked_out_at = v_now,
      location_status = 'self_reported',
      location_verification_expires_at = v_now,
      working_status = 'ended',
      commission_tracking_stopped_at = coalesce(commission_tracking_stopped_at, v_now),
      ended_at = coalesce(ended_at, v_now),
      ended_reason = 'venue_affiliation_revoked',
      updated_at = v_now
    where dancer_id = v_affiliation.dancer_id
      and venue_id = v_affiliation.venue_id
      and checked_in_at is not null
      and checked_out_at is null;

    insert into public.venue_dancer_affiliation_events (
      affiliation_id,
      venue_id,
      dancer_id,
      actor_user_id,
      event_type,
      event_payload
    ) values (
      v_affiliation.id,
      v_affiliation.venue_id,
      v_affiliation.dancer_id,
      p_actor_user_id,
      'affiliation_revoked',
      jsonb_build_object('reason', v_affiliation.revoke_reason)
    );
  end if;

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$$;

alter table public.shifts
  add column if not exists venue_affiliation_id uuid references public.venue_dancer_affiliations(id) on delete set null;

create index if not exists shifts_venue_affiliation_idx
  on public.shifts (venue_affiliation_id)
  where venue_affiliation_id is not null;

create or replace function public.enforce_verified_venue_affiliation_for_checkin()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_affiliation_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.checked_in_at is not null
    and new.checked_out_at is null
    and (old.checked_in_at is null or old.checked_out_at is not null)
  then
    select affiliation.id into v_affiliation_id
    from public.venue_dancer_affiliations affiliation
    where affiliation.venue_id = new.venue_id
      and affiliation.dancer_id = new.dancer_id
      and affiliation.status = 'active'
    for key share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'Venue manager approval is required before this dancer can check in.';
    end if;

    new.venue_affiliation_id = v_affiliation_id;
  elsif new.venue_affiliation_id is distinct from old.venue_affiliation_id
    and auth.role() <> 'service_role'
    and session_user not in ('postgres', 'supabase_admin')
  then
    raise exception using
      errcode = '42501',
      message = 'Venue affiliation proof can only be set by the check-in service.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_verified_venue_affiliation_for_checkin on public.shifts;
create trigger enforce_verified_venue_affiliation_for_checkin
before update on public.shifts
for each row execute function public.enforce_verified_venue_affiliation_for_checkin();

-- Existing location-only check-ins are ended once so the new venue authorization
-- rule starts from a trustworthy state. Dancers can check in again immediately
-- after their venue manager approves the affiliation.
update public.shifts
set
  checked_out_at = now(),
  location_status = 'self_reported',
  location_verification_expires_at = now(),
  working_status = 'ended',
  commission_tracking_stopped_at = coalesce(commission_tracking_stopped_at, now()),
  ended_at = coalesce(ended_at, now()),
  ended_reason = 'venue_affiliation_required',
  updated_at = now()
where checked_in_at is not null
  and checked_out_at is null;

grant select (venue_affiliation_id) on public.shifts to anon, authenticated;

revoke all on function public.issue_dancer_venue_verification_token(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.issue_dancer_venue_verification_token(uuid, uuid, uuid, text, text, timestamptz) to service_role;
revoke all on function public.approve_dancer_venue_affiliation(text, uuid) from public;
grant execute on function public.approve_dancer_venue_affiliation(text, uuid) to service_role;
revoke all on function public.revoke_dancer_venue_affiliation(uuid, uuid, text) from public;
grant execute on function public.revoke_dancer_venue_affiliation(uuid, uuid, text) to service_role;
revoke all on function public.enforce_verified_venue_affiliation_for_checkin() from public, anon, authenticated;

comment on table public.venue_dancer_affiliations
is 'Venue-manager-authorized dancer relationships required for Working Now and dancer QR commission eligibility.';
comment on table public.venue_dancer_verification_tokens
is 'Hashed, dancer-specific, venue-bound, short-lived verification links. Raw tokens are never stored.';

notify pgrst, 'reload schema';

commit;
