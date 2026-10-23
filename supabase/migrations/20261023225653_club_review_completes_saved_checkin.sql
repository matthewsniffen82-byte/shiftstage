begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

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
  v_tapped_at timestamptz := v_now;
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
  -- A club review can complete only the persisted, approved first tap. Never
  -- accept a caller-supplied timestamp or restart its six-hour presence window.
  if p_audit->>'clubProfileReview' = 'true' then
    select e.tapped_at into v_tapped_at from public.dancer_nfc_enrollments e
      join public.club_dancer_approvals a on a.venue_id=e.venue_id and a.dancer_id=v_dancer.id
      where e.dancer_user_id=p_dancer_user_id and e.venue_id=v_venue.id and e.nfc_tag_id=p_tag_id
        and e.status='pending' and e.expires_at>v_now and a.status='approved'
        and e.audit->>'sessionId'=p_session_id::text
        and e.tapped_at<=v_now and e.tapped_at+interval '6 hours'>v_now
      for update of e;
    if not found then raise exception 'NFC_SAVED_TAP_EXPIRED' using errcode='40001'; end if;
  end if;
  v_working_until := v_tapped_at + interval '6 hours';
  v_local_date := timezone(coalesce(nullif(v_venue.timezone, ''), 'UTC'), v_tapped_at)::date;

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
      set starts_at = v_tapped_at,
          ends_at = v_working_until,
          checked_in_at = v_tapped_at,
          checked_out_at = null,
          location_status = 'club_confirmed',
          last_location_verified_at = v_tapped_at,
          location_verification_expires_at = v_working_until,
          working_status = 'club_confirmed',
          commission_tracking_started_at = v_tapped_at,
          commission_tracking_stopped_at = null,
          ended_at = null,
          ended_reason = null,
          venue_affiliation_id = v_affiliation.id,
          nfc_tag_id = v_tag.id,
          nfc_last_tapped_at = v_tapped_at,
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
        v_dancer.id, v_venue.id, v_tapped_at, v_working_until,
        coalesce(nullif(v_venue.timezone, ''), 'UTC'), 'posted',
        v_local_date, 'nfc_presence', v_tapped_at, 'club_confirmed',
        v_tapped_at, v_working_until, 'club_confirmed', v_tapped_at, v_affiliation.id,
        v_tag.id, v_tapped_at
    ) returning * into v_shift;
  end if;

  v_next_tap_allowed_at := v_tapped_at + interval '12 hours';

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
revoke all on function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.review_club_dancer_approval_and_check_in(p_actor_user_id uuid,p_venue_id uuid,p_dancer_id uuid,p_revision uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_user_id uuid; v_request public.club_dancer_approvals; v_enrollment public.dancer_nfc_enrollments;
  v_affiliation public.venue_dancer_affiliations; v_visibility text; v_pending integer; v_photos integer;
  v_presence jsonb := '{}'::jsonb; v_checked_in boolean := false;
  v_check_in_status text := 'not_approved'; v_session_id uuid; v_shift_id uuid;
begin
  if p_decision is null or p_decision not in ('approved','rejected') or p_revision is null then
    raise exception 'INVALID_CLUB_DECISION' using errcode='22023';
  end if;
  if not exists(select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id
    join public.app_users actor on actor.id=p_actor_user_id
    where v.id=p_venue_id and v.is_active and owner.role='venue' and owner.account_state='active'
      and actor.role='venue' and actor.account_state='active'
      and (v.owner_user_id=p_actor_user_id or exists(select 1 from public.venue_team_members m
        where m.venue_id=v.id and m.user_id=p_actor_user_id and m.status='active' and m.role='manager')))
  then raise exception 'CLUB_MANAGER_REQUIRED' using errcode='42501'; end if;
  select user_id into v_user_id from public.dancer_profiles where id=p_dancer_id;
  if not found then raise exception 'CLUB_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||v_user_id::text,0));
  perform 1 from public.dancer_profiles d join public.app_users u on u.id=d.user_id
    where d.id=p_dancer_id and d.disabled_at is null and d.status in ('pending_review','approved')
      and u.account_state='active' and u.role='dancer' for update of d;
  if not found then raise exception 'DANCER_UNAVAILABLE' using errcode='42501'; end if;
  select * into v_request from public.club_dancer_approvals
    where venue_id=p_venue_id and dancer_id=p_dancer_id for update;
  if not found then raise exception 'CLUB_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  if v_request.revision<>p_revision or v_request.status='approved' then
    raise exception 'CLUB_REQUEST_CHANGED' using errcode='40001';
  end if;
  select e.* into v_enrollment from public.dancer_nfc_enrollments e join public.nfc_tags t on t.id=e.nfc_tag_id
    where e.venue_id=p_venue_id and e.dancer_user_id=v_user_id and e.status='pending'
      and e.expires_at>clock_timestamp() and t.status='active' and t.venue_id=p_venue_id and t.tag_type='dressing_room'
    for update of e;
  if not found then raise exception 'CLUB_REQUEST_EXPIRED' using errcode='40001'; end if;
  if p_decision='approved' then
    -- Recheck every current content version inside the membership transaction.
    -- A new/replaced item cannot inherit the reviewed version's decision.
    select count(*) filter(where a.decision is null),
      count(*) filter(where a.decision='approved' and m.kind='photo' and m.record->>'upload_context'<>'profile_avatar')
      into v_pending,v_photos
    from public.dancer_club_media(array[p_dancer_id]) m left join public.club_media_permissions a
      on a.venue_id=p_venue_id and a.dancer_id=p_dancer_id and a.source=m.source and a.media_id=m.id
        and a.content_version=m.content_version;
    if v_pending>0 or v_photos=0 then raise exception 'CLUB_PROFILE_MEDIA_REVIEW_REQUIRED' using errcode='40001'; end if;
    if not exists(select 1 from public.dancer_age_verifications where user_id=v_user_id
      and provider='ondato' and status='verified' and verified_at<=v_enrollment.tapped_at)
    then raise exception 'AGE_VERIFICATION_REQUIRED_BEFORE_TAP' using errcode='42501'; end if;
  end if;
  update public.club_dancer_approvals set status=p_decision,reviewed_at=clock_timestamp(),
    reviewed_by=p_actor_user_id,revision=gen_random_uuid()
    where venue_id=p_venue_id and dancer_id=p_dancer_id returning * into v_request;
  if p_decision='approved' then
    if exists(select 1 from public.venue_dancer_affiliations where venue_id=p_venue_id and dancer_id=p_dancer_id
      and status='revoked' and reentry_blocked) then
      raise exception 'CLUB_REENTRY_BLOCKED' using errcode='42501';
    end if;
    insert into public.venue_dancer_affiliations(venue_id,dancer_id,status,approved_by_user_id,approved_at)
      values(p_venue_id,p_dancer_id,'active',p_actor_user_id,clock_timestamp())
      on conflict(venue_id,dancer_id) do update set status='active',approved_by_user_id=excluded.approved_by_user_id,
        approved_at=excluded.approved_at,revoked_at=null,revoked_by_user_id=null,revoke_reason=null,updated_at=clock_timestamp()
      returning * into v_affiliation;
    v_visibility:=v_enrollment.audit->>'visibility';
    -- Respect the dancer's choice, but never overwrite a newer visibility choice.
    if v_visibility in ('internal','external','both') and not exists(select 1 from public.dancer_channel_preferences
      where dancer_id=p_dancer_id and selected_at>v_enrollment.tapped_at) then
      insert into public.dancer_channel_preferences(dancer_id,visibility,selected_at)
        values(p_dancer_id,v_visibility,v_enrollment.tapped_at)
        on conflict(dancer_id) do update set visibility=excluded.visibility,selected_at=excluded.selected_at;
      update public.dancer_profiles set is_public=v_visibility in ('external','both')
        where id=p_dancer_id and status='approved' and verification_status='approved';
    end if;
    select visibility into v_visibility from public.dancer_channel_preferences where dancer_id=p_dancer_id;
    v_check_in_status := 'profile_pending';
    if v_enrollment.tapped_at + interval '6 hours' <= clock_timestamp() then
      v_check_in_status := 'tap_expired';
    elsif exists(select 1 from public.dancer_profiles where id=p_dancer_id
      and status='approved' and verification_status='approved') and v_visibility in ('internal','external','both') then
      v_check_in_status := 'media_pending';
      -- Previously platform-approved photos need only this club's acceptance.
      -- New uploads never replace the already-approved live profile here.
      if exists(select 1 from public.dancer_club_media(array[p_dancer_id]) m
        join public.club_media_permissions a on a.venue_id=p_venue_id and a.dancer_id=p_dancer_id
          and a.source=m.source and a.media_id=m.id and a.content_version=m.content_version and a.decision='approved'
        where m.photo_id is not null and m.record->>'status'='approved') then
        v_session_id := (v_enrollment.audit->>'sessionId')::uuid;
        v_presence := public.activate_dancer_shift_from_nfc(v_enrollment.nfc_tag_id,v_user_id,v_session_id,
          v_enrollment.audit||jsonb_build_object('clubProfileReview',true,'reviewedBy',p_actor_user_id));
        v_checked_in := coalesce((v_presence->>'shiftCheckedIn')::boolean,false)
          and v_presence->>'venueId'=p_venue_id::text;
        v_check_in_status := case when v_checked_in then 'checked_in'
          when (v_presence->>'cooldownActive')::boolean then 'cooldown' else 'active_other_club' end;
        if v_checked_in then
          v_shift_id := (v_presence->>'shiftId')::uuid;
          insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility,selected_at)
            values(v_shift_id,p_dancer_id,p_venue_id,v_visibility,v_enrollment.tapped_at)
            on conflict(shift_id) do nothing;
          update public.dancer_nfc_enrollments set status='completed',completed_at=clock_timestamp(),
            last_attempted_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_enrollment.id;
          -- Reopening the same tap reflects approval without applying another tap.
          update public.dancer_channel_tap_receipts set receipt=receipt||v_presence||jsonb_build_object(
            'enrollmentStatus','completed','clubApprovalStatus','approved','affiliationActivated',true,
            'dancerId',p_dancer_id,'id',v_affiliation.id,'visibility',v_visibility)
            where user_id=v_user_id and tag_id=v_enrollment.nfc_tag_id and session_id=v_session_id;
        end if;
      end if;
    end if;
    insert into public.venue_dancer_affiliation_events(affiliation_id,venue_id,dancer_id,actor_user_id,event_type,event_payload)
      values(v_affiliation.id,p_venue_id,p_dancer_id,p_actor_user_id,'affiliation_approved',
        jsonb_build_object('method','club_profile_review','shiftCheckedIn',v_checked_in,'checkInStatus',v_check_in_status));
  end if;
  return jsonb_build_object('venueId',p_venue_id,'dancerId',p_dancer_id,'status',v_request.status,
    'revision',v_request.revision,'requiresNewTap',p_decision='approved' and not v_checked_in,
    'affiliationActivated',p_decision='approved','shiftCheckedIn',v_checked_in,
    'checkInStatus',v_check_in_status,'shiftId',v_shift_id,
    'workingUntil',case when v_checked_in then v_presence->>'workingUntil' end);
end $$;
revoke all on function public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text) to service_role;


commit;
