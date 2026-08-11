begin;

create or replace function public.check_in_manager_approved_dancer_from_nfc(
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
  v_dancer public.dancer_profiles;
  v_affiliation public.venue_dancer_affiliations;
  v_shift public.shifts;
  v_shift_checked_in boolean := false;
  v_now timestamptz := clock_timestamp();
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
    and dancer.status = 'approved'
    and dancer.verification_status = 'approved'
    and dancer.is_public = true
    and dancer.disabled_at is null
    and account.role = 'dancer'
    and account.account_state = 'active'
  for update of dancer;

  if not found then
    raise exception using errcode = '42501', message = 'An approved dancer profile is required.';
  end if;

  select affiliation.* into v_affiliation
  from public.venue_dancer_affiliations affiliation
  where affiliation.venue_id = v_venue.id
    and affiliation.dancer_id = v_dancer.id
    and affiliation.status = 'active'
    and affiliation.revoked_at is null
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'A verified venue manager must approve this dancer before NFC check-in.';
  end if;

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

  insert into public.nfc_tap_events (
    nfc_tag_id,
    venue_id,
    tag_type,
    event_type,
    actor_user_id,
    session_id,
    ip_address,
    user_agent,
    device_fingerprint,
    audit
  ) values (
    v_tag.id,
    v_venue.id,
    v_tag.tag_type,
    case when v_shift_checked_in then 'shift_checked_in' else 'opened' end,
    p_dancer_user_id,
    p_session_id,
    p_audit->>'ip_address',
    p_audit->>'user_agent',
    p_audit->>'device_fingerprint',
    coalesce(p_audit, '{}'::jsonb) || jsonb_build_object(
      'dancerId', v_dancer.id,
      'affiliationId', v_affiliation.id,
      'managerApproved', true,
      'shiftId', v_shift.id
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
    'affiliationActivated', false,
    'profileActivated', false,
    'shiftCheckedIn', v_shift_checked_in,
    'shiftId', v_shift.id
  );
end;
$$;

revoke all on function public.check_in_manager_approved_dancer_from_nfc(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.check_in_manager_approved_dancer_from_nfc(uuid, uuid, uuid, jsonb) to service_role;

comment on function public.check_in_manager_approved_dancer_from_nfc(uuid, uuid, uuid, jsonb) is
  'Records dressing-room NFC presence and checks in only an already manager-approved dancer; never creates affiliations or approves profiles.';

notify pgrst, 'reload schema';

commit;
