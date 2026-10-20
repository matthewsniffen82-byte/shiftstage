-- Pending media belongs to the club connected by a verified affiliation or NFC tap.
begin;

create or replace function public.venue_media_dancers(p_venue_id uuid)
returns table(user_id uuid) language sql stable security invoker set search_path = '' as $$
  select d.user_id from public.venue_dancer_affiliations a
    join public.dancer_profiles d on d.id=a.dancer_id
    where a.venue_id=p_venue_id and a.status='active' and a.revoked_at is null
  union
  select e.dancer_user_id from public.dancer_nfc_enrollments e
    join public.nfc_tags t on t.id=e.nfc_tag_id and t.status='active'
    where e.venue_id=p_venue_id and e.status='pending' and e.expires_at>now()
$$;

-- Called again inside the final publication transaction, including rejection.
create or replace function public.assert_dancer_media_reviewer(p_actor_id uuid, p_dancer_user_id uuid, p_venue_id uuid default null)
returns void language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_role text; v_venue public.venues%rowtype;
begin
  select role::text into v_role from public.app_users where id=p_actor_id and account_state='active' for share;
  if not found then raise exception 'MEDIA_REVIEW_FORBIDDEN' using errcode='42501'; end if;
  if v_role='admin' and p_venue_id is null then return; end if;
  if v_role<>'venue' then raise exception 'MEDIA_REVIEW_FORBIDDEN' using errcode='42501'; end if;
  for v_venue in select v.* from public.venues v where (p_venue_id is null or v.id=p_venue_id)
    and (v.owner_user_id=p_actor_id or exists(select 1 from public.venue_team_members m
      where m.venue_id=v.id and m.user_id=p_actor_id and m.role='manager' and m.status='active'))
    order by v.id for share of v
  loop
    perform 1 from public.app_users where id=v_venue.owner_user_id and account_state='active' for share;
    if not found then continue; end if;
    if v_venue.owner_user_id<>p_actor_id then
      perform 1 from public.venue_team_members where venue_id=v_venue.id and user_id=p_actor_id
        and role='manager' and status='active' for share;
      if not found then continue; end if;
    end if;
    -- A null dancer authorizes only reading this club's queue.
    if p_dancer_user_id is null then return; end if;
    perform 1 from public.venue_dancer_affiliations a join public.dancer_profiles d on d.id=a.dancer_id
      where a.venue_id=v_venue.id and d.user_id=p_dancer_user_id and a.status='active' and a.revoked_at is null for share of a;
    if found then return; end if;
    perform 1 from public.dancer_nfc_enrollments e join public.nfc_tags t on t.id=e.nfc_tag_id
      where e.venue_id=v_venue.id and e.dancer_user_id=p_dancer_user_id and e.status='pending'
        and e.expires_at>clock_timestamp() and t.status='active' for share of e,t;
    if found then return; end if;
  end loop;
  raise exception 'MEDIA_REVIEW_FORBIDDEN' using errcode='42501';
end $$;

create or replace function public.get_venue_dancer_media_review(p_actor_id uuid,p_venue_id uuid,p_offset integer default 0,p_limit integer default 12)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_dancer_media_reviewer(p_actor_id,null,p_venue_id);
  with dancers as materialized (select d.id,d.user_id,d.stage_name from public.dancer_profiles d
    join public.venue_media_dancers(p_venue_id) s on s.user_id=d.user_id),
  pending as (
    select r.id,r.created_at,'photo'::text kind,d.stage_name,to_jsonb(r) record from public.image_moderation_records r
      join dancers d on d.user_id=r.user_id where r.decision='review' and r.upload_context like 'profile_%'
        and r.temporary_storage_path is not null
    union all
    select v.id,v.created_at,'video',d.stage_name,to_jsonb(v) from public.mydancr_tv_videos v
      join dancers d on d.id=v.dancer_id where v.status in ('submitted','moderating')
  ), page as (select * from pending order by created_at,id limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset))
  select jsonb_build_object('count',(select count(*) from pending),'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'kind',kind,'stageName',stage_name,'record',record) order by created_at,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;

-- Count unique uploads, not duplicate replacement attempts. Approval remains mandatory for activation.
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
  ) select jsonb_build_object('count',count(distinct case when main then 'main' else key end),'hasMain',coalesce(bool_or(main),false)) from uploads
$$;

create or replace function public.enforce_dancer_onboarding_photos()
returns trigger language plpgsql security invoker set search_path='' as $$
declare approved_count integer; submitted jsonb;
begin
  if tg_op='UPDATE' and (old.venue_approved_at is not null or (old.approved_at is not null and old.verification_status='approved')) then return new;end if;
  if new.status not in('pending_review','approved') then return new;end if;
  if new.status='pending_review' then
    submitted:=public.dancer_submission_media(new.id);
    if (submitted->>'count')::integer<3 or not (submitted->>'hasMain')::boolean then
      raise exception 'Upload a main photo and at least 3 profile photos before continuing.' using errcode='23514';
    end if;
  else
    select count(*) into approved_count from (select id from public.dancer_photos where dancer_id=new.id and review_status='approved' limit 3) approved;
    if approved_count<3 then raise exception 'At least 3 profile photos must be approved before completing setup.' using errcode='23514';end if;
  end if;
  return new;
end $$;

create or replace function public.guard_dancer_media_decision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='image_moderation_records' then
    if new.upload_context not like 'profile_%' then return new;end if;
    if new.decision='approved' and old.decision is distinct from 'approved' then
      if old.status in('pending','moderating','moderation_retry') then raise exception 'MEDIA_AI_STILL_RUNNING' using errcode='40001';end if;
      perform public.assert_dancer_media_reviewer(new.reviewed_by,new.user_id);
    elsif new.review_decision='rejected' and new.reviewed_by is not null and old.review_decision is distinct from 'rejected' then
      perform public.assert_dancer_media_reviewer(new.reviewed_by,new.user_id);
    end if;
  elsif old.status in('uploading','moderating','submitted') and new.status in('approved','rejected') and old.status is distinct from new.status then
    if new.status='approved' and (old.status<>'submitted' or old.upload_validation_pending) then
      raise exception 'MEDIA_AI_STILL_RUNNING' using errcode='40001';
    end if;
    perform public.assert_dancer_media_reviewer(new.reviewed_by,new.submitted_by);
  end if;
  return new;
end $$;
create trigger dancer_photo_human_review before update on public.image_moderation_records for each row execute function public.guard_dancer_media_decision();
create trigger dancer_video_human_review before update on public.mydancr_tv_videos for each row execute function public.guard_dancer_media_decision();

revoke all on function public.venue_media_dancers(uuid),public.assert_dancer_media_reviewer(uuid,uuid,uuid),public.get_venue_dancer_media_review(uuid,uuid,integer,integer),public.dancer_submission_media(uuid),public.guard_dancer_media_decision() from public,anon,authenticated;
grant execute on function public.venue_media_dancers(uuid),public.assert_dancer_media_reviewer(uuid,uuid,uuid),public.get_venue_dancer_media_review(uuid,uuid,integer,integer),public.dancer_submission_media(uuid),public.guard_dancer_media_decision() to service_role;
CREATE OR REPLACE FUNCTION public.publish_approved_dancer_gallery_photo(p_record_id uuid, p_expected_updated_at timestamp with time zone, p_storage_path text, p_reason_codes jsonb, p_category_flags jsonb, p_category_scores jsonb, p_provider_flagged boolean, p_alt_text text DEFAULT NULL::text, p_reviewer_id uuid DEFAULT NULL::uuid, p_review_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_profile public.dancer_profiles%rowtype;
  v_record public.image_moderation_records%rowtype;
  v_photo public.dancer_photos%rowtype;
  v_old_photo public.dancer_photos%rowtype;
  v_context text;
  v_primary boolean;
  v_sort integer;
  v_preferred numeric;
  v_superseded jsonb := '[]'::jsonb;
  v_now timestamptz;
begin
  if p_record_id is null or p_expected_updated_at is null or p_storage_path is null
    or length(p_storage_path) > 1024 or p_storage_path <> btrim(p_storage_path)
    or coalesce(jsonb_typeof(p_reason_codes), '') <> 'array'
    or coalesce(jsonb_typeof(p_category_flags), '') <> 'object'
    or coalesce(jsonb_typeof(p_category_scores), '') <> 'object'
    or octet_length(p_reason_codes::text) + octet_length(p_category_flags::text)
      + octet_length(p_category_scores::text) > 65536
    or length(coalesce(p_alt_text, '')) > 2000
    or length(coalesce(p_review_notes, '')) > 4000 then
    raise exception 'PHOTO_PUBLICATION_INVALID_INPUT' using errcode = '22023';
  end if;

  select r.user_id into v_owner from public.image_moderation_records r where r.id = p_record_id;
  if not found then
    raise exception 'PHOTO_PUBLICATION_RECORD_MISSING' using errcode = 'P0002';
  end if;

  -- Every publication takes the profile lock before the review lock. Do not
  -- hold a database lock while uploading bytes or calling a moderation vendor.
  select d.* into v_profile from public.dancer_profiles d where d.user_id = v_owner for update;
  if not found then
    raise exception 'PHOTO_PUBLICATION_PROFILE_MISSING' using errcode = 'P0002';
  end if;
  select r.* into v_record from public.image_moderation_records r
    where r.id = p_record_id and r.user_id = v_owner for update;
  if not found then
    raise exception 'PHOTO_PUBLICATION_CONFLICT' using errcode = '40001';
  end if;
  v_now := clock_timestamp();
  if not exists(select 1 from public.app_users a where a.id=v_owner and a.role='dancer') then
    raise exception 'PHOTO_PUBLICATION_OWNER_INVALID' using errcode = '42501';
  end if;

  if p_reviewer_id is not null then
    perform public.assert_dancer_media_reviewer(p_reviewer_id,v_owner);
  elsif not exists(select 1 from public.app_users a where a.id = v_owner
    and a.role = 'dancer' and a.account_state = 'active' and a.dmca_suspended_at is null) then
    raise exception 'PHOTO_PUBLICATION_ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  v_context := lower(btrim(v_record.upload_context));
  v_primary := v_context = 'profile_main' or v_context like 'profile_main:%';
  if not v_primary and v_context <> 'profile_gallery' and v_context !~ '^profile_gallery:[0-9]+$' then
    raise exception 'PHOTO_PUBLICATION_INVALID_CONTEXT' using errcode = '22023';
  end if;
  if left(p_storage_path, length(v_owner::text || '/' || v_profile.id::text || '/'))
      <> v_owner::text || '/' || v_profile.id::text || '/'
    or p_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'PHOTO_PUBLICATION_STORAGE_OWNER_MISMATCH' using errcode = '42501';
  end if;

  -- A lost response must return the already committed identity, never create
  -- another photo. A deleted or inconsistent result is not resurrected.
  if v_record.decision = 'approved' and v_record.status = 'approved' then
    select p.* into v_photo from public.dancer_photos p where p.id = v_record.image_id
      and p.dancer_id = v_profile.id and p.storage_path = v_record.final_storage_path
      and p.review_status = 'approved';
    if not found then
      raise exception 'PHOTO_PUBLICATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;
    return jsonb_build_object('photo',to_jsonb(v_photo),'record',to_jsonb(v_record),
      'already_published',true,'superseded_storage_paths','[]'::jsonb);
  end if;
  if v_record.updated_at is distinct from p_expected_updated_at
    or v_record.decision <> 'review' or v_record.status in ('approved','rejected')
    or v_record.image_id is not null then
    raise exception 'PHOTO_PUBLICATION_CONFLICT' using errcode = '40001';
  end if;

  if not exists(select 1 from storage.objects o where o.bucket_id = 'dancer-photos' and o.name = p_storage_path) then
    raise exception 'PHOTO_PUBLICATION_STORAGE_MISSING' using errcode = 'P0002';
  end if;
  if exists(select 1 from public.dancer_photos p where p.storage_path = p_storage_path) then
    raise exception 'PHOTO_PUBLICATION_STORAGE_ALREADY_USED' using errcode = '23505';
  end if;

  if v_record.photo_publication_mode = 'replace' then
    select p.* into v_old_photo from public.dancer_photos p
      where p.id = v_record.replacement_photo_id and p.dancer_id = v_profile.id for update;
    if not found or v_old_photo.is_primary is distinct from v_primary then
      raise exception 'PHOTO_PUBLICATION_REPLACEMENT_CHANGED' using errcode = '40001';
    end if;
    v_sort := v_old_photo.sort_order;
    v_superseded := jsonb_build_array(v_old_photo.storage_path);
    -- Withdraw only older outstanding reviews linked to the exact replaced
    -- photo. Keep their history, and keep their stale identity expectations.
    update public.image_moderation_records set decision='rejected',status='rejected',
      error_code='photo_replaced',completed_at=v_now,updated_at=v_now
      where image_id=v_old_photo.id and user_id=v_owner and id<>p_record_id and decision='review';
    delete from public.dancer_photos where id=v_old_photo.id and dancer_id=v_profile.id;
  else
    if (select count(*) from public.dancer_photos p where p.dancer_id=v_profile.id
      and p.review_status in ('approved','pending')) >= 50 then
      raise exception 'PHOTO_PUBLICATION_LIBRARY_FULL' using errcode = '23514';
    end if;
    if v_primary then
      if exists(select 1 from public.dancer_photos p where p.dancer_id=v_profile.id
        and p.is_primary and p.review_status in ('approved','pending')) then
        raise exception 'PHOTO_PUBLICATION_PRIMARY_EXISTS' using errcode = '40001';
      end if;
      v_sort := 0;
    else
      if v_context ~ '^profile_gallery:[0-9]{1,3}$' then
        v_preferred := substring(v_context from '[0-9]+$')::numeric;
        if v_preferred between 1 and 50 and not exists(select 1 from public.dancer_photos p
          where p.dancer_id=v_profile.id and not p.is_primary and p.sort_order=v_preferred
          and p.review_status in ('approved','pending')) then
          v_sort := v_preferred::integer;
        end if;
      end if;
      if v_sort is null then
        select n into v_sort from generate_series(1,50) n where not exists(
          select 1 from public.dancer_photos p where p.dancer_id=v_profile.id
            and not p.is_primary and p.sort_order=n and p.review_status in ('approved','pending')
        ) order by n limit 1;
      end if;
      if v_sort is null then
        raise exception 'PHOTO_PUBLICATION_LIBRARY_FULL' using errcode = '23514';
      end if;
    end if;
  end if;

  insert into public.dancer_photos(dancer_id,storage_path,is_primary,sort_order,alt_text,review_status)
    values(v_profile.id,p_storage_path,v_primary,v_sort,p_alt_text,'approved') returning * into v_photo;
  update public.image_moderation_records set image_id=v_photo.id,final_storage_path=p_storage_path,
    upload_context=case when v_primary then 'profile_main' else 'profile_gallery:' || v_sort::text end,
    decision='approved',status='approved',reason_codes=p_reason_codes,category_flags=p_category_flags,
    category_scores=p_category_scores,provider_flagged=coalesce(p_provider_flagged,false),
    error_code=null,last_error_code=null,last_error_message=null,next_attempt_at=null,locked_at=null,
    completed_at=v_now,updated_at=v_now,
    reviewed_by=coalesce(p_reviewer_id,reviewed_by),
    reviewed_at=case when p_reviewer_id is not null then v_now else reviewed_at end,
    review_decision=case when p_reviewer_id is not null then 'approved' else review_decision end,
    review_notes=case when p_reviewer_id is not null then nullif(p_review_notes,'') else review_notes end
    where id=p_record_id returning * into v_record;
  update public.dancer_profiles set photo_review_status='approved' where id=v_profile.id;
  return jsonb_build_object('photo',to_jsonb(v_photo),'record',to_jsonb(v_record),
    'already_published',false,'superseded_storage_paths',v_superseded);
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_approved_dancer_avatar(p_record_id uuid, p_expected_updated_at timestamp with time zone, p_storage_path text, p_reason_codes jsonb, p_category_flags jsonb, p_category_scores jsonb, p_provider_flagged boolean, p_reviewer_id uuid DEFAULT NULL::uuid, p_review_notes text DEFAULT NULL::text, p_legacy_avatar_path text DEFAULT NULL::text, p_legacy_avatar_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_record public.image_moderation_records%rowtype;
  v_previous text;
  v_prefix text;
  v_now timestamptz;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_record_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or p_storage_path is null or length(p_storage_path)>1024 or p_storage_path<>btrim(p_storage_path)
    or coalesce(jsonb_typeof(p_reason_codes),'')<>'array' or coalesce(jsonb_typeof(p_category_flags),'')<>'object'
    or coalesce(jsonb_typeof(p_category_scores),'')<>'object'
    or octet_length(p_reason_codes::text)+octet_length(p_category_flags::text)+octet_length(p_category_scores::text)>65536
    or length(coalesce(p_review_notes,''))>4000
    or (p_legacy_avatar_updated_at is not null and not isfinite(p_legacy_avatar_updated_at)) then
    raise exception 'AVATAR_INVALID_INPUT' using errcode='22023';
  end if;
  select user_id into v_owner from public.image_moderation_records where id=p_record_id;
  if not found then raise exception 'AVATAR_REVIEW_MISSING' using errcode='P0002';end if;
  select * into v_account from public.app_users where id=v_owner for update;
  if not found or v_account.role is distinct from 'dancer' then raise exception 'AVATAR_OWNER_INVALID' using errcode='42501';end if;
  if p_reviewer_id is null then
    if v_account.account_state is distinct from 'active' or v_account.dmca_suspended_at is not null then
      raise exception 'AVATAR_ACCOUNT_UNAVAILABLE' using errcode='42501';
    end if;
  else
    perform public.assert_dancer_media_reviewer(p_reviewer_id,v_owner);
  end if;
  select * into v_profile from public.dancer_profiles where user_id=v_owner for update;
  if not found then raise exception 'AVATAR_PROFILE_MISSING' using errcode='P0002';end if;
  select * into v_record from public.image_moderation_records where id=p_record_id and user_id=v_owner for update;
  if not found or v_record.upload_context<>'profile_avatar' or v_record.image_id is not null then
    raise exception 'AVATAR_REVIEW_CHANGED' using errcode='40001';
  end if;
  -- A replay can only acknowledge the result that is still the current avatar.
  if v_record.decision='approved' and v_record.status='approved' then
    if v_record.final_storage_path is null or v_profile.avatar_storage_path is distinct from v_record.final_storage_path
      or not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=v_record.final_storage_path) then
      raise exception 'AVATAR_RESULT_UNAVAILABLE' using errcode='40001';
    end if;
    return jsonb_build_object('record',to_jsonb(v_record),'profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
      'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
      'previous_storage_path',null,'already_published',true);
  end if;
  if v_record.updated_at is distinct from p_expected_updated_at or v_record.decision<>'review'
    or v_record.status in('approved','rejected') then
    raise exception 'AVATAR_REVIEW_CHANGED' using errcode='40001';
  end if;
  if v_record.avatar_expected_updated_at is null then
    -- Historical pending reviews have no trustworthy upload intent. Only a fresh
    -- explicit administrator decision may bind them to the initial profile snapshot.
    if p_reviewer_id is null then raise exception 'AVATAR_INTENT_MISSING' using errcode='40001';end if;
    if v_profile.avatar_storage_path is distinct from p_legacy_avatar_path
      or v_profile.avatar_updated_at is distinct from p_legacy_avatar_updated_at then
      raise exception 'AVATAR_CHANGED' using errcode='40001';
    end if;
  elsif v_profile.avatar_storage_path is distinct from v_record.avatar_expected_path
    or v_profile.avatar_updated_at is distinct from v_record.avatar_expected_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode='40001';
  end if;
  v_prefix:=v_owner::text || '/' || v_profile.id::text || '/avatar/';
  if left(p_storage_path,length(v_prefix))<>v_prefix or p_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'AVATAR_STORAGE_OWNER_MISMATCH' using errcode='42501';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=p_storage_path) then
    raise exception 'AVATAR_STORAGE_MISSING' using errcode='P0002';
  end if;
  v_previous:=v_profile.avatar_storage_path;v_now:=clock_timestamp();
  update public.dancer_profiles set avatar_storage_path=p_storage_path,avatar_updated_at=v_now
    where id=v_profile.id returning * into v_profile;
  update public.image_moderation_records set final_storage_path=p_storage_path,image_id=null,
    decision='approved',status='approved',reason_codes=p_reason_codes,category_flags=p_category_flags,
    category_scores=p_category_scores,provider_flagged=coalesce(p_provider_flagged,false),
    error_code=null,last_error_code=null,last_error_message=null,next_attempt_at=null,locked_at=null,
    completed_at=v_now,updated_at=v_now,
    reviewed_by=coalesce(p_reviewer_id,reviewed_by),
    reviewed_at=case when p_reviewer_id is not null then v_now else reviewed_at end,
    review_decision=case when p_reviewer_id is not null then 'approved' else review_decision end,
    review_notes=case when p_reviewer_id is not null then nullif(p_review_notes,'') else review_notes end
    where id=p_record_id returning * into v_record;
  return jsonb_build_object('record',to_jsonb(v_record),'profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
    'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
    'previous_storage_path',v_previous,'already_published',false);
end;
$function$;

commit;
