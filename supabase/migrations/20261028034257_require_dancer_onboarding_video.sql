begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- New onboarding requires three photos and one prepared profile video.
-- Previously activated profiles retain their existing access.
create or replace function public.dancer_submission_media(p_dancer_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with uploads as (
    select p.id::text key,p.is_primary main from public.dancer_photos p where p.dancer_id=p_dancer_id and p.review_status='approved'
    union all
    select case when r.upload_context like 'profile_main%' then 'main'
      when r.photo_publication_mode='replace' then 'replacement:'||r.replacement_photo_id::text else r.id::text end,
      r.upload_context like 'profile_main%'
    from public.image_moderation_records r join public.dancer_profiles d on d.user_id=r.user_id
    where d.id=p_dancer_id and r.decision='review' and r.temporary_storage_path is not null
      and (r.upload_context like 'profile_main%' or r.upload_context like 'profile_gallery%')
      and (r.photo_publication_mode is distinct from 'replace' or not exists(select 1 from public.dancer_photos p
        where p.id=r.replacement_photo_id and p.review_status='approved'))
  ) select jsonb_build_object('count',count(distinct case when main then 'main' else key end),'hasMain',coalesce(bool_or(main),false),'videoCount',(select count(*) from public.mydancr_tv_videos v
    where v.dancer_id=p_dancer_id and v.distribution_scope='profile_and_feed'
      and (v.status='approved' or (v.status='submitted' and not v.upload_validation_pending
        and v.moderation_details->'fileChecksPassed'='true'::jsonb)))) from uploads
$$;

create or replace function public.enforce_dancer_onboarding_photos()
returns trigger language plpgsql security invoker set search_path='' as $$
declare approved_count integer; submitted jsonb;
begin
  if tg_op='UPDATE' and (old.venue_approved_at is not null or (old.approved_at is not null and old.verification_status='approved')) then return new;end if;
  if new.status not in('pending_review','approved') then return new;end if;
  if new.status='pending_review' then
    submitted:=public.dancer_submission_media(new.id);
    if (submitted->>'count')::integer<3 or not (submitted->>'hasMain')::boolean or coalesce((submitted->>'videoCount')::integer,0)<1 then
      raise exception 'Upload at least 3 photos, including a main photo, and 1 video before continuing.' using errcode='23514';
    end if;
  else
    select count(*) into approved_count from (select id from public.dancer_photos where dancer_id=new.id and review_status='approved' limit 3) approved;
    if approved_count<3 then raise exception 'At least 3 profile photos must be approved before completing setup.' using errcode='23514';end if;
    if not exists(select 1 from public.mydancr_tv_videos where dancer_id=new.id and status='approved' and distribution_scope='profile_and_feed') then
      raise exception 'At least 1 profile video must be approved before completing setup.' using errcode='23514';end if;
  end if;
  return new;
end $$;


create or replace function public.complete_saved_dancer_check_in(p_enrollment_id uuid)
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
      or not exists(select 1 from public.mydancr_tv_videos where dancer_id=d.id and status='approved' and distribution_scope='profile_and_feed')
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
 elsif exists(select 1 from public.shifts where dancer_id=v_dancer.id and nfc_last_tapped_at + interval '12 hours'>clock_timestamp()) then
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
 if v_approval_status <> 'approved' or v_dancer.status<>'approved' or v_dancer.verification_status<>'approved' then
   insert into public.dancer_nfc_enrollments(dancer_user_id,venue_id,nfc_tag_id,status,tapped_at,expires_at,last_attempted_at,audit)
   values(p_dancer_user_id,v_tag.venue_id,v_tag.id,'pending',clock_timestamp(),clock_timestamp()+interval '7 days',clock_timestamp(),
     p_audit||jsonb_build_object('sessionId',p_session_id,'visibility',p_visibility))
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
     'venueId',v_venue.id,'venueName',v_venue.name,'venueSlug',v_venue.slug,'clubApprovalStatus',v_approval_status,
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
$function$;

revoke all on function public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function private.format_dancer_media_rejection() returns trigger
language plpgsql security definer set search_path='' as $$
declare reviewer text; kind text; main_photo boolean; avatar boolean;
begin
 if not exists(select 1 from public.app_users where id=new.recipient_id and role='dancer' and account_state='active') then return new; end if;
 if new.notification_type='tv_video_status' and new.payload->>'status'='rejected' then
  new.payload:=new.payload||jsonb_build_object('kind','dancer_media_rejected','targetType','video',
    'targetId',new.payload->>'videoId','source','video','reviewScope','platform');
 end if;
 if new.payload->>'kind' is distinct from 'dancer_media_rejected' then return new; end if;
 kind:=new.payload->>'targetType';
 main_photo:=coalesce((new.payload->>'isMain')::boolean,false);
 avatar:=coalesce((new.payload->>'isAvatar')::boolean,false);
 reviewer:=case when new.payload->>'reviewScope'='club' then coalesce(new.payload->>'venueName','Your club') else 'MyDancr' end;
 new.title:=case when main_photo then 'Main photo needs replacing' when avatar then 'Avatar needs attention'
   when kind='video' then 'Video not approved' else 'Photo not approved' end;
 new.body:=reviewer||' did not approve '||case when main_photo then 'your main photo.' when avatar then 'your avatar.'
   when kind='video' then 'a video.' else 'a photo.' end||' '||case
   when main_photo or avatar then 'Choose a different main photo; your avatar updates automatically.'
   when kind='video' then 'Replace it if you still need 1 approved profile video.'
   else 'Replace it if you still need 3 approved profile photos.' end;
 if new.payload->>'reviewScope'='club' then new.body:=new.body||' This decision applies only to this club.'; end if;
 new.payload:=new.payload||jsonb_build_object('setupStep',case when kind='video' then 'videos' else 'photos' end,
  'emailPath',case when main_photo or avatar then '/dashboard/dancer#dancer-main-photo'
   when kind='video' then '/dashboard/dancer#dancer-videos-title' else '/dashboard/dancer#dancer-photos-title' end);
 return new;
end $$;

comment on function public.enforce_dancer_onboarding_photos() is 'First submission requires a main photo, three photos and one prepared video. First activation requires three approved photos and one approved video. Existing activated profiles are preserved.';
notify pgrst, 'reload schema';
commit;
