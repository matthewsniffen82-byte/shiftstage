begin;

-- A venue workspace is private until its manager completes setup and publishes it.
alter table public.venues
  add column if not exists published_at timestamptz,
  add column if not exists logo_storage_path text,
  add column if not exists logo_updated_at timestamptz;

update public.venues
set published_at = coalesce(published_at, updated_at, created_at, now())
where is_active = true
  and published_at is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'venue-logo-images',
  'venue-logo-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads venue logo images" on storage.objects;
create policy "public reads venue logo images"
  on storage.objects
  for select
  using (bucket_id = 'venue-logo-images');

drop policy if exists "venue owners manage own logo images" on storage.objects;
create policy "venue owners manage own logo images"
  on storage.objects
  for all
  using (
    bucket_id = 'venue-logo-images'
    and exists (
      select 1
      from public.venues venue
      where venue.owner_user_id = auth.uid()
        and (storage.foldername(name))[1] = venue.id::text
    )
  )
  with check (
    bucket_id = 'venue-logo-images'
    and exists (
      select 1
      from public.venues venue
      where venue.owner_user_id = auth.uid()
        and (storage.foldername(name))[1] = venue.id::text
    )
  );

-- Approval always creates a new private workspace. Existing public venues are
-- never claimable through this flow.
create or replace function public.review_venue_signup_request(
  p_request_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_existing_venue_id uuid default null,
  p_review_notes text default null,
  p_code_digest text default null,
  p_code_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.venue_signup_requests;
  v_venue public.venues;
  v_code public.venue_claim_codes;
  v_slug_base text;
  v_slug text;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.app_users
    where id = p_admin_id and role = 'admin' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active admin account required.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Decision must be approved or rejected.';
  end if;

  select * into v_request
  from public.venue_signup_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue signup request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception using errcode = '22023', message = 'This venue signup request was already reviewed.';
  end if;

  if p_decision = 'rejected' then
    if nullif(trim(coalesce(p_review_notes, '')), '') is null then
      raise exception using errcode = '22023', message = 'Add a reason before rejecting this venue request.';
    end if;

    update public.venue_signup_requests
    set status = 'rejected',
        reviewed_by = p_admin_id,
        reviewed_at = v_now,
        review_notes = left(trim(p_review_notes), 2000)
    where id = v_request.id
    returning * into v_request;

    insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
    values (p_admin_id, 'venue_signup_request', v_request.id, 'reject_venue_signup_request', v_request.review_notes);

    return jsonb_build_object('request', to_jsonb(v_request), 'venue', null, 'claim_code', null);
  end if;

  if p_existing_venue_id is not null then
    raise exception using errcode = '22023', message = 'Existing venue claims are not supported. Approve this request as a new private workspace.';
  end if;
  if p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'A secure venue access code is required.';
  end if;
  if p_code_expires_at is null
    or p_code_expires_at <= v_now + interval '5 minutes'
    or p_code_expires_at > v_now + interval '30 days'
  then
    raise exception using errcode = '22023', message = 'Venue access code expiry is invalid.';
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(v_request.venue_name), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then
    v_slug_base := 'venue';
  end if;
  v_slug := v_slug_base;
  if exists (select 1 from public.venues where slug = v_slug) then
    v_slug := left(v_slug_base, 78) || '-' || left(replace(v_request.id::text, '-', ''), 8);
  end if;

  insert into public.venues (
    name,
    slug,
    city,
    state,
    address,
    phone,
    website,
    timezone,
    is_active,
    published_at
  ) values (
    v_request.venue_name,
    v_slug,
    v_request.city,
    v_request.state,
    concat_ws(', ', v_request.street_address, v_request.city, concat_ws(' ', v_request.state, v_request.postal_code)),
    v_request.contact_phone,
    v_request.website,
    'America/Los_Angeles',
    false,
    null
  )
  returning * into v_venue;

  insert into public.venue_claim_codes (
    venue_id,
    code_digest,
    created_by,
    expires_at
  ) values (
    v_venue.id,
    p_code_digest,
    p_admin_id,
    p_code_expires_at
  )
  returning * into v_code;

  update public.venue_signup_requests
  set status = 'approved',
      matched_venue_id = v_venue.id,
      access_code_id = v_code.id,
      reviewed_by = p_admin_id,
      reviewed_at = v_now,
      review_notes = nullif(left(trim(coalesce(p_review_notes, '')), 2000), '')
  where id = v_request.id
  returning * into v_request;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_signup_request',
    v_request.id,
    'approve_venue_signup_request',
    'Created private venue workspace ' || v_venue.id::text || '; access code expires ' || p_code_expires_at::text
  );

  return jsonb_build_object(
    'request', to_jsonb(v_request),
    'venue', to_jsonb(v_venue),
    'claim_code', to_jsonb(v_code)
  );
end;
$$;

-- The one-time code must come from an approved request. Redeeming it grants
-- dashboard ownership but does not publish the venue.
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

  select * into v_venue
  from public.venues
  where id = v_venue_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'This venue access code is invalid or no longer active.';
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
    or not exists (
      select 1
      from public.venue_signup_requests request
      where request.status = 'approved'
        and request.matched_venue_id = v_venue_id
        and request.access_code_id = p_code_id
    )
  then
    raise exception using errcode = '42501', message = 'This venue access code is invalid or no longer active.';
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

revoke all on function public.review_venue_signup_request(uuid, uuid, text, uuid, text, text, timestamptz) from public;
grant execute on function public.review_venue_signup_request(uuid, uuid, text, uuid, text, text, timestamptz) to service_role;
revoke all on function public.redeem_venue_signup_code(uuid, uuid) from public;
grant execute on function public.redeem_venue_signup_code(uuid, uuid) to service_role;

comment on column public.venues.is_active is
  'True only after an approved venue manager completes setup and explicitly publishes the public venue page.';
comment on column public.venues.published_at is
  'Timestamp of the latest successful venue self-publication; null while the workspace is private.';

commit;
