-- Channel-aware NFC check-in. Existing public-only users are not opted into the internal roster.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Approval and physical presence are independent of public visibility.
CREATE OR REPLACE FUNCTION public.approve_dancer_venue_affiliation_from_nfc(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tag public.nfc_tags;
  v_affiliation public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_now timestamptz := clock_timestamp();
  v_profile_activated boolean := false;
  v_affiliation_activated boolean := false;
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
  if not found
    or v_dancer.status in ('rejected', 'disabled')
    or v_dancer.disabled_at is not null
    or nullif(trim(v_dancer.stage_name), '') is null
    or nullif(trim(v_dancer.city), '') is null
    or not exists (
      select 1 from public.app_users
      where id = p_dancer_user_id and role = 'dancer' and account_state = 'active'
    )
    or (
      not (
        v_dancer.status = 'approved'
        and v_dancer.verification_status = 'approved'

      )
      and (
        v_dancer.status <> 'pending_review'
        or nullif(trim(v_dancer.avatar_storage_path), '') is null
        or not exists (
          select 1 from public.dancer_photos photo
          where photo.dancer_id = v_dancer.id and photo.review_status = 'approved'
        )
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Submit Step 2 with an approved avatar and profile picture before tapping to activate.';
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
    revoked_at = null,
    revoke_reason = null,
    updated_at = excluded.updated_at
  returning * into v_affiliation;

  v_profile_activated := v_dancer.venue_approved_at is null;
  update public.dancer_profiles set
    status = 'approved',
    verification_status = 'approved',
    approved_at = coalesce(approved_at, v_now),
    is_public = true,
    venue_approved_at = coalesce(venue_approved_at, v_now),
    venue_approved_by_user_id = coalesce(venue_approved_by_user_id, v_venue.owner_user_id),
    venue_approved_venue_id = coalesce(venue_approved_venue_id, v_venue.id)
  where id = v_dancer.id;

  if v_affiliation_activated then
    insert into public.venue_dancer_affiliation_events (
      affiliation_id, venue_id, dancer_id, actor_user_id, event_type, event_payload
    ) values (
      v_affiliation.id, v_venue.id, v_dancer.id, p_dancer_user_id,
      'affiliation_approved',
      jsonb_build_object(
        'method', 'nfc',
        'tagId', v_tag.id,
        'profileActivated', v_profile_activated,
        'shiftCheckedIn', false
      )
    );

    insert into public.notifications (
      recipient_id, notification_type, channel, title, body, payload, sent_at
    ) values (
      p_dancer_user_id,
      'venue_affiliation_status',
      'in_app',
      'Venue affiliation activated',
      v_venue.name || ' was added from its dressing-room NFC tag. A fresh eligible tap starts Working Now.',
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
    v_tag.id, v_venue.id, v_tag.tag_type,
    case when v_affiliation_activated then 'affiliation_approved' else 'opened' end,
    p_dancer_user_id, p_session_id,
    p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object(
      'dancerId', v_dancer.id,
      'affiliationId', v_affiliation.id,
      'affiliationActivated', v_affiliation_activated,
      'shiftCheckedIn', false
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
    'shiftCheckedIn', false,
    'shiftId', null
  );
end;
$function$
;

-- Approval and physical presence are independent of public visibility.
CREATE OR REPLACE FUNCTION public.register_dancer_nfc_enrollment(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tag public.nfc_tags;
  v_venue public.venues;
  v_enrollment public.dancer_nfc_enrollments;
  v_result jsonb;
  v_ready boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  -- Both fresh taps and deferred completion take this lock before any
  -- tag or enrollment row lock, so their opposite row access orders cannot
  -- deadlock each other for the same dancer. Released with the transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mydancr:dancer-nfc-enrollment:' || p_dancer_user_id::text, 0)
  );

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

        )
        or (
          dancer.status = 'pending_review'
          and nullif(trim(dancer.avatar_storage_path), '') is not null
          and exists (
            select 1 from public.dancer_photos photo
            where photo.dancer_id = dancer.id and photo.review_status = 'approved'
          )
        )
      )
  ) into v_ready;

  if v_ready then
    v_result := public.approve_dancer_venue_affiliation_from_nfc(
      p_tag_id,
      p_dancer_user_id,
      p_session_id,
      p_audit
    );
    update public.dancer_nfc_enrollments set
      status = 'completed',
      completed_at = v_now,
      last_attempted_at = v_now,
      updated_at = v_now
    where id = v_enrollment.id;
    return v_result || jsonb_build_object(
      'enrollmentStatus', 'completed',
      'enrollmentId', v_enrollment.id
    );
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_venue.id, v_tag.tag_type, 'opened', p_dancer_user_id, p_session_id,
    p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object('enrollmentId', v_enrollment.id, 'status', 'pending_profile_setup')
  );
  update public.nfc_tags set
    last_tapped_at = v_now,
    tap_count = tap_count + 1,
    updated_at = v_now
  where id = v_tag.id;

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
$function$
;

-- Approval and physical presence are independent of public visibility.
CREATE OR REPLACE FUNCTION public.activate_dancer_shift_from_nfc(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tag public.nfc_tags;
  v_venue public.venues;
  v_dancer public.dancer_profiles;
  v_affiliation public.venue_dancer_affiliations;
  v_shift public.shifts;
  v_previous public.shifts;
  v_current_venue_name text;
  v_current_venue_slug text;
  v_now timestamptz := clock_timestamp();
  v_working_until timestamptz := clock_timestamp() + interval '6 hours';
  v_next_tap_allowed_at timestamptz;
  v_local_date date;
begin
  select tag.* into v_tag
  from public.nfc_tags tag
  where tag.id = p_tag_id
    and tag.status = 'active'
    and tag.tag_type = 'dressing_room'
  for update;
  if not found then
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

  select dancer.* into v_dancer
  from public.dancer_profiles dancer
  join public.app_users account on account.id = dancer.user_id
  where dancer.user_id = p_dancer_user_id
    and account.role = 'dancer'
    and account.account_state = 'active'
    and dancer.status = 'approved'
    and dancer.verification_status = 'approved'
    and dancer.disabled_at is null
  for update of dancer;
  if not found then
    raise exception using errcode = '42501', message = 'Complete profile setup before tapping to go Working Now.';
  end if;

  select affiliation.* into v_affiliation
  from public.venue_dancer_affiliations affiliation
  where affiliation.venue_id = v_venue.id
    and affiliation.dancer_id = v_dancer.id
    and affiliation.status = 'active'
    and affiliation.revoked_at is null
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'An active venue affiliation is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_dancer.id::text), 781236);
  v_local_date := timezone(coalesce(nullif(v_venue.timezone, ''), 'UTC'), v_now)::date;

  update public.shifts
  set checked_out_at = coalesce(checked_out_at, location_verification_expires_at, v_now),
      location_verification_expires_at = least(coalesce(location_verification_expires_at, v_now), v_now),
      working_status = 'ended',
      commission_tracking_stopped_at = coalesce(commission_tracking_stopped_at, location_verification_expires_at, v_now),
      ended_at = coalesce(ended_at, location_verification_expires_at, v_now),
      ended_reason = coalesce(ended_reason, 'nfc_window_expired'),
      updated_at = v_now
  where dancer_id = v_dancer.id
    and checked_in_at is not null
    and checked_out_at is null
    and location_verification_expires_at <= v_now;

  select shift.* into v_previous
  from public.shifts shift
  where shift.dancer_id = v_dancer.id
    and shift.status = 'posted'
    and shift.checked_in_at is not null
    and shift.checked_out_at is null
    and shift.location_status = 'club_confirmed'
    and shift.location_verification_expires_at > v_now
  order by shift.checked_in_at desc
  limit 1
  for update;

  if found then
    v_next_tap_allowed_at := coalesce(v_previous.nfc_last_tapped_at, v_previous.checked_in_at) + interval '12 hours';
    select venue.name, venue.slug into v_current_venue_name, v_current_venue_slug
    from public.venues venue
    where venue.id = v_previous.venue_id;
    insert into public.nfc_tap_events (
      nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
      ip_address, user_agent, device_fingerprint, audit
    ) values (
      v_tag.id, v_venue.id, v_tag.tag_type, 'opened', p_dancer_user_id, p_session_id,
      p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
      p_audit || jsonb_build_object(
        'dancerId', v_dancer.id,
        'shiftId', v_previous.id,
        'tapApplied', false,
        'reason', 'active_window_not_extendable',
        'workingUntil', v_previous.location_verification_expires_at,
        'nextTapAllowedAt', v_next_tap_allowed_at,
        'method', 'dressing_room_nfc'
      )
    );
    return jsonb_build_object(
      'shiftCheckedIn', true,
      'tapApplied', false,
      'alreadyWorking', true,
      'cooldownActive', false,
      'shiftId', v_previous.id,
      'workingUntil', v_previous.location_verification_expires_at,
      'nextTapAllowedAt', v_next_tap_allowed_at,
      'venueId', v_previous.venue_id,
      'venueName', coalesce(v_current_venue_name, v_venue.name),
      'venueSlug', coalesce(v_current_venue_slug, v_venue.slug),
      'extended', false,
      'switchedVenue', false
    );
  end if;

  select shift.* into v_previous
  from public.shifts shift
  where shift.dancer_id = v_dancer.id
    and shift.nfc_last_tapped_at is not null
    and shift.nfc_last_tapped_at + interval '12 hours' > v_now
  order by shift.nfc_last_tapped_at desc
  limit 1
  for update;

  if found then
    v_next_tap_allowed_at := v_previous.nfc_last_tapped_at + interval '12 hours';
    select venue.name, venue.slug into v_current_venue_name, v_current_venue_slug
    from public.venues venue
    where venue.id = v_previous.venue_id;
    insert into public.nfc_tap_events (
      nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
      ip_address, user_agent, device_fingerprint, audit
    ) values (
      v_tag.id, v_venue.id, v_tag.tag_type, 'opened', p_dancer_user_id, p_session_id,
      p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
      p_audit || jsonb_build_object(
        'dancerId', v_dancer.id,
        'shiftId', v_previous.id,
        'tapApplied', false,
        'reason', 'nfc_cooldown_active',
        'nextTapAllowedAt', v_next_tap_allowed_at,
        'method', 'dressing_room_nfc'
      )
    );
    return jsonb_build_object(
      'shiftCheckedIn', false,
      'tapApplied', false,
      'alreadyWorking', false,
      'cooldownActive', true,
      'shiftId', v_previous.id,
      'workingUntil', v_previous.location_verification_expires_at,
      'nextTapAllowedAt', v_next_tap_allowed_at,
      'venueId', v_previous.venue_id,
      'venueName', coalesce(v_current_venue_name, v_venue.name),
      'venueSlug', coalesce(v_current_venue_slug, v_venue.slug),
      'extended', false,
      'switchedVenue', false
    );
  end if;

  select shift.* into v_shift
    from public.shifts shift
    where shift.dancer_id = v_dancer.id
      and shift.venue_id = v_venue.id
      and shift.status = 'posted'
      and shift.shift_source = 'scheduled'
      and shift.shift_date = v_local_date
      and shift.checked_in_at is null
      and shift.checked_out_at is null
    order by shift.created_at desc
    limit 1
    for update;

  if found then
    update public.shifts
      set starts_at = v_now,
          ends_at = v_working_until,
          checked_in_at = v_now,
          checked_out_at = null,
          location_status = 'club_confirmed',
          last_location_verified_at = v_now,
          location_verification_expires_at = v_working_until,
          working_status = 'club_confirmed',
          commission_tracking_started_at = v_now,
          commission_tracking_stopped_at = null,
          ended_at = null,
          ended_reason = null,
          venue_affiliation_id = v_affiliation.id,
          nfc_tag_id = v_tag.id,
          nfc_last_tapped_at = v_now,
          updated_at = v_now
      where id = v_shift.id
    returning * into v_shift;
  else
    insert into public.shifts (
        dancer_id, venue_id, starts_at, ends_at, timezone, status,
        shift_date, shift_source, checked_in_at, location_status,
        last_location_verified_at, location_verification_expires_at,
        working_status, commission_tracking_started_at, venue_affiliation_id,
        nfc_tag_id, nfc_last_tapped_at
      ) values (
        v_dancer.id, v_venue.id, v_now, v_working_until,
        coalesce(nullif(v_venue.timezone, ''), 'UTC'), 'posted',
        v_local_date, 'nfc_presence', v_now, 'club_confirmed',
        v_now, v_working_until, 'club_confirmed', v_now, v_affiliation.id,
        v_tag.id, v_now
    ) returning * into v_shift;
  end if;

  v_next_tap_allowed_at := v_now + interval '12 hours';

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_venue.id, v_tag.tag_type, 'shift_checked_in', p_dancer_user_id, p_session_id,
    p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object(
      'dancerId', v_dancer.id,
      'shiftId', v_shift.id,
      'workingUntil', v_working_until,
      'nextTapAllowedAt', v_next_tap_allowed_at,
      'tapApplied', true,
      'method', 'dressing_room_nfc'
    )
  );

  return jsonb_build_object(
    'shiftCheckedIn', true,
    'tapApplied', true,
    'alreadyWorking', false,
    'cooldownActive', false,
    'shiftId', v_shift.id,
    'workingUntil', v_working_until,
    'nextTapAllowedAt', v_next_tap_allowed_at,
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug,
    'extended', false,
    'switchedVenue', false
  );
end;
$function$
;

commit;
