-- Serialize fresh and deferred enrollment requests for the same dancer.
-- No existing rows, grants, eligibility rules or shift timing are changed.
-- Rollback: restore both inspected definitions together through a forward
-- migration after assessing the original tag/enrollment deadlock risk.
begin;

CREATE OR REPLACE FUNCTION public.register_dancer_nfc_enrollment(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public', 'pg_temp'
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
          and dancer.is_public = true
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
$function$;

CREATE OR REPLACE FUNCTION public.finalize_pending_dancer_nfc_enrollment(p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public', 'pg_temp'
AS $function$
declare
  v_enrollment public.dancer_nfc_enrollments;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  -- Both fresh taps and deferred completion take this lock before any
  -- tag or enrollment row lock, so their opposite row access orders cannot
  -- deadlock each other for the same dancer. Released with the transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mydancr:dancer-nfc-enrollment:' || p_dancer_user_id::text, 0)
  );

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
$function$;

commit;
