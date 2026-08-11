begin;

-- Dressing-room NFC replaces browser geofencing and manager QR approval.

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
  v_checkin_expires_at timestamptz;
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
    raise exception using errcode = '42501', message = 'This dressing-room NFC sticker is inactive.';
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
    or not exists (
      select 1 from public.app_users
      where id = p_dancer_user_id and role = 'dancer' and account_state = 'active'
    )
    or (
      not (
        v_dancer.status = 'approved'
        and v_dancer.verification_status = 'approved'
        and v_dancer.is_public = true
      )
      and (
        nullif(trim(v_dancer.avatar_storage_path), '') is null
        or v_dancer.photo_review_status <> 'approved'
        or not exists (
          select 1 from public.dancer_photos photo
          where photo.dancer_id = v_dancer.id and photo.review_status = 'approved'
        )
        or exists (
          select 1 from public.dancer_photos photo
          where photo.dancer_id = v_dancer.id and photo.review_status <> 'approved'
        )
        or exists (
          select 1 from public.mydancr_tv_videos video
          where video.dancer_id = v_dancer.id and video.status in ('uploading', 'moderating', 'submitted')
        )
      )
    )
  then
    raise exception using errcode = '42501', message = 'Complete profile setup and media review before tapping to activate.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_dancer.id::text), hashtext(v_venue.id::text));

  select not exists (
    select 1 from public.venue_dancer_affiliations affiliation
    where affiliation.venue_id = v_venue.id
      and affiliation.dancer_id = v_dancer.id
      and affiliation.status = 'active'
      and affiliation.revoked_at is null
  ) into v_affiliation_activated;

  insert into public.venue_dancer_affiliations (
    venue_id, dancer_id, status, approved_by_user_id, approved_at,
    revoked_by_user_id, revoked_at, revoke_reason, updated_at
  ) values (
    v_venue.id, v_dancer.id, 'active', p_dancer_user_id, v_now,
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
    revoked_at = null,
    revoke_reason = null,
    updated_at = excluded.updated_at
  returning * into v_affiliation;

  v_profile_activated := v_dancer.venue_approved_at is null or v_dancer.is_public = false;
  update public.dancer_profiles set
    status = 'approved',
    verification_status = 'approved',
    approved_at = coalesce(approved_at, v_now),
    is_public = true,
    venue_approved_at = coalesce(venue_approved_at, v_now),
    venue_approved_by_user_id = coalesce(venue_approved_by_user_id, p_dancer_user_id),
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

  if found then
    v_checkin_expires_at := least(v_shift.ends_at, v_now + interval '5 hours');
    update public.shifts set
      checked_in_at = v_now,
      checked_out_at = null,
      checkin_latitude = null,
      checkin_longitude = null,
      checkin_distance_feet = null,
      checkin_accuracy_meters = null,
      checkin_captured_at = null,
      last_location_latitude = null,
      last_location_longitude = null,
      last_location_accuracy_meters = null,
      last_location_captured_at = null,
      last_location_verified_at = null,
      location_status = 'club_confirmed',
      location_verification_expires_at = v_checkin_expires_at,
      venue_affiliation_id = v_affiliation.id,
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
      jsonb_build_object(
        'method', 'dressing_room_nfc',
        'tagId', v_tag.id,
        'profileActivated', v_profile_activated,
        'shiftCheckedIn', v_shift_checked_in
      )
    );

    insert into public.notifications (
      recipient_id, notification_type, channel, title, body, payload, sent_at
    ) values (
      p_dancer_user_id,
      'venue_affiliation_status',
      'in_app',
      'Venue access activated',
      v_venue.name || ' was authorized from its official dressing-room NFC sticker.',
      jsonb_build_object(
        'affiliationId', v_affiliation.id,
        'venueId', v_venue.id,
        'venueSlug', v_venue.slug,
        'status', 'active',
        'method', 'dressing_room_nfc'
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
    p_audit->>'ip_address',
    p_audit->>'user_agent',
    p_audit->>'device_fingerprint',
    coalesce(p_audit, '{}'::jsonb) || jsonb_build_object(
      'method', 'dressing_room_nfc',
      'dancerId', v_dancer.id,
      'affiliationId', v_affiliation.id,
      'affiliationActivated', v_affiliation_activated,
      'shiftId', v_shift.id,
      'checkInExpiresAt', v_checkin_expires_at
    )
  );

  update public.nfc_tags set
    last_tapped_at = v_now,
    tap_count = tap_count + 1,
    updated_at = v_now
  where id = v_tag.id;

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
    'shiftId', v_shift.id,
    'checkInExpiresAt', v_checkin_expires_at
  );
end;
$$;

drop function if exists public.check_in_manager_approved_dancer_from_nfc(uuid, uuid, uuid, jsonb);

revoke all on function public.approve_dancer_venue_affiliation_from_nfc(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_dancer_venue_affiliation_from_nfc(uuid, uuid, uuid, jsonb)
  to service_role;

comment on function public.approve_dancer_venue_affiliation_from_nfc(uuid, uuid, uuid, jsonb) is
  'Authorizes a dancer venue affiliation from an official dressing-room NFC tap and renews a current posted shift for at most five hours.';

comment on table public.venue_dancer_affiliations is
  'Dancer-to-venue access created by official dressing-room NFC taps; no manager QR approval is required.';

notify pgrst, 'reload schema';

commit;
