begin;

create table if not exists public.venue_signup_requests (
  id uuid primary key default gen_random_uuid(),
  venue_name text not null check (char_length(trim(venue_name)) between 2 and 160),
  street_address text not null check (char_length(trim(street_address)) between 5 and 240),
  city text not null check (char_length(trim(city)) between 2 and 120),
  state text not null check (char_length(trim(state)) between 2 and 40),
  postal_code text not null check (char_length(trim(postal_code)) between 3 and 16),
  website text check (website is null or char_length(website) <= 320),
  contact_name text not null check (char_length(trim(contact_name)) between 2 and 160),
  contact_title text not null check (char_length(trim(contact_title)) between 2 and 120),
  contact_email text not null check (char_length(trim(contact_email)) between 5 and 320),
  contact_phone text not null check (char_length(trim(contact_phone)) between 7 and 40),
  message text check (message is null or char_length(message) <= 1500),
  request_ip_hash text not null check (char_length(request_ip_hash) = 64),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  matched_venue_id uuid references public.venues(id) on delete set null,
  access_code_id uuid references public.venue_claim_codes(id) on delete set null,
  reviewed_by uuid references public.app_users(id) on delete set null,
  review_notes text check (review_notes is null or char_length(review_notes) <= 2000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint venue_signup_requests_review_pair_check check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null and reviewed_by is not null)
  ),
  constraint venue_signup_requests_approval_pair_check check (
    status <> 'approved' or (matched_venue_id is not null and access_code_id is not null)
  )
);

create index if not exists venue_signup_requests_admin_queue_idx
  on public.venue_signup_requests (status, submitted_at asc);

create index if not exists venue_signup_requests_ip_rate_idx
  on public.venue_signup_requests (request_ip_hash, submitted_at desc);

create unique index if not exists venue_signup_requests_pending_duplicate_idx
  on public.venue_signup_requests (
    lower(venue_name),
    lower(street_address),
    lower(contact_email)
  )
  where status = 'pending';

alter table public.venue_signup_requests enable row level security;

drop policy if exists "Admins manage venue signup requests" on public.venue_signup_requests;
create policy "Admins manage venue signup requests"
  on public.venue_signup_requests
  for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.touch_venue_signup_request_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists venue_signup_requests_touch_updated_at on public.venue_signup_requests;
create trigger venue_signup_requests_touch_updated_at
  before update on public.venue_signup_requests
  for each row execute function public.touch_venue_signup_request_updated_at();

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

  if p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'A secure venue access code is required.';
  end if;
  if p_code_expires_at is null
    or p_code_expires_at <= v_now + interval '5 minutes'
    or p_code_expires_at > v_now + interval '30 days'
  then
    raise exception using errcode = '22023', message = 'Venue access code expiry is invalid.';
  end if;

  if p_existing_venue_id is not null then
    select * into v_venue
    from public.venues
    where id = p_existing_venue_id
    for update;

    if not found or v_venue.is_active = false then
      raise exception using errcode = 'P0002', message = 'The selected venue is not active.';
    end if;
    if v_venue.owner_user_id is not null then
      raise exception using errcode = '23505', message = 'The selected venue already has a connected manager.';
    end if;
  else
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
      is_active
    ) values (
      v_request.venue_name,
      v_slug,
      v_request.city,
      v_request.state,
      concat_ws(', ', v_request.street_address, v_request.city, concat_ws(' ', v_request.state, v_request.postal_code)),
      v_request.contact_phone,
      v_request.website,
      'America/Los_Angeles',
      true
    )
    returning * into v_venue;
  end if;

  update public.venue_claim_codes
  set revoked_at = v_now, revoked_by = p_admin_id
  where venue_id = v_venue.id
    and used_at is null
    and revoked_at is null;

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
    'Connected venue ' || v_venue.id::text || '; access code expires ' || p_code_expires_at::text
  );

  return jsonb_build_object(
    'request', to_jsonb(v_request),
    'venue', to_jsonb(v_venue),
    'claim_code', to_jsonb(v_code)
  );
end;
$$;

revoke all on table public.venue_signup_requests from anon, authenticated;
grant all on table public.venue_signup_requests to service_role;
revoke all on function public.review_venue_signup_request(uuid, uuid, text, uuid, text, text, timestamptz) from public;
grant execute on function public.review_venue_signup_request(uuid, uuid, text, uuid, text, text, timestamptz) to service_role;
revoke all on function public.touch_venue_signup_request_updated_at() from public;

comment on table public.venue_signup_requests is
  'Public venue access requests awaiting administrator verification before a private manager signup code is issued.';

commit;
