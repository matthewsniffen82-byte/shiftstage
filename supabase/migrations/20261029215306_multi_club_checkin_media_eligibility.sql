begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Raw approved inventory remains available to the owner/editor even when a club
-- has too little media to show a public profile.
CREATE OR REPLACE FUNCTION public.club_approved_media(p_venue_id uuid, p_dancer_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with allowed as (
 select x,m.id,m.source,m.photo_id,m.dancer_id,m.kind,m.is_main as source_is_main,r.editor_is_main,r.editor_replaces_photo_id,r.created_at,
 e.is_main,e.is_pinned from jsonb_array_elements(public.club_public_media_before_editor(p_venue_id,p_dancer_ids)) x
 join public.dancer_club_media(p_dancer_ids) m on m.dancer_id=(x->>'dancerId')::uuid
 and (m.photo_id=(x->>'photoId')::uuid or m.id=(x->>'videoId')::uuid or m.record->>'final_storage_path'=x->>'avatarPath')
 left join public.image_moderation_records r on m.source='upload' and r.id=m.id
 left join public.dancer_club_media_edits e on e.dancer_id=m.dancer_id and e.venue_id=p_venue_id and e.kind=m.kind and e.media_id=coalesce(m.photo_id,m.id)
 where private.editor_media_available(m.dancer_id,p_venue_id,m.source,m.id)
 ), visible as (
 select a.* from allowed a where not private.editor_media_removed(a.dancer_id,p_venue_id,a.kind,a.id,a.photo_id)
 and not exists(select 1 from allowed n where n.dancer_id=a.dancer_id and n.editor_replaces_photo_id=a.photo_id)
 ), mains as (
 select distinct on (dancer_id) dancer_id,photo_id from visible where photo_id is not null and (is_main or editor_is_main or source_is_main)
 order by dancer_id,is_main desc nulls last,created_at desc nulls last,id
 ) select coalesce(jsonb_agg(v.x||jsonb_build_object('isMain',coalesce(v.photo_id=m.photo_id,false),'isPinned',v.is_pinned)),'[]')
 from visible v left join mains m on m.dancer_id=v.dancer_id
 where v.kind<>'video' or exists(select 1 from public.mydancr_tv_videos video where video.id=v.id and video.distribution_scope='profile_and_feed' and (video.expires_at is null or video.expires_at>now()))
$function$
;

create function private.club_media_eligibility(p_venue uuid,p_dancers uuid[])
returns table(dancer_id uuid,approved_photos bigint,approved_videos bigint,has_approved_main boolean,eligible boolean,media jsonb)
language sql stable security invoker set search_path='' as $$
 with inventory as materialized (
  select x from jsonb_array_elements(public.club_approved_media(p_venue,p_dancers)) x
 ), counts as (
  select d.id,
   count(distinct x->>'photoId') photos,count(distinct x->>'videoId') videos,
   coalesce(bool_or((x->>'isMain')::boolean) filter(where x->>'photoId' is not null),false) has_main,
   coalesce(jsonb_agg(x) filter(where x is not null),'[]'::jsonb) items
  from (select distinct unnest(p_dancers) id) d left join inventory on x->>'dancerId'=d.id::text group by d.id
 )
 select id,photos,videos,has_main,photos>=3 and videos>=1 and has_main,items from counts
$$;
create function private.club_media_ready(p_venue uuid,p_dancer uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select eligible from private.club_media_eligibility(p_venue,array[p_dancer])),false)
$$;
create or replace function public.club_public_media(p_venue_id uuid,p_dancer_ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb)
 from private.club_media_eligibility(p_venue_id,p_dancer_ids) e
 cross join lateral jsonb_array_elements(e.media) x where e.eligible
$$;
create function public.dancer_club_media_requirements(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('venueId',v.id,'approvedPhotos',e.approved_photos,
  'approvedVideos',e.approved_videos,'hasApprovedMain',e.has_approved_main,'eligible',e.eligible)),'[]'::jsonb)
 from public.dancer_profiles d cross join public.venues v
 cross join lateral private.club_media_eligibility(v.id,array[d.id]) e
 where d.user_id=p_user_id and v.is_active
 and exists(select 1 from public.venue_media_dancers(v.id) linked where linked.user_id=p_user_id)
$$;
revoke all on function public.club_approved_media(uuid,uuid[]),private.club_media_eligibility(uuid,uuid[]),
 private.club_media_ready(uuid,uuid),public.dancer_club_media_requirements(uuid) from public,anon,authenticated;
grant execute on function public.club_approved_media(uuid,uuid[]),private.club_media_eligibility(uuid,uuid[]),
 private.club_media_ready(uuid,uuid),public.dancer_club_media_requirements(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.edit_dancer_club_media(p_actor uuid, p_venue uuid, p_kind text, p_id uuid, p_action text, p_pinned boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare ctx jsonb; d uuid; v uuid; item jsonb; published boolean;
begin
 ctx:=public.dancer_media_editor_context(p_actor,p_venue);d:=(ctx->>'dancerId')::uuid;v:=(ctx->>'venueId')::uuid;
 if v is null then raise exception 'Choose a club before editing media.' using errcode='22023';end if;
 perform 1 from public.dancer_profiles where id=d for update;
 select x into item from jsonb_array_elements(public.dancer_club_media_statuses(p_actor)) x
 where x->>'venueId'=v::text and x->>'kind'=p_kind and (x->>'id'=p_id::text or x->>'photoId'=p_id::text) limit 1;
 if item is null then raise exception 'This media does not belong to this club.' using errcode='42501';end if;
 if p_action not in ('remove','main','pin') or (p_action='main' and p_kind<>'photo') then raise exception 'Invalid media action.' using errcode='22023';end if;
 if p_action<>'remove' and not exists(select 1 from jsonb_array_elements(public.club_approved_media(v,array[d])) x
 where coalesce(x->>'photoId',x->>'videoId')=p_id::text) then raise exception 'Choose approved media for this club.' using errcode='22023';end if;
 if p_action='main' then update public.dancer_club_media_edits set is_main=false where dancer_id=d and venue_id=v and is_main;end if;
 insert into public.dancer_club_media_edits(dancer_id,venue_id,kind,media_id,removed,is_main,is_pinned)
 values(d,v,p_kind,p_id,p_action='remove',p_action='main',case when p_action='pin' then p_pinned end)
 on conflict(dancer_id,venue_id,kind,media_id) do update set removed=case when p_action='remove' then true else dancer_club_media_edits.removed end,
 is_main=case when p_action='main' then true when p_action='remove' then false else dancer_club_media_edits.is_main end,
 is_pinned=case when p_action='pin' then p_pinned else dancer_club_media_edits.is_pinned end,updated_at=now();
 return jsonb_build_object('id',p_id,'venueId',v,'isPinned',p_pinned,'clubOnly',true);
end $function$
;

CREATE OR REPLACE FUNCTION public.dancer_club_media_statuses(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with d as (select id from public.dancer_profiles where user_id=p_user_id),
 base as (select x from jsonb_array_elements(public.dancer_club_media_statuses_before_editor(p_user_id)) x
  where private.editor_media_available((select id from d),(x->>'venueId')::uuid,x->>'source',(x->>'id')::uuid)),
 drafts as (
  select r.id,r.image_id photo_id,'photo' kind,'upload' source,r.editor_venue_id venue_id,r.status from public.image_moderation_records r
  where r.user_id=p_user_id and r.editor_venue_id is not null and r.upload_context like 'profile_%'
  union all select v.id,null,'video','video',v.editor_venue_id,v.status from public.mydancr_tv_videos v
  where v.dancer_id in(select id from d) and v.editor_venue_id is not null and v.status not in ('hidden','removed','expired')
 ), items as (
  select x from base union all
  select jsonb_build_object('id',r.id,'photoId',r.photo_id,'kind',r.kind,'source',r.source,'venueId',v.id,'venueName',v.name,
   'status',case when r.status='rejected' then 'rejected' else 'pending' end)
  from drafts r join public.venues v on v.id=r.venue_id
  where not exists(select 1 from base b where b.x->>'id'=r.id::text and b.x->>'venueId'=v.id::text)
 ), published as materialized (
  select v.venue_id,p from (select distinct (x->>'venueId')::uuid venue_id from items) v,
  lateral jsonb_array_elements(public.club_approved_media(v.venue_id,array[(select id from d)])) p
 ) select coalesce(jsonb_agg(x||jsonb_build_object(
 'hidden',private.editor_media_removed((select id from d),(x->>'venueId')::uuid,x->>'kind',(x->>'id')::uuid,(x->>'photoId')::uuid)
  or exists(select 1 from public.dancer_club_media(array[(select id from d)]) m
   join public.image_moderation_records r on m.source='upload' and r.id=m.id
   join public.club_media_permissions c on c.source=m.source and c.media_id=m.id and c.content_version=m.content_version
   where c.venue_id=(x->>'venueId')::uuid and c.decision='approved' and r.status='approved'
   and r.editor_venue_id=c.venue_id and r.editor_replaces_photo_id=(x->>'photoId')::uuid),
 'isMain',coalesce((p.p->>'isMain')::boolean,false),'isPinned',p.p->'isPinned')), '[]')
 from items left join published p on p.venue_id=(x->>'venueId')::uuid
 and coalesce(p.p->>'photoId',p.p->>'videoId')=coalesce(x->>'photoId',x->>'id')
$function$
;

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
  if not private.club_media_ready(v_venue.id,v_dancer.id) then
    raise exception 'NFC_CLUB_MEDIA_REQUIRED' using errcode='42501';
  end if;
  -- An older saved tap must never reopen a shift after a later club visit.
  if exists(select 1 from public.shifts where dancer_id=v_dancer.id and nfc_last_tapped_at>v_tapped_at) then
    raise exception 'NFC_SAVED_TAP_EXPIRED' using errcode='40001';
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
    and shift.venue_id = v_venue.id
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

CREATE OR REPLACE FUNCTION public.register_dancer_channel_tap(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_visibility text, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_dancer public.dancer_profiles;
 v_tag public.nfc_tags;
 v_previous public.shifts;
 v_saved public.dancer_channel_tap_receipts;
 v_result jsonb;
 v_media jsonb;
 v_venue public.venues;
 v_approval_status text;
 v_enrollment_id uuid;
begin
 if p_tag_id is null or p_dancer_user_id is null or p_session_id is null or p_visibility is null
   or p_visibility not in ('internal','external','both') or jsonb_typeof(p_audit) is distinct from 'object' then
   raise exception 'NFC_VISIBILITY_REQUIRED' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:' || p_dancer_user_id::text,0));
 select * into v_tag from public.nfc_tags where id=p_tag_id and status='active' and tag_type='dressing_room' for update;
 if not found then raise exception 'NFC_TAG_INACTIVE' using errcode='42501'; end if;
 select d.* into v_dancer from public.dancer_profiles d join public.app_users u on u.id=d.user_id
 where d.user_id=p_dancer_user_id and u.role='dancer' and u.account_state='active'
 and d.status in ('pending_review','approved') and d.disabled_at is null for update of d;
 if not found or nullif(trim(v_dancer.stage_name),'') is null or nullif(trim(v_dancer.city),'') is null then
   raise exception 'AGE_PROFILE_SETUP_REQUIRED' using errcode='42501';
 end if;
 -- Submission includes pending uploads. Publication and Working Now still wait
 -- for approved media in complete_saved_dancer_check_in.
 if v_dancer.status<>'approved' or v_dancer.verification_status<>'approved' then
   v_media:=public.dancer_submission_media(v_dancer.id);
   if coalesce((v_media->>'hasMain')::boolean,false) is false or coalesce((v_media->>'count')::integer,0)<3 or coalesce((v_media->>'videoCount')::integer,0)<1 then
     raise exception 'AGE_PROFILE_SETUP_REQUIRED' using errcode='42501';
   end if;
 elsif nullif(trim(v_dancer.avatar_storage_path),'') is null
   or not exists(select 1 from public.dancer_photos where dancer_id=v_dancer.id and review_status='approved') then
   raise exception 'AGE_PROFILE_SETUP_REQUIRED' using errcode='42501';
 end if;
 if not exists(select 1 from public.dancer_age_verifications where user_id=p_dancer_user_id
   and provider='ondato' and status='verified' and verified_at <= clock_timestamp()) then
   raise exception 'AGE_VERIFICATION_REQUIRED_BEFORE_TAP' using errcode='42501';
 end if;
 select * into v_saved from public.dancer_channel_tap_receipts where user_id=p_dancer_user_id and session_id=p_session_id;
 if found then
   if v_saved.tag_id<>p_tag_id or v_saved.visibility<>p_visibility then raise exception 'NFC_REQUEST_REUSED' using errcode='40001'; end if;
   return v_saved.receipt || jsonb_build_object('replayed',true);
 end if;
 select * into v_previous from public.shifts where dancer_id=v_dancer.id and status='posted'
   and checked_in_at is not null and checked_out_at is null and location_status='club_confirmed'
   and location_verification_expires_at>clock_timestamp() order by checked_in_at desc limit 1 for update;
 if found then
   if v_previous.venue_id<>v_tag.venue_id then raise exception 'NFC_ACTIVE_OTHER_CLUB' using errcode='40001'; end if;
 elsif exists(select 1 from public.shifts where dancer_id=v_dancer.id and venue_id=v_tag.venue_id and nfc_last_tapped_at + interval '12 hours'>clock_timestamp()) then
   raise exception 'NFC_COOLDOWN_ACTIVE' using errcode='40001';
 end if;

 -- A new club gets its own membership decision. Pending requests do not change presence or visibility.
 select v.* into v_venue from public.venues v join public.app_users u on u.id=v.owner_user_id
 where v.id=v_tag.venue_id and v.is_active and u.role='venue' and u.account_state='active' for key share of v,u;
 if not found then raise exception 'NFC_TAG_INACTIVE' using errcode='42501'; end if;
 if exists(select 1 from public.venue_dancer_affiliations where venue_id=v_tag.venue_id
   and dancer_id=v_dancer.id and status='revoked' and reentry_blocked) then
   raise exception 'CLUB_REENTRY_BLOCKED' using errcode='42501';
 end if;
 insert into public.club_dancer_approvals(venue_id,dancer_id) values(v_tag.venue_id,v_dancer.id)
 on conflict(venue_id,dancer_id) do nothing;
 select status into v_approval_status from public.club_dancer_approvals
   where venue_id=v_tag.venue_id and dancer_id=v_dancer.id;
 if v_approval_status <> 'approved' or v_dancer.status<>'approved' or v_dancer.verification_status<>'approved'
   or not private.club_media_ready(v_tag.venue_id,v_dancer.id) then
   insert into public.dancer_nfc_enrollments(dancer_user_id,venue_id,nfc_tag_id,status,tapped_at,expires_at,last_attempted_at,audit)
   values(p_dancer_user_id,v_tag.venue_id,v_tag.id,'pending',clock_timestamp(),clock_timestamp()+interval '7 days',clock_timestamp(),
     p_audit||jsonb_build_object('sessionId',p_session_id,'visibility',p_visibility,'checkInStatus',case when v_approval_status='approved' then 'media_pending' else 'club_pending' end))
   on conflict(dancer_user_id,venue_id) do update set nfc_tag_id=excluded.nfc_tag_id,status='pending',
     tapped_at=excluded.tapped_at,expires_at=excluded.expires_at,last_attempted_at=excluded.last_attempted_at,
     completed_at=null,audit=excluded.audit,updated_at=clock_timestamp()
   returning id into v_enrollment_id;
   insert into public.nfc_tap_events(nfc_tag_id,venue_id,tag_type,event_type,actor_user_id,session_id,ip_address,user_agent,device_fingerprint,audit)
   values(v_tag.id,v_tag.venue_id,v_tag.tag_type,'opened',p_dancer_user_id,p_session_id,
     p_audit->>'ip_address',p_audit->>'user_agent',p_audit->>'device_fingerprint',
     p_audit||jsonb_build_object('clubApprovalStatus',v_approval_status));
   update public.nfc_tags set last_tapped_at=clock_timestamp(),tap_count=tap_count+1,updated_at=clock_timestamp() where id=v_tag.id;
   v_result:=jsonb_build_object('enrollmentStatus','pending','enrollmentId',v_enrollment_id,
     'venueId',v_venue.id,'venueName',v_venue.name,'venueSlug',v_venue.slug,'clubApprovalStatus',v_approval_status,'checkInStatus',case when v_approval_status='approved' then 'media_pending' else 'club_pending' end,
     'profileActivated',false,'shiftCheckedIn',false,'affiliationActivated',false,'visibility',p_visibility,'replayed',false);
   insert into public.dancer_channel_tap_receipts(user_id,session_id,tag_id,visibility,receipt)
     values(p_dancer_user_id,p_session_id,p_tag_id,p_visibility,v_result);
   return v_result;
 end if;
 insert into public.dancer_channel_preferences(dancer_id,visibility) values(v_dancer.id,p_visibility)
 on conflict(dancer_id) do update set visibility=excluded.visibility,selected_at=clock_timestamp();
 v_result := public.register_and_activate_dancer_tap(p_tag_id,p_dancer_user_id,p_session_id,
   p_audit || jsonb_build_object('visibility',p_visibility));
 if v_result->>'enrollmentStatus' is distinct from 'completed' then raise exception 'AGE_PROFILE_SETUP_REQUIRED' using errcode='42501'; end if;
 if v_result->>'venueId' is distinct from v_tag.venue_id::text or (v_result->>'shiftCheckedIn')::boolean is distinct from true then
   raise exception 'NFC_PRESENCE_CONFLICT' using errcode='40001';
 end if;
 insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility)
 values((v_result->>'shiftId')::uuid,v_dancer.id,v_tag.venue_id,p_visibility)
 on conflict(shift_id) do update set visibility=excluded.visibility,selected_at=clock_timestamp();
 update public.dancer_profiles set is_public=(p_visibility in ('external','both')) where id=v_dancer.id;
 v_result := v_result || jsonb_build_object('visibility',p_visibility,'replayed',false);
 insert into public.dancer_channel_tap_receipts(user_id,session_id,tag_id,visibility,receipt)
 values(p_dancer_user_id,p_session_id,p_tag_id,p_visibility,v_result);
 return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_saved_dancer_check_in(p_enrollment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  elsif d.status<>'approved' and not exists(select 1 from public.dancer_media_batches b where b.dancer_id=d.id and b.venue_id=e.venue_id and b.state='completed') then v_reason:='media_batch_pending';
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
      or not exists(select 1 from public.mydancr_tv_videos where dancer_id=d.id and status='approved' and distribution_scope='profile_and_feed')
    ) then v_reason:='media_pending';
    elsif not private.club_media_ready(e.venue_id,d.id) then v_reason:='media_pending';
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
          or (venue_id=e.venue_id and nfc_last_tapped_at+interval '12 hours'>clock_timestamp()))) then
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
end $function$
;

-- Complete a resolved batch once, without inventing a second platform approval.
create function private.finish_resolved_club_media_batch(p_batch uuid,p_rejected jsonb,p_admin uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.dancer_media_batches; d public.dancer_profiles; v_result jsonb; eligibility record; club_name text;
begin
 select * into b from public.dancer_media_batches where id=p_batch for update;
 if b.state='completed' then return b.result;end if;
 select * into d from public.dancer_profiles where id=b.dancer_id for update;
 update public.dancer_media_batches set state='completed',revision=gen_random_uuid(),
  admin_submitted_by=p_admin,completed_at=now() where id=b.id;
 if private.club_media_ready(b.venue_id,b.dancer_id) then
  perform public.finalize_pending_dancer_nfc_enrollment(d.user_id,null,'{}');
 end if;
 v_result:=private.dancer_media_review_outcome(d.user_id,p_rejected);
 select * into eligibility from private.club_media_eligibility(b.venue_id,array[b.dancer_id]);
 select name into club_name from public.venues where id=b.venue_id;
 v_result:=v_result||jsonb_build_object('batchId',b.id,'venueId',b.venue_id,'venueName',club_name,
  'approvedPhotos',eligibility.approved_photos,'approvedVideos',eligibility.approved_videos,
  'hasApprovedMain',eligibility.has_approved_main,'clubEligible',eligibility.eligible);
 if not eligibility.eligible then
  v_result:=v_result||jsonb_build_object('outcome',case when not eligibility.has_approved_main then 'needs_main' else 'needs_media' end,
   'title','Media needed for '||club_name,
   'body','To appear at '||club_name||', you need 3 approved photos, including a main photo, and 1 approved video. '
    ||'Currently approved here: '||eligibility.approved_photos||' photos and '||eligibility.approved_videos||' videos. '
    ||'Open this club in your dashboard to add or replace the missing media.',
   'action','Review club media','emailPath',case when eligibility.approved_photos<3 or not eligibility.has_approved_main
    then '/dashboard/dancer#dancer-photos-title' else '/dashboard/dancer#dancer-videos-title' end);
 end if;
 update public.dancer_media_batches set result=v_result where id=b.id;
 insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload)
 values(d.user_id,v_result->>'title',v_result->>'body',v_result||jsonb_build_object('kind','dancer_media_batch_result','dancerId',d.id,'items',p_rejected));
 return v_result;
end $$;
revoke all on function private.finish_resolved_club_media_batch(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.finish_resolved_club_media_batch(uuid,jsonb,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.submit_club_media_batch(p_actor uuid, p_batch uuid, p_revision uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.dancer_media_batches; x jsonb; m record; decision jsonb; permission text; needs_admin boolean:=false; rejected jsonb:='[]'; v_result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||(select dp.user_id::text from public.dancer_profiles dp join public.dancer_media_batches mb on mb.dancer_id=dp.id where mb.id=p_batch),0));
 perform 1 from public.dancer_profiles where id=(select dancer_id from public.dancer_media_batches where id=p_batch) for update;
 select * into b from public.dancer_media_batches where id=p_batch for update;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,'venue',b.venue_id,b.dancer_id);
 if b.state<>'club' then return jsonb_build_object('id',b.id,'state',b.state);end if;
 if b.revision<>p_revision then raise exception 'This batch changed. Refresh before submitting.' using errcode='40001';end if;
 perform set_config('mydancr.media_batch',b.id::text,true);
 for x in select value from jsonb_array_elements(b.items) loop
  select * into m from public.dancer_club_media(array[b.dancer_id]) where id=(x->>'id')::uuid and source=x->>'source' and content_version=x->>'version';
  if not found then continue;end if;
  if private.editor_media_removed(b.dancer_id,b.venue_id,m.kind,m.id,m.photo_id) then continue;end if;
  decision:=b.club_decisions->(x->>'key');
  if decision->>'decision' is null then raise exception 'Review every item before submitting.' using errcode='22023';end if;
  select revision::text into permission from public.club_media_permissions where venue_id=b.venue_id and source=m.source and media_id=m.id;
  if decision->>'decision'='approved' and m.record->>'status' is distinct from 'approved' then needs_admin:=true;end if;
  if decision->>'decision'='rejected' then rejected:=rejected||jsonb_build_array(jsonb_build_object(
    'targetType',m.kind,'targetId',m.id,'isMain',m.is_main,'reviewScope','club'));end if;
  perform public.set_club_media_permission(p_actor,b.venue_id,b.dancer_id,m.source,m.id,m.content_version,permission,decision->>'decision',decision->>'notes');
 end loop;
 update public.dancer_media_batches set club_submitted_by=p_actor,club_submitted_at=now() where id=b.id;
 if not needs_admin then
  v_result:=private.finish_resolved_club_media_batch(b.id,rejected);
  return jsonb_build_object('id',b.id,'state','completed','result',v_result);
 end if;
 update public.dancer_media_batches set state='admin',revision=gen_random_uuid() where id=b.id;
 perform private.media_batch_admin_email(b.id,(select stage_name from public.dancer_profiles where id=b.dancer_id));
 return jsonb_build_object('id',b.id,'state','admin');
end $function$
;

CREATE OR REPLACE FUNCTION public.submit_admin_media_batch(p_actor uuid, p_batch uuid, p_revision uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.dancer_media_batches; d public.dancer_profiles; x jsonb; m record; r public.image_moderation_records;
 choice jsonb; rejected jsonb:='[]'; v_result jsonb; ready boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||(select dp.user_id::text from public.dancer_profiles dp join public.dancer_media_batches mb on mb.dancer_id=dp.id where mb.id=p_batch),0));
 select * into d from public.dancer_profiles where id=(select dancer_id from public.dancer_media_batches where id=p_batch) for update;
 select * into b from public.dancer_media_batches where id=p_batch for update;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,'admin',b.venue_id,b.dancer_id);
 if b.state='completed' then return jsonb_build_object('id',b.id,'state',b.state,'result',b.result);end if;
 if b.state<>'admin' or b.revision<>p_revision then raise exception 'This batch changed. Refresh before submitting.' using errcode='40001';end if;
 if d.disabled_at is not null or d.status not in ('pending_review','approved') or not exists(select 1 from public.app_users where id=d.user_id and account_state='active') then
  raise exception 'This dancer account is not eligible for publication.' using errcode='42501';end if;
 perform set_config('mydancr.media_batch',b.id::text,true);
 for x in select value from jsonb_array_elements(b.items) order by value->>'isMain' desc,value->>'key' loop
  if x->>'source'='upload' then perform 1 from public.image_moderation_records where id=(x->>'id')::uuid for update;
  elsif x->>'source'='video' then perform 1 from public.mydancr_tv_videos where id=(x->>'id')::uuid for update;end if;
  select * into m from public.dancer_club_media(array[b.dancer_id]) where id=(x->>'id')::uuid and source=x->>'source' and content_version=x->>'version';
  if not found then continue;end if;
  if private.editor_media_removed(b.dancer_id,b.venue_id,m.kind,m.id,m.photo_id) then continue;end if;
  if b.club_decisions->(x->>'key')->>'decision'='rejected' then
   rejected:=rejected||jsonb_build_array(jsonb_build_object('targetType',m.kind,'targetId',m.id,'isMain',m.is_main,'reviewScope','club'));continue;
  end if;
  if m.record->>'status'='approved' then continue;end if;
  choice:=b.admin_decisions->(x->>'key');
  if choice->>'decision' is null then raise exception 'Review every item before submitting.' using errcode='22023';end if;
  if choice->>'decision'='rejected' then
   rejected:=rejected||jsonb_build_array(jsonb_build_object('targetType',m.kind,'targetId',m.id,'isMain',m.is_main,'reviewScope','platform'));
   if m.source='upload' then
    update public.image_moderation_records set decision='rejected',status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_decision='rejected',review_notes=nullif(choice->>'notes',''),updated_at=clock_timestamp() where id=m.id;
   else update public.mydancr_tv_videos set status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_notes=nullif(choice->>'notes',''),published_at=null,expires_at=null,venue_featured=false where id=m.id;end if;
  elsif m.source='upload' then
   select * into r from public.image_moderation_records where id=m.id for update;
   if r.category_flags->>'publication_prepared' is distinct from 'true' or r.final_storage_path is null then
    raise exception 'Finish preparing this photo before submitting.' using errcode='22023';end if;
   if r.upload_context='profile_avatar' then
    perform public.publish_approved_dancer_avatar(r.id,r.updated_at,r.final_storage_path,r.reason_codes,r.category_flags,r.category_scores,r.provider_flagged,p_actor,choice->>'notes',d.avatar_storage_path,d.avatar_updated_at);
   else
    perform public.publish_approved_dancer_gallery_photo(r.id,r.updated_at,r.final_storage_path,r.reason_codes,r.category_flags,r.category_scores,r.provider_flagged,null,p_actor,choice->>'notes');
   end if;
  elsif m.source='video' then
   if (m.record->>'duration_seconds')::numeric>30 or m.record->'moderation_details'->'preparedPublication'->>'storagePath' is distinct from m.record->>'storage_path' then
    raise exception 'Finish preparing this video before submitting.' using errcode='22023';end if;
   update public.mydancr_tv_videos set status='approved',reviewed_by=p_actor,reviewed_at=now(),review_notes=nullif(choice->>'notes',''),published_at=now(),expires_at=now()+interval '90 days' where id=m.id;
  end if;
 end loop;
 v_result:=private.finish_resolved_club_media_batch(b.id,rejected,p_actor);
 return jsonb_build_object('id',b.id,'state','completed','result',v_result);
end $function$
;
revoke all on function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb),
 public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb),public.complete_saved_dancer_check_in(uuid),
 public.submit_club_media_batch(uuid,uuid,uuid),public.submit_admin_media_batch(uuid,uuid,uuid),
 public.club_public_media(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb),
 public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb),public.complete_saved_dancer_check_in(uuid),
 public.submit_club_media_batch(uuid,uuid,uuid),public.submit_admin_media_batch(uuid,uuid,uuid),
 public.club_public_media(uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
