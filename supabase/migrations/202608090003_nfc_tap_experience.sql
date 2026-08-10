begin;

create table if not exists public.nfc_tags (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  tag_type text not null check (tag_type in ('dressing_room', 'cashier')),
  label text not null check (char_length(trim(label)) between 2 and 80),
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'disabled', 'revoked')),
  created_by_user_id uuid not null references public.app_users(id) on delete restrict,
  rotated_from_tag_id uuid references public.nfc_tags(id) on delete set null,
  last_tapped_at timestamptz,
  tap_count bigint not null default 0 check (tap_count >= 0),
  disabled_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists nfc_tags_one_active_dressing_room_label_idx
  on public.nfc_tags (venue_id, lower(label))
  where tag_type = 'dressing_room' and status = 'active';

create unique index if not exists nfc_tags_one_active_cashier_label_idx
  on public.nfc_tags (venue_id, lower(label))
  where tag_type = 'cashier' and status = 'active';

create index if not exists nfc_tags_venue_status_idx
  on public.nfc_tags (venue_id, status, tag_type, created_at desc);

create table if not exists public.nfc_tap_events (
  id uuid primary key default gen_random_uuid(),
  nfc_tag_id uuid not null references public.nfc_tags(id) on delete restrict,
  venue_id uuid not null references public.venues(id) on delete cascade,
  tag_type text not null check (tag_type in ('dressing_room', 'cashier')),
  event_type text not null check (
    event_type in (
      'opened',
      'affiliation_approved',
      'shift_checked_in',
      'deal_redeemed',
      'rejected'
    )
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  session_id uuid,
  ip_address text,
  user_agent text,
  device_fingerprint text,
  audit jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists nfc_tap_events_tag_time_idx
  on public.nfc_tap_events (nfc_tag_id, occurred_at desc);

create index if not exists nfc_tap_events_venue_type_time_idx
  on public.nfc_tap_events (venue_id, event_type, occurred_at desc);

create table if not exists public.dancer_nfc_enrollments (
  id uuid primary key default gen_random_uuid(),
  dancer_user_id uuid not null references public.app_users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  nfc_tag_id uuid not null references public.nfc_tags(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'completed', 'expired', 'revoked')),
  tapped_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  completed_at timestamptz,
  last_attempted_at timestamptz,
  audit jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dancer_user_id, venue_id)
);

create index if not exists dancer_nfc_enrollments_pending_idx
  on public.dancer_nfc_enrollments (dancer_user_id, expires_at desc)
  where status = 'pending';

alter table public.qr_redemptions
  add column if not exists nfc_tag_id uuid references public.nfc_tags(id) on delete set null;

create index if not exists qr_redemptions_nfc_tag_idx
  on public.qr_redemptions (nfc_tag_id, generated_at desc)
  where nfc_tag_id is not null;

alter table public.nfc_tags enable row level security;
alter table public.nfc_tap_events enable row level security;
alter table public.dancer_nfc_enrollments enable row level security;

drop policy if exists "Admins manage NFC tags" on public.nfc_tags;
create policy "Admins manage NFC tags" on public.nfc_tags for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Venue owners read own NFC tags" on public.nfc_tags;
create policy "Venue owners read own NFC tags" on public.nfc_tags for select
  using (exists (
    select 1 from public.venues venue
    where venue.id = venue_id and venue.owner_user_id = auth.uid()
  ));

drop policy if exists "Admins manage NFC tap events" on public.nfc_tap_events;
create policy "Admins manage NFC tap events" on public.nfc_tap_events for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Venue owners read own NFC tap events" on public.nfc_tap_events;
create policy "Venue owners read own NFC tap events" on public.nfc_tap_events for select
  using (exists (
    select 1 from public.venues venue
    where venue.id = venue_id and venue.owner_user_id = auth.uid()
  ));

drop policy if exists "Dancers read own NFC tap events" on public.nfc_tap_events;
create policy "Dancers read own NFC tap events" on public.nfc_tap_events for select
  using (actor_user_id = auth.uid());

drop policy if exists "Admins manage dancer NFC enrollments" on public.dancer_nfc_enrollments;
create policy "Admins manage dancer NFC enrollments" on public.dancer_nfc_enrollments for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Dancers read own NFC enrollments" on public.dancer_nfc_enrollments;
create policy "Dancers read own NFC enrollments" on public.dancer_nfc_enrollments for select
  using (dancer_user_id = auth.uid());

drop policy if exists "Venue owners read own dancer NFC enrollments" on public.dancer_nfc_enrollments;
create policy "Venue owners read own dancer NFC enrollments" on public.dancer_nfc_enrollments for select
  using (exists (
    select 1 from public.venues venue
    where venue.id = venue_id and venue.owner_user_id = auth.uid()
  ));

create or replace function public.rotate_venue_nfc_tag(
  p_tag_id uuid,
  p_owner_user_id uuid,
  p_replacement_id uuid,
  p_token_digest text
)
returns public.nfc_tags
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.nfc_tags;
  v_replacement public.nfc_tags;
  v_now timestamptz := clock_timestamp();
begin
  if p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid NFC tag secret.';
  end if;
  select tag.* into v_current
  from public.nfc_tags tag
  join public.venues venue on venue.id = tag.venue_id
  join public.app_users owner on owner.id = venue.owner_user_id
  where tag.id = p_tag_id
    and tag.status <> 'revoked'
    and venue.owner_user_id = p_owner_user_id
    and venue.is_active = true
    and owner.role = 'venue'
    and owner.account_state = 'active'
  for update of tag;
  if not found then
    raise exception using errcode = 'P0002', message = 'NFC tag not found.';
  end if;
  update public.nfc_tags
  set status = 'revoked', revoked_at = v_now, updated_at = v_now
  where id = v_current.id;
  insert into public.nfc_tags (
    id, venue_id, tag_type, label, token_digest, status,
    created_by_user_id, rotated_from_tag_id
  ) values (
    p_replacement_id, v_current.venue_id, v_current.tag_type, v_current.label,
    p_token_digest, 'active', p_owner_user_id, v_current.id
  ) returning * into v_replacement;
  return v_replacement;
end;
$$;

create or replace function public.approve_dancer_venue_affiliation_from_nfc(
  p_tag_id uuid,
  p_dancer_user_id uuid,
  p_session_id uuid,
  p_audit jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tag public.nfc_tags;
  v_affiliation public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_shift public.shifts;
  v_now timestamptz := clock_timestamp();
  v_profile_activated boolean := false;
  v_affiliation_activated boolean := false;
  v_shift_checked_in boolean := false;
begin
  select * into v_tag from public.nfc_tags where id = p_tag_id for update;
  if not found or v_tag.tag_type <> 'dressing_room'
    or (
      v_tag.status <> 'active'
      and not exists (
        select 1 from public.dancer_nfc_enrollments enrollment
        where enrollment.nfc_tag_id = v_tag.id
          and enrollment.dancer_user_id = p_dancer_user_id
          and enrollment.status = 'pending'
          and enrollment.expires_at > v_now
      )
    )
  then
    raise exception using errcode = '42501', message = 'This dressing-room NFC tag is inactive.';
  end if;

  select venue.* into v_venue
  from public.venues venue
  join public.app_users owner on owner.id = venue.owner_user_id
  where venue.id = v_tag.venue_id
    and venue.is_active = true
    and owner.role = 'venue'
    and owner.account_state = 'active'
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'This venue is not active.';
  end if;

  select * into v_dancer from public.dancer_profiles where user_id = p_dancer_user_id for update;
  if not found or v_dancer.status in ('rejected', 'disabled') or v_dancer.disabled_at is not null
    or nullif(trim(v_dancer.stage_name), '') is null or nullif(trim(v_dancer.city), '') is null
    or not exists (select 1 from public.app_users where id = p_dancer_user_id and role = 'dancer' and account_state = 'active')
    or (
      not (
        v_dancer.status = 'approved'
        and v_dancer.verification_status = 'approved'
        and v_dancer.is_public = true
      )
      and (
        nullif(trim(v_dancer.avatar_storage_path), '') is null
        or v_dancer.photo_review_status <> 'approved'
        or not exists (select 1 from public.dancer_photos photo where photo.dancer_id = v_dancer.id and photo.review_status = 'approved')
        or exists (select 1 from public.dancer_photos photo where photo.dancer_id = v_dancer.id and photo.review_status <> 'approved')
        or exists (select 1 from public.mydancr_tv_videos video where video.dancer_id = v_dancer.id and video.status in ('uploading', 'moderating', 'submitted'))
      )
    )
  then
    raise exception using errcode = '42501', message = 'Complete profile setup and media review before tapping to activate.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_dancer.id::text), hashtext(v_venue.id::text));

  select not exists (
    select 1
    from public.venue_dancer_affiliations affiliation
    where affiliation.venue_id = v_venue.id
      and affiliation.dancer_id = v_dancer.id
      and affiliation.status = 'active'
      and affiliation.revoked_at is null
  ) into v_affiliation_activated;

  insert into public.venue_dancer_affiliations (
    venue_id, dancer_id, status, approved_by_user_id, approved_at,
    revoked_by_user_id, revoked_at, revoke_reason, updated_at
  ) values (
    v_venue.id, v_dancer.id, 'active', v_venue.owner_user_id, v_now,
    null, null, null, v_now
  ) on conflict (venue_id, dancer_id) do update set
    status = 'active',
    approved_by_user_id = case
      when public.venue_dancer_affiliations.status = 'active'
        and public.venue_dancer_affiliations.revoked_at is null
      then public.venue_dancer_affiliations.approved_by_user_id
      else excluded.approved_by_user_id
    end,
    approved_at = case
      when public.venue_dancer_affiliations.status = 'active'
        and public.venue_dancer_affiliations.revoked_at is null
      then public.venue_dancer_affiliations.approved_at
      else excluded.approved_at
    end,
    revoked_by_user_id = null,
    revoked_at = null, revoke_reason = null, updated_at = excluded.updated_at
  returning * into v_affiliation;

  v_profile_activated := v_dancer.venue_approved_at is null or v_dancer.is_public = false;
  update public.dancer_profiles set
    status = 'approved',
    verification_status = 'approved',
    approved_at = coalesce(approved_at, v_now),
    is_public = true,
    venue_approved_at = coalesce(venue_approved_at, v_now),
    venue_approved_by_user_id = coalesce(venue_approved_by_user_id, v_venue.owner_user_id),
    venue_approved_venue_id = coalesce(venue_approved_venue_id, v_venue.id)
  where id = v_dancer.id;

  select shift.* into v_shift
  from public.shifts shift
  where shift.dancer_id = v_dancer.id
    and shift.venue_id = v_venue.id
    and shift.status = 'posted'
    and shift.starts_at <= v_now
    and shift.ends_at > v_now
  order by shift.starts_at desc
  limit 1
  for update;

  if found and v_shift.checked_in_at is null then
    update public.shifts set
      checked_in_at = v_now,
      checked_out_at = null,
      location_status = 'club_confirmed',
      location_verification_expires_at = v_shift.ends_at,
      working_status = 'working_now',
      commission_tracking_started_at = coalesce(commission_tracking_started_at, v_now),
      commission_tracking_stopped_at = null,
      ended_at = null,
      ended_reason = null,
      updated_at = v_now
    where id = v_shift.id;
    v_shift_checked_in := true;
  end if;

  if v_affiliation_activated then
    insert into public.venue_dancer_affiliation_events (
      affiliation_id, venue_id, dancer_id, actor_user_id, event_type, event_payload
    ) values (
      v_affiliation.id, v_venue.id, v_dancer.id, p_dancer_user_id,
      'affiliation_approved',
      jsonb_build_object('method', 'nfc', 'tagId', v_tag.id, 'profileActivated', v_profile_activated, 'shiftCheckedIn', v_shift_checked_in)
    );

    insert into public.notifications (
      recipient_id, notification_type, channel, title, body, payload, sent_at
    ) values (
      p_dancer_user_id,
      'venue_affiliation_status',
      'in_app',
      'Venue affiliation activated',
      case
        when v_profile_activated then
          v_venue.name || ' was added from its dressing-room NFC sticker. Your profile is now live and you can check in there for Working Now.'
        else
          v_venue.name || ' was added from its dressing-room NFC sticker. You can now check in there for Working Now and eligible Club Deal commissions.'
      end,
      jsonb_build_object(
        'affiliationId', v_affiliation.id,
        'venueId', v_venue.id,
        'venueSlug', v_venue.slug,
        'status', 'active',
        'method', 'nfc'
      ),
      v_now
    );
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id,
    v_venue.id,
    v_tag.tag_type,
    case
      when v_affiliation_activated then 'affiliation_approved'
      when v_shift_checked_in then 'shift_checked_in'
      else 'opened'
    end,
    p_dancer_user_id,
    p_session_id,
    p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object(
      'dancerId', v_dancer.id,
      'affiliationId', v_affiliation.id,
      'affiliationActivated', v_affiliation_activated,
      'shiftId', v_shift.id
    )
  );

  update public.nfc_tags set last_tapped_at = v_now, tap_count = tap_count + 1, updated_at = v_now where id = v_tag.id;

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug,
    'dancerId', v_dancer.id,
    'dancerUserId', p_dancer_user_id,
    'stageName', v_dancer.stage_name,
    'status', v_affiliation.status,
    'approvedAt', v_affiliation.approved_at,
    'affiliationActivated', v_affiliation_activated,
    'profileActivated', v_profile_activated,
    'shiftCheckedIn', v_shift_checked_in,
    'shiftId', v_shift.id
  );
end;
$$;

create or replace function public.register_dancer_nfc_enrollment(
  p_tag_id uuid,
  p_dancer_user_id uuid,
  p_session_id uuid,
  p_audit jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tag public.nfc_tags;
  v_venue public.venues;
  v_enrollment public.dancer_nfc_enrollments;
  v_result jsonb;
  v_ready boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  select tag.* into v_tag
  from public.nfc_tags tag
  where tag.id = p_tag_id and tag.status = 'active' and tag.tag_type = 'dressing_room'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'This dressing-room NFC tag is inactive.';
  end if;
  select venue.* into v_venue
  from public.venues venue
  join public.app_users owner on owner.id = venue.owner_user_id
  where venue.id = v_tag.venue_id and venue.is_active = true
    and owner.role = 'venue' and owner.account_state = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'This venue is not active.';
  end if;
  if not exists (
    select 1 from public.app_users account
    where account.id = p_dancer_user_id and account.role = 'dancer' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active dancer account is required.';
  end if;

  insert into public.dancer_nfc_enrollments (
    dancer_user_id, venue_id, nfc_tag_id, status, tapped_at, expires_at,
    completed_at, last_attempted_at, audit, updated_at
  ) values (
    p_dancer_user_id, v_venue.id, v_tag.id, 'pending', v_now, v_now + interval '7 days',
    null, v_now, p_audit || jsonb_build_object('sessionId', p_session_id), v_now
  ) on conflict (dancer_user_id, venue_id) do update set
    nfc_tag_id = excluded.nfc_tag_id,
    status = case when public.dancer_nfc_enrollments.status = 'completed' then 'completed' else 'pending' end,
    tapped_at = excluded.tapped_at,
    expires_at = excluded.expires_at,
    last_attempted_at = excluded.last_attempted_at,
    audit = public.dancer_nfc_enrollments.audit || excluded.audit,
    updated_at = excluded.updated_at
  returning * into v_enrollment;

  select exists (
    select 1
    from public.dancer_profiles dancer
    where dancer.user_id = p_dancer_user_id
      and dancer.status not in ('rejected', 'disabled')
      and dancer.disabled_at is null
      and nullif(trim(dancer.stage_name), '') is not null
      and nullif(trim(dancer.city), '') is not null
      and (
        (
          dancer.status = 'approved'
          and dancer.verification_status = 'approved'
          and dancer.is_public = true
        )
        or (
          nullif(trim(dancer.avatar_storage_path), '') is not null
          and dancer.photo_review_status = 'approved'
          and exists (select 1 from public.dancer_photos photo where photo.dancer_id = dancer.id and photo.review_status = 'approved')
          and not exists (select 1 from public.dancer_photos photo where photo.dancer_id = dancer.id and photo.review_status <> 'approved')
          and not exists (select 1 from public.mydancr_tv_videos video where video.dancer_id = dancer.id and video.status in ('uploading', 'moderating', 'submitted'))
        )
      )
  ) into v_ready;

  if v_ready then
    v_result := public.approve_dancer_venue_affiliation_from_nfc(p_tag_id, p_dancer_user_id, p_session_id, p_audit);
    update public.dancer_nfc_enrollments set
      status = 'completed', completed_at = v_now, last_attempted_at = v_now, updated_at = v_now
    where id = v_enrollment.id;
    return v_result || jsonb_build_object('enrollmentStatus', 'completed', 'enrollmentId', v_enrollment.id);
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_venue.id, v_tag.tag_type, 'opened', p_dancer_user_id, p_session_id,
    p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object('enrollmentId', v_enrollment.id, 'status', 'pending_profile_setup')
  );
  update public.nfc_tags set last_tapped_at = v_now, tap_count = tap_count + 1, updated_at = v_now where id = v_tag.id;

  return jsonb_build_object(
    'enrollmentStatus', 'pending',
    'enrollmentId', v_enrollment.id,
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug,
    'profileActivated', false,
    'shiftCheckedIn', false
  );
end;
$$;

create or replace function public.finalize_pending_dancer_nfc_enrollment(
  p_dancer_user_id uuid,
  p_session_id uuid,
  p_audit jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enrollment public.dancer_nfc_enrollments;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  update public.dancer_nfc_enrollments set status = 'expired', updated_at = v_now
  where dancer_user_id = p_dancer_user_id and status = 'pending' and expires_at <= v_now;

  select * into v_enrollment
  from public.dancer_nfc_enrollments
  where dancer_user_id = p_dancer_user_id and status = 'pending' and expires_at > v_now
  order by tapped_at asc
  limit 1
  for update;
  if not found then
    return jsonb_build_object('enrollmentStatus', 'none');
  end if;

  update public.dancer_nfc_enrollments set last_attempted_at = v_now, updated_at = v_now where id = v_enrollment.id;
  begin
    v_result := public.approve_dancer_venue_affiliation_from_nfc(
      v_enrollment.nfc_tag_id, p_dancer_user_id, p_session_id,
      p_audit || jsonb_build_object('enrollmentId', v_enrollment.id, 'finalizedAfterSetup', true)
    );
  exception when insufficient_privilege then
    return jsonb_build_object(
      'enrollmentStatus', 'pending',
      'enrollmentId', v_enrollment.id,
      'venueId', v_enrollment.venue_id
    );
  end;
  update public.dancer_nfc_enrollments set
    status = 'completed', completed_at = v_now, last_attempted_at = v_now, updated_at = v_now
  where id = v_enrollment.id;
  return v_result || jsonb_build_object('enrollmentStatus', 'completed', 'enrollmentId', v_enrollment.id);
end;
$$;

create or replace function public.confirm_deal_redemption_from_nfc(
  p_token text,
  p_tag_id uuid,
  p_session_id uuid,
  p_audit jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_redemption public.qr_redemptions;
  v_deal public.club_deals;
  v_venue public.venues;
  v_tag public.nfc_tags;
  v_month date;
  v_success_number integer;
  v_share_bps integer := 0;
  v_gross_cents integer := 0;
  v_dancer_cents integer := 0;
  v_platform_cents integer := 0;
  v_revenue_id uuid;
begin
  select * into v_tag from public.nfc_tags where id = p_tag_id for update;
  if not found or v_tag.status <> 'active' or v_tag.tag_type <> 'cashier' then
    raise exception using errcode = '42501', message = 'This cashier NFC tag is inactive.';
  end if;

  select redemption.* into v_redemption
  from public.qr_redemptions redemption
  where redemption.redemption_token = p_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Club Deal redemption not found.';
  end if;

  select * into v_deal from public.club_deals where id = v_redemption.club_deal_id;
  select venue.* into v_venue
  from public.venues venue
  join public.app_users account on account.id = venue.owner_user_id
  where venue.id = v_tag.venue_id and venue.is_active = true
    and account.role = 'venue' and account.account_state = 'active';
  if not found or v_redemption.venue_id <> v_tag.venue_id then
    raise exception using errcode = '42501', message = 'This Club Deal belongs to a different venue.';
  end if;
  if not v_deal.is_active or v_deal.venue_id <> v_tag.venue_id then
    raise exception using errcode = '22023', message = 'This Club Deal is no longer active.';
  end if;
  if v_redemption.status = 'redeemed' then
    raise exception using errcode = '23505', message = 'This Club Deal was already redeemed.';
  end if;
  if v_redemption.status in ('voided', 'expired') or v_redemption.expires_at <= v_now then
    update public.qr_redemptions set status = 'expired' where id = v_redemption.id and status = 'generated';
    raise exception using errcode = '22023', message = 'This Club Deal is no longer valid.';
  end if;
  if v_deal.payout_type <> 'flat' or v_deal.payout_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'This venue has not configured a referral commission.';
  end if;
  if v_redemption.source_type = 'dancer_profile'
    and (v_redemption.dancer_id is null or v_redemption.shift_id is null) then
    raise exception using errcode = '22023', message = 'Dancer attribution is incomplete for this Club Deal.';
  end if;
  if exists (
    select 1 from public.qr_redemptions previous
    where previous.id <> v_redemption.id
      and previous.club_deal_id = v_redemption.club_deal_id
      and previous.venue_id = v_redemption.venue_id
      and previous.status = 'redeemed'
      and previous.redeemed_at >= v_now - interval '24 hours'
      and (
        (v_redemption.customer_id is not null and previous.customer_id = v_redemption.customer_id)
        or (v_redemption.customer_id is null and v_redemption.session_id is not null and previous.session_id = v_redemption.session_id)
      )
  ) then
    raise exception using errcode = '23505', message = 'This Club Deal has already been used in the last 24 hours.';
  end if;

  v_month := date_trunc('month', timezone(coalesce(nullif(v_venue.timezone, ''), 'UTC'), v_now))::date;
  v_gross_cents := v_deal.payout_amount_cents;
  if v_redemption.source_type = 'dancer_profile' then
    perform pg_advisory_xact_lock(hashtext(v_redemption.dancer_id::text), hashtext(v_month::text));
    select count(*)::integer + 1 into v_success_number
    from public.deal_revenue_events revenue
    where revenue.dancer_id = v_redemption.dancer_id
      and revenue.commission_month = v_month
      and revenue.status not in ('refunded', 'voided');
    v_share_bps := case when v_success_number >= 75 then 5000 when v_success_number >= 25 then 4000 else 3000 end;
    v_dancer_cents := round(v_gross_cents * v_share_bps / 10000.0)::integer;
  else
    v_success_number := null;
  end if;
  v_platform_cents := v_gross_cents - v_dancer_cents;

  update public.qr_redemptions set
    status = 'redeemed', redeemed_at = v_now, confirmed_at = v_now,
    first_scanned_at = coalesce(first_scanned_at, v_now), nfc_tag_id = v_tag.id,
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object('nfc_confirmed', p_audit, 'nfc_tag_id', v_tag.id)
  where id = v_redemption.id;

  insert into public.qr_redemption_events (qr_redemption_id, event_type, session_id, audit)
  values (v_redemption.id, 'venue_confirmed', p_session_id::text, p_audit || jsonb_build_object('method', 'nfc', 'tagId', v_tag.id));

  insert into public.deal_revenue_events (
    qr_redemption_id, venue_id, club_deal_id, dancer_id, source_type, currency,
    gross_commission_cents, dancer_share_bps, dancer_commission_cents,
    platform_commission_cents, successful_redemption_number, commission_month,
    policy_version, audit, confirmed_at
  ) values (
    v_redemption.id, v_redemption.venue_id, v_redemption.club_deal_id,
    v_redemption.dancer_id, v_redemption.source_type, v_deal.currency,
    v_gross_cents, v_share_bps, v_dancer_cents, v_platform_cents,
    v_success_number, v_month, 'monthly-tier-v1',
    jsonb_build_object('source', 'cashier_nfc_tap', 'nfc_tag_id', v_tag.id, 'shift_id', v_redemption.shift_id), v_now
  ) returning id into v_revenue_id;

  if v_redemption.source_type = 'dancer_profile' then
    insert into public.commission_events (
      qr_redemption_id, venue_id, club_deal_id, dancer_id, status, amount_cents,
      payout_type, gross_commission_cents, dancer_share_bps, platform_amount_cents,
      successful_redemption_number, commission_month, currency, policy_version, audit
    ) values (
      v_redemption.id, v_redemption.venue_id, v_redemption.club_deal_id,
      v_redemption.dancer_id, 'pending_club_payment', v_dancer_cents, 'flat',
      v_gross_cents, v_share_bps, v_platform_cents, v_success_number, v_month,
      v_deal.currency, 'monthly-tier-v1',
      jsonb_build_object('source', 'deal_revenue_event', 'deal_revenue_event_id', v_revenue_id, 'nfc_tag_id', v_tag.id)
    );
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_tag.venue_id, v_tag.tag_type, 'deal_redeemed', v_redemption.customer_id,
    p_session_id, p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object('redemptionId', v_redemption.id, 'dealId', v_deal.id, 'revenueEventId', v_revenue_id)
  );
  update public.nfc_tags set last_tapped_at = v_now, tap_count = tap_count + 1, updated_at = v_now where id = v_tag.id;

  return jsonb_build_object(
    'redemptionId', v_redemption.id,
    'revenueEventId', v_revenue_id,
    'dealTitle', v_deal.deal_title,
    'venueName', v_venue.name,
    'sourceType', v_redemption.source_type,
    'grossCommissionCents', v_gross_cents,
    'dancerShareBps', v_share_bps,
    'dancerCommissionCents', v_dancer_cents,
    'platformCommissionCents', v_platform_cents,
    'successfulRedemptionNumber', v_success_number,
    'status', 'redeemed'
  );
end;
$$;

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
        message = 'Tap this venue''s official dressing-room NFC sticker before checking in.';
    end if;

    new.venue_affiliation_id = v_affiliation_id;
  elsif new.venue_affiliation_id is distinct from old.venue_affiliation_id
    and auth.role() <> 'service_role'
    and session_user not in ('postgres', 'supabase_admin')
  then
    raise exception using
      errcode = '42501',
      message = 'Venue affiliation proof can only be set by the NFC check-in service.';
  end if;

  return new;
end;
$$;

revoke all on function public.approve_dancer_venue_affiliation_from_nfc(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.approve_dancer_venue_affiliation_from_nfc(uuid, uuid, uuid, jsonb) to service_role;
revoke all on function public.confirm_deal_redemption_from_nfc(text, uuid, uuid, jsonb) from public;
grant execute on function public.confirm_deal_redemption_from_nfc(text, uuid, uuid, jsonb) to service_role;
revoke all on function public.rotate_venue_nfc_tag(uuid, uuid, uuid, text) from public;
grant execute on function public.rotate_venue_nfc_tag(uuid, uuid, uuid, text) to service_role;
revoke all on function public.register_dancer_nfc_enrollment(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.register_dancer_nfc_enrollment(uuid, uuid, uuid, jsonb) to service_role;
revoke all on function public.finalize_pending_dancer_nfc_enrollment(uuid, uuid, jsonb) from public;
grant execute on function public.finalize_pending_dancer_nfc_enrollment(uuid, uuid, jsonb) to service_role;

comment on table public.nfc_tags is
  'Venue-owned NFC sticker registry. Only SHA-256 token digests are retained; programming URLs are returned once.';
comment on table public.nfc_tap_events is
  'Immutable venue NFC authorization and redemption audit trail.';
comment on table public.venue_dancer_affiliations is
  'Dancer-to-venue relationships activated by official dressing-room NFC taps and required for Working Now and attributed Club Deal commissions.';
comment on column public.qr_redemptions.nfc_tag_id is
  'NFC tag that authorized the redemption. The legacy table name is retained for financial-history compatibility.';

notify pgrst, 'reload schema';
commit;
