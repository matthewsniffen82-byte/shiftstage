begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Shared completion for club review, final media approval and dashboard refresh.
-- Only trusted server callers can supply an enrollment; all eligibility is read
-- again under the same dancer lock as a fresh NFC tap.
create function public.complete_saved_dancer_check_in(p_enrollment_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  e public.dancer_nfc_enrollments;
  d public.dancer_profiles;
  a public.venue_dancer_affiliations;
  v_user_id uuid;
  v_session_id uuid;
  v_visibility text;
  v_result jsonb;
  v_presence jsonb;
  v_reason text;
  v_activated boolean := false;
  v_checked_in boolean := false;
begin
  select dancer_user_id into v_user_id from public.dancer_nfc_enrollments where id=p_enrollment_id;
  if not found then return jsonb_build_object('enrollmentStatus','none','shiftCheckedIn',false); end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||v_user_id::text,0));
  select * into e from public.dancer_nfc_enrollments where id=p_enrollment_id for update;
  if e.status<>'pending' then
    return jsonb_build_object('enrollmentStatus',e.status,'shiftCheckedIn',false);
  end if;
  select p.* into d from public.dancer_profiles p join public.app_users u on u.id=p.user_id
    where p.user_id=e.dancer_user_id and u.role='dancer' and u.account_state='active'
      and p.status in ('pending_review','approved') and p.disabled_at is null for update of p;
  if not found then v_reason:='profile_pending';
  elsif not exists(select 1 from public.nfc_tags t join public.venues v on v.id=t.venue_id
    join public.app_users owner on owner.id=v.owner_user_id
    where t.id=e.nfc_tag_id and t.venue_id=e.venue_id and t.status='active' and t.tag_type='dressing_room'
      and v.is_active and owner.role='venue' and owner.account_state='active') then v_reason:='tag_inactive';
  elsif not exists(select 1 from public.club_dancer_approvals c
    where c.venue_id=e.venue_id and c.dancer_id=d.id and c.status='approved') then v_reason:='club_pending';
  elsif not exists(select 1 from public.dancer_age_verifications age_check
    where age_check.user_id=v_user_id and age_check.provider='ondato' and age_check.status='verified'
      and age_check.verified_at<=e.tapped_at) then v_reason:='age_pending';
  elsif not exists(select 1 from public.dancer_agreement_acceptances receipt
    join public.dancer_agreement_versions version on version.version=receipt.version and version.is_current
    where receipt.user_id=v_user_id) then v_reason:='agreement_pending';
  end if;
  if v_reason is null then
    select * into a from public.venue_dancer_affiliations
      where venue_id=e.venue_id and dancer_id=d.id and status='active' and revoked_at is null for update;
    if not found then v_reason:='access_removed';
    elsif nullif(trim(d.stage_name),'') is null or nullif(trim(d.city),'') is null then v_reason:='profile_pending';
    elsif not (d.status='approved' and d.verification_status='approved') and (
      nullif(d.avatar_storage_path,'') is null or
      (select count(*) from public.dancer_photos where dancer_id=d.id and review_status='approved')<3
    ) then v_reason:='media_pending';
    elsif not exists(select 1 from public.dancer_club_media(array[d.id]) m
      join public.club_media_permissions permission on permission.venue_id=e.venue_id and permission.dancer_id=d.id
        and permission.source=m.source and permission.media_id=m.id and permission.content_version=m.content_version
        and permission.decision='approved'
      where m.photo_id is not null and m.record->>'status'='approved') then v_reason:='media_pending';
    end if;
  end if;
  if v_reason is null then
    v_visibility:=e.audit->>'visibility';
    if v_visibility is null or v_visibility not in ('internal','external','both') then
      v_reason:='visibility_required';
    elsif e.expires_at<=clock_timestamp() or e.tapped_at>clock_timestamp() then
      v_reason:='tap_expired';
    else
      -- A review may activate a new profile, but must not fabricate another tap.
      v_activated:=d.venue_approved_at is null;
      update public.dancer_profiles set status='approved',verification_status='approved',
        approved_at=coalesce(approved_at,clock_timestamp()),venue_approved_at=coalesce(venue_approved_at,clock_timestamp()),
        venue_approved_by_user_id=coalesce(venue_approved_by_user_id,a.approved_by_user_id),
        venue_approved_venue_id=coalesce(venue_approved_venue_id,e.venue_id)
        where id=d.id;
      perform pg_advisory_xact_lock(hashtext(d.id::text),781236);
      if not exists(select 1 from public.dancer_channel_preferences where dancer_id=d.id and selected_at>e.tapped_at)
        and not exists(select 1 from public.shifts where dancer_id=d.id and (
          (status='posted' and checked_out_at is null and location_verification_expires_at>clock_timestamp())
          or nfc_last_tapped_at+interval '12 hours'>clock_timestamp())) then
        insert into public.dancer_channel_preferences(dancer_id,visibility,selected_at) values(d.id,v_visibility,e.tapped_at)
          on conflict(dancer_id) do update set visibility=excluded.visibility,selected_at=excluded.selected_at;
        update public.dancer_profiles set is_public=v_visibility in ('external','both') where id=d.id;
      end if;
      if e.tapped_at+interval '6 hours'<=clock_timestamp() then v_reason:='tap_expired';
      else
        -- The existing shift function verifies this stored session and timestamp,
        -- and preserves active shifts and cooldowns across every club.
        v_session_id:=(e.audit->>'sessionId')::uuid;
        if v_session_id is null then v_reason:='tap_expired';
        else
          begin
            v_presence:=public.activate_dancer_shift_from_nfc(e.nfc_tag_id,v_user_id,v_session_id,
              e.audit||jsonb_build_object('clubProfileReview',true));
          exception when sqlstate '40001' then
            if sqlerrm<>'NFC_SAVED_TAP_EXPIRED' then raise; end if;
            v_reason:='tap_expired';
          end;
          v_checked_in:=coalesce((v_presence->>'shiftCheckedIn')::boolean,false)
            and v_presence->>'venueId'=e.venue_id::text;
          v_reason:=case when v_reason='tap_expired' then v_reason when v_checked_in then 'checked_in' when (v_presence->>'cooldownActive')::boolean
            then 'cooldown' else 'active_other_club' end;
          if v_checked_in then
            insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility,selected_at)
              values((v_presence->>'shiftId')::uuid,d.id,e.venue_id,v_visibility,e.tapped_at)
              on conflict(shift_id) do nothing;
          end if;
        end if;
      end if;
    end if;
  end if;
  v_result:=jsonb_build_object('enrollmentStatus',case when v_checked_in then 'completed' else 'pending' end,
    'enrollmentId',e.id,'id',a.id,'dancerId',d.id,'dancerUserId',v_user_id,'stageName',d.stage_name,
    'venueId',e.venue_id,'profileActivated',v_activated,'affiliationActivated',false,'shiftCheckedIn',v_checked_in,
    'checkInStatus',v_reason,'requiresNewTap',v_reason in ('tap_expired','tag_inactive','access_removed','visibility_required'),
    'visibility',v_visibility,'shiftId',case when v_checked_in then v_presence->>'shiftId' end,
    'workingUntil',case when v_checked_in then v_presence->>'workingUntil' end);
  update public.dancer_nfc_enrollments set status=case when v_checked_in then 'completed' else status end,
    completed_at=case when v_checked_in then clock_timestamp() else completed_at end,
    last_attempted_at=clock_timestamp(),updated_at=clock_timestamp(),
    audit=audit||jsonb_build_object('checkInStatus',v_reason) where id=e.id;
  if v_checked_in then
    update public.dancer_channel_tap_receipts set receipt=receipt||v_presence||v_result||jsonb_build_object(
      'status','active','approvedAt',a.approved_at,'clubApprovalStatus','approved')
      where user_id=v_user_id and tag_id=e.nfc_tag_id and session_id=v_session_id;
  end if;
  return v_result;
end $$;
revoke all on function public.complete_saved_dancer_check_in(uuid) from public,anon,authenticated;
grant execute on function public.complete_saved_dancer_check_in(uuid) to service_role;

create or replace function public.finalize_pending_dancer_nfc_enrollment(p_dancer_user_id uuid,p_session_id uuid,p_audit jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e record; result jsonb := jsonb_build_object('enrollmentStatus','none','shiftCheckedIn',false); next_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||p_dancer_user_id::text,0));
  -- One unapproved club must not block completion at another approved club.
  for e in select id from public.dancer_nfc_enrollments where dancer_user_id=p_dancer_user_id
    and status='pending' order by tapped_at desc,id
  loop
    next_result:=public.complete_saved_dancer_check_in(e.id);
    if (next_result->>'shiftCheckedIn')::boolean then return next_result; end if;
    if result->>'enrollmentStatus'='none' then result:=next_result; end if;
  end loop;
  return result;
end $$;
revoke all on function public.finalize_pending_dancer_nfc_enrollment(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_pending_dancer_nfc_enrollment(uuid,uuid,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.review_club_dancer_approval_and_check_in(p_actor_user_id uuid, p_venue_id uuid, p_dancer_id uuid, p_revision uuid, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_presence:=public.complete_saved_dancer_check_in(v_enrollment.id);
    v_checked_in:=coalesce((v_presence->>'shiftCheckedIn')::boolean,false);
    v_check_in_status:=v_presence->>'checkInStatus';
    v_shift_id:=(v_presence->>'shiftId')::uuid;
    insert into public.venue_dancer_affiliation_events(affiliation_id,venue_id,dancer_id,actor_user_id,event_type,event_payload)
      values(v_affiliation.id,p_venue_id,p_dancer_id,p_actor_user_id,'affiliation_approved',
        jsonb_build_object('method','club_profile_review','shiftCheckedIn',v_checked_in,'checkInStatus',v_check_in_status));
  end if;
  return jsonb_build_object('venueId',p_venue_id,'dancerId',p_dancer_id,'status',v_request.status,
    'revision',v_request.revision,'requiresNewTap',p_decision='approved' and coalesce((v_presence->>'requiresNewTap')::boolean,false),
    'affiliationActivated',p_decision='approved','shiftCheckedIn',v_checked_in,
    'checkInStatus',v_check_in_status,'shiftId',v_shift_id,
    'workingUntil',case when v_checked_in then v_presence->>'workingUntil' end);
end $function$
;
revoke all on function public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
