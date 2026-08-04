-- Secure ownership claims for venue cards that already exist in public discovery.

alter type public.notification_type add value if not exists 'venue_claim_status';

create table if not exists public.venue_ownership_claims (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  claimant_user_id uuid not null references public.app_users(id) on delete cascade,
  claimant_email text not null,
  claimant_name text not null,
  claimant_title text not null,
  claimant_phone text not null,
  proof_storage_path text,
  proof_file_name text not null,
  proof_mime_type text not null,
  request_ip_hash text not null,
  status text not null default 'pending',
  review_notes text,
  reviewed_by uuid references public.app_users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  proof_cleared_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint venue_ownership_claims_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint venue_ownership_claims_email_check
    check (length(trim(claimant_email)) between 5 and 320),
  constraint venue_ownership_claims_name_check
    check (length(trim(claimant_name)) between 2 and 160),
  constraint venue_ownership_claims_title_check
    check (length(trim(claimant_title)) between 2 and 120),
  constraint venue_ownership_claims_phone_check
    check (length(trim(claimant_phone)) between 7 and 50),
  constraint venue_ownership_claims_proof_mime_check
    check (proof_mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'))
);

create unique index if not exists venue_ownership_claims_pending_user_venue_idx
  on public.venue_ownership_claims (claimant_user_id, venue_id)
  where status = 'pending';

create index if not exists venue_ownership_claims_pending_queue_idx
  on public.venue_ownership_claims (submitted_at asc)
  where status = 'pending';

create index if not exists venue_ownership_claims_ip_rate_idx
  on public.venue_ownership_claims (request_ip_hash, submitted_at desc);

alter table public.venue_ownership_claims enable row level security;

create or replace function public.enforce_available_venue_ownership_claim()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_user_id uuid;
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
    raise exception using errcode = '42501', message = 'Active venue account required.';
  end if;
  if exists (
    select 1 from public.venues
    where owner_user_id = new.claimant_user_id and id <> new.venue_id
  ) then
    raise exception using errcode = '23505', message = 'This account already manages another venue.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_available_venue_ownership_claim on public.venue_ownership_claims;
create trigger enforce_available_venue_ownership_claim
before insert on public.venue_ownership_claims
for each row execute function public.enforce_available_venue_ownership_claim();

drop policy if exists "claimants read own venue claims" on public.venue_ownership_claims;
create policy "claimants read own venue claims"
  on public.venue_ownership_claims
  for select
  using (claimant_user_id = auth.uid());

drop policy if exists "admins manage venue claims" on public.venue_ownership_claims;
create policy "admins manage venue claims"
  on public.venue_ownership_claims
  for all
  using (public.is_admin())
  with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'venue-ownership-proofs',
  'venue-ownership-proofs',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "claimants read own venue proof" on storage.objects;
create policy "claimants read own venue proof"
  on storage.objects
  for select
  using (
    bucket_id = 'venue-ownership-proofs'
    and exists (
      select 1
      from public.venue_ownership_claims claim
      where claim.claimant_user_id = auth.uid()
        and claim.proof_storage_path = name
    )
  );

drop policy if exists "admins read venue ownership proofs" on storage.objects;
create policy "admins read venue ownership proofs"
  on storage.objects
  for select
  using (bucket_id = 'venue-ownership-proofs' and public.is_admin());

create or replace function public.review_venue_ownership_claim(
  p_claim_id uuid,
  p_admin_id uuid,
  p_status text,
  p_notes text default null
)
returns public.venue_ownership_claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim public.venue_ownership_claims;
  v_venue public.venues;
  v_now timestamptz := now();
begin
  if p_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Venue claim status must be approved or rejected.';
  end if;

  if not exists (
    select 1 from public.app_users
    where id = p_admin_id and role = 'admin' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active admin account required.';
  end if;

  select * into v_claim
  from public.venue_ownership_claims
  where id = p_claim_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue ownership claim not found.';
  end if;
  if v_claim.status <> 'pending' then
    raise exception using errcode = '22023', message = 'This venue ownership claim was already reviewed.';
  end if;
  if p_status = 'rejected' and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception using errcode = '22023', message = 'Add a reason before rejecting this venue claim.';
  end if;

  select * into v_venue
  from public.venues
  where id = v_claim.venue_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue not found.';
  end if;

  if p_status = 'approved' then
    if v_venue.owner_user_id is not null and v_venue.owner_user_id <> v_claim.claimant_user_id then
      raise exception using errcode = '23505', message = 'This venue is already managed by another account.';
    end if;
    if exists (
      select 1 from public.venues
      where owner_user_id = v_claim.claimant_user_id and id <> v_claim.venue_id
    ) then
      raise exception using errcode = '23505', message = 'This account already manages another venue.';
    end if;

    update public.venues
    set owner_user_id = v_claim.claimant_user_id, updated_at = v_now
    where id = v_claim.venue_id;

    update public.venue_ownership_claims
    set
      status = 'rejected',
      review_notes = 'Another verified ownership claim was approved for this venue.',
      reviewed_by = p_admin_id,
      reviewed_at = v_now,
      updated_at = v_now
    where venue_id = v_claim.venue_id
      and status = 'pending'
      and id <> v_claim.id;
  end if;

  update public.venue_ownership_claims
  set
    status = p_status,
    review_notes = nullif(trim(coalesce(p_notes, '')), ''),
    reviewed_by = p_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  where id = v_claim.id
  returning * into v_claim;

  insert into public.notifications (
    recipient_id,
    notification_type,
    channel,
    title,
    body,
    payload,
    sent_at
  )
  values (
    v_claim.claimant_user_id,
    'venue_claim_status',
    'in_app',
    case when p_status = 'approved' then 'Venue claim approved' else 'Venue claim needs attention' end,
    case
      when p_status = 'approved' then 'Your account can now manage ' || v_venue.name || ' from the venue dashboard.'
      else 'Your claim for ' || v_venue.name || ' was not approved. Review the decision and submit a new claim if needed.'
    end,
    jsonb_build_object(
      'claimId', v_claim.id,
      'venueId', v_venue.id,
      'venueSlug', v_venue.slug,
      'status', p_status,
      'notes', nullif(trim(coalesce(p_notes, '')), '')
    ),
    v_now
  );

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_ownership_claim',
    v_claim.id,
    case when p_status = 'approved' then 'approve_venue_claim' else 'reject_venue_claim' end,
    nullif(trim(coalesce(p_notes, '')), '')
  );

  return v_claim;
end;
$$;

revoke all on function public.review_venue_ownership_claim(uuid, uuid, text, text) from public;
grant execute on function public.review_venue_ownership_claim(uuid, uuid, text, text) to service_role;
revoke all on function public.enforce_available_venue_ownership_claim() from public;
