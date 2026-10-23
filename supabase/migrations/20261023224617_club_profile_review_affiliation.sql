begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Membership can publish after review of the original tap. Presence still needs
-- a fresh NFC check-in, and a revoked affiliation still needs a post-removal tap.
create or replace function public.guard_club_dancer_approval() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status <> 'active' then return new; end if;
  if exists(select 1 from public.venue_dancer_affiliations
    where venue_id=new.venue_id and dancer_id=new.dancer_id and status='active' and revoked_at is null) then return new; end if;
  if not exists(select 1 from public.club_dancer_approvals a join public.dancer_profiles d on d.id=a.dancer_id
    where a.venue_id=new.venue_id and a.dancer_id=new.dancer_id and a.status='approved'
      and (a.grandfathered or exists(select 1 from public.dancer_nfc_enrollments e
        where e.venue_id=a.venue_id and e.dancer_user_id=d.user_id and e.status in ('pending','completed')
          and e.expires_at>clock_timestamp()
          and not exists(select 1 from public.venue_dancer_affiliations prior
            where prior.venue_id=a.venue_id and prior.dancer_id=a.dancer_id
              and prior.status='revoked' and prior.revoked_at>=e.tapped_at))))
  then raise exception 'CLUB_APPROVAL_AND_NEW_TAP_REQUIRED' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function public.guard_club_dancer_approval() from public,anon,authenticated;

create or replace function public.review_club_dancer_approval(p_actor_user_id uuid,p_venue_id uuid,p_dancer_id uuid,p_revision uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_user_id uuid; v_request public.club_dancer_approvals; v_enrollment public.dancer_nfc_enrollments;
  v_affiliation public.venue_dancer_affiliations; v_visibility text; v_pending integer; v_photos integer;
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
    insert into public.venue_dancer_affiliation_events(affiliation_id,venue_id,dancer_id,actor_user_id,event_type,event_payload)
      values(v_affiliation.id,p_venue_id,p_dancer_id,p_actor_user_id,'affiliation_approved',
        jsonb_build_object('method','club_profile_review','shiftCheckedIn',false));
  end if;
  return jsonb_build_object('venueId',p_venue_id,'dancerId',p_dancer_id,'status',v_request.status,
    'revision',v_request.revision,'requiresNewTap',p_decision='approved',
    'affiliationActivated',p_decision='approved','shiftCheckedIn',false);
end $$;
revoke all on function public.review_club_dancer_approval(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_club_dancer_approval(uuid,uuid,uuid,uuid,text) to service_role;

-- A club affiliation can be shown without implying a live shift. Return only
-- clubs with a publishable photo; pending replacement uploads leave approved
-- photos and the dancer's existing public profile available.
create function public.public_dancer_club_affiliations(p_dancer_ids uuid[])
returns table(dancer_id uuid,venue_id uuid,venue_name text,venue_slug text)
language sql stable security invoker set search_path='' as $$
  with approved_photos as materialized (
    select distinct m.dancer_id,p.venue_id from public.dancer_club_media(
      case when cardinality(p_dancer_ids)<=1000 then p_dancer_ids else array[]::uuid[] end) m
    join public.club_media_permissions p on p.dancer_id=m.dancer_id and p.source=m.source and p.media_id=m.id
      and p.content_version=m.content_version and p.decision='approved'
    where m.photo_id is not null and m.record->>'status'='approved')
  select distinct on (a.dancer_id) a.dancer_id,v.id,v.name,v.slug
  from public.venue_dancer_affiliations a join public.venues v on v.id=a.venue_id
  join approved_photos photo on photo.dancer_id=a.dancer_id and photo.venue_id=a.venue_id
  join public.dancer_profiles d on d.id=a.dancer_id
  where a.dancer_id=any(p_dancer_ids) and cardinality(p_dancer_ids)<=1000
    and a.status='active' and a.revoked_at is null and v.is_active and public.has_active_club_deal(v)
    and d.status='approved' and d.verification_status='approved' and d.is_public and d.disabled_at is null
  order by a.dancer_id,a.approved_at desc,a.id
$$;
revoke all on function public.public_dancer_club_affiliations(uuid[]) from public,anon,authenticated;
grant execute on function public.public_dancer_club_affiliations(uuid[]) to service_role;

create or replace function public.get_public_directory_candidates(p_city text,p_after uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  with dancers as materialized(select id,city from public.dancer_profiles
    where status='approved' and verification_status='approved' and is_public=true and disabled_at is null
      and (p_city='' or lower(city)=lower(p_city)) and (p_after is null or id>p_after)
    order by id limit 1000),
  affiliations as materialized(select * from public.public_dancer_club_affiliations(array(select id from dancers)))
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'city',d.city,
    'venueId',coalesce(live.venue_id,a.venue_id),'availableUntil',live.expires) order by d.id),'[]'::jsonb)
  from dancers d left join affiliations a on a.dancer_id=d.id
  left join lateral(select s.venue_id,s.location_verification_expires_at expires
    from public.shifts s join public.venues v on v.id=s.venue_id
    where s.dancer_id=d.id and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
      and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
      and isfinite(s.location_verification_expires_at) and v.is_active and public.has_active_club_deal(v)
    order by s.starts_at,s.id limit 1) live on true;
$$;
revoke all on function public.get_public_directory_candidates(text,uuid) from public,anon,authenticated;
grant execute on function public.get_public_directory_candidates(text,uuid) to service_role;
create or replace function public.guard_dancer_media_decision()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_owner uuid; v_ready boolean; v_publishing boolean; v_source_changed boolean;
begin
  if tg_table_name='image_moderation_records' then
    if new.upload_context not like 'profile_%' then return new;end if;
    if tg_op='INSERT' then
      if new.decision='approved' or new.club_reviewed_at is not null or new.club_reviewed_by is not null then
        raise exception 'MEDIA_HUMAN_REVIEW_REQUIRED' using errcode='42501';end if;
      return new;
    end if;
    v_owner:=new.user_id;
    v_ready:=old.decision='review' and old.status='pending_review'
      and old.category_flags->'file_checks_passed'='true'::jsonb;
    v_publishing:=new.decision='approved' and old.decision is distinct from 'approved';
    v_source_changed:=new.user_id is distinct from old.user_id or new.temporary_storage_path is distinct from old.temporary_storage_path
      or (new.upload_context is distinct from old.upload_context and not v_publishing)
      or new.replacement_photo_id is distinct from old.replacement_photo_id;
  else
    if tg_op='INSERT' then
      if new.status='approved' or new.club_reviewed_at is not null or new.club_reviewed_by is not null then
        raise exception 'MEDIA_HUMAN_REVIEW_REQUIRED' using errcode='42501';end if;
      return new;
    end if;
    v_owner:=new.submitted_by;
    v_ready:=old.status='submitted' and not old.upload_validation_pending
      and old.moderation_details->'fileChecksPassed'='true'::jsonb;
    v_publishing:=new.status='approved' and old.status is distinct from 'approved';
    v_source_changed:=new.submitted_by is distinct from old.submitted_by or new.storage_path is distinct from old.storage_path
      or new.storage_mime is distinct from old.storage_mime or new.caption is distinct from old.caption
      or new.width is distinct from old.width or new.height is distinct from old.height
      or new.duration_seconds is distinct from old.duration_seconds;
  end if;
  -- Editing published video content invalidates platform approval too.
  if tg_table_name='mydancr_tv_videos' and v_source_changed and old.status='approved' then
    new.status:='submitted';new.reviewed_by:=null;new.reviewed_at:=null;
    new.published_at:=null;new.expires_at:=null;new.moderation_decision:=null;
    if (new.storage_path,new.storage_mime,new.width,new.height,new.duration_seconds,new.submitted_by)
      is distinct from (old.storage_path,old.storage_mime,old.width,old.height,old.duration_seconds,old.submitted_by) then
      new.upload_validation_pending:=true;
      new.moderation_details:=coalesce(new.moderation_details,'{}'::jsonb)||'{"fileChecksPassed":false}'::jsonb;
    end if;
  end if;
  if v_source_changed and old.club_reviewed_at is not null then
    if v_publishing then raise exception 'MEDIA_REVIEW_CHANGED' using errcode='40001';end if;
    new.club_reviewed_by:=null;new.club_reviewed_at:=null;new.club_review_venue_id:=null;new.club_review_notes:=null;
  elsif (new.club_reviewed_by,new.club_reviewed_at,new.club_review_venue_id,new.club_review_notes)
    is distinct from (old.club_reviewed_by,old.club_reviewed_at,old.club_review_venue_id,old.club_review_notes) then
    if current_user not in ('service_role','postgres') or v_ready is not true or old.club_reviewed_at is not null
      or new.club_reviewed_by is null or new.club_reviewed_at is null or new.club_review_venue_id is null then
      raise exception 'MEDIA_REVIEW_CHANGED' using errcode='40001';end if;
    perform public.assert_dancer_media_reviewer(new.club_reviewed_by,v_owner,new.club_review_venue_id);
  end if;
  if v_publishing then
    if v_ready is not true or old.club_reviewed_at is null or old.club_reviewed_by is null or old.club_review_venue_id is null
      or v_source_changed then raise exception 'MEDIA_HUMAN_REVIEW_REQUIRED' using errcode='40001';end if;
    perform 1 from public.app_users where id=new.reviewed_by and role='admin' and account_state='active' for share;
    if not found then raise exception 'MEDIA_FINAL_REVIEW_FORBIDDEN' using errcode='42501';end if;
    -- Final reviewer and club reviewer remain separately recorded.
    if new.reviewed_at is null then raise exception 'MEDIA_HUMAN_REVIEW_REQUIRED' using errcode='40001';end if;
  elsif new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by then
    perform public.assert_dancer_media_reviewer(new.reviewed_by,v_owner);
    if old.club_reviewed_at is not null and not exists(select 1 from public.app_users where id=new.reviewed_by and role='admin' and account_state='active') then
      raise exception 'MEDIA_FINAL_REVIEW_FORBIDDEN' using errcode='42501';end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_dancer_media_decision() from public,anon,authenticated;
commit;
