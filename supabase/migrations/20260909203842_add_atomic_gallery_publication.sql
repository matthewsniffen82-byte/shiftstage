-- Add a service-only publication transaction before switching callers to it.
-- Existing reviews retain legacy intent; no existing photo or review is deleted.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.image_moderation_records
  add column photo_publication_mode text not null default 'legacy',
  add column replacement_photo_id uuid,
  add constraint image_moderation_photo_publication_intent_check check (
    (photo_publication_mode in ('legacy', 'add') and replacement_photo_id is null)
    or (photo_publication_mode = 'replace' and replacement_photo_id is not null)
  );

comment on column public.image_moderation_records.photo_publication_mode is
  'Server-recorded upload intent. Legacy reviews may add media, never infer permission to replace from a slot.';
comment on column public.image_moderation_records.replacement_photo_id is
  'Expected photo identity for an explicit replacement. Intentionally not a foreign key: deleting the target must preserve this stale expectation and reject replacement, not null it into an add.';

create function public.publish_approved_dancer_gallery_photo(
  p_record_id uuid,
  p_expected_updated_at timestamptz,
  p_storage_path text,
  p_reason_codes jsonb,
  p_category_flags jsonb,
  p_category_scores jsonb,
  p_provider_flagged boolean,
  p_alt_text text default null,
  p_reviewer_id uuid default null,
  p_review_notes text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
as $function$
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
    if not exists(select 1 from public.app_users a where a.id = p_reviewer_id
      and a.role = 'admin' and a.account_state = 'active') then
      raise exception 'PHOTO_PUBLICATION_REVIEWER_FORBIDDEN' using errcode = '42501';
    end if;
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

revoke all on function public.publish_approved_dancer_gallery_photo(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,text,uuid,text) from public, anon, authenticated;
grant execute on function public.publish_approved_dancer_gallery_photo(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,text,uuid,text) to service_role;
comment on function public.publish_approved_dancer_gallery_photo(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,text,uuid,text) is
  'Service-only atomic approved gallery publication. Locks the owner profile then review; preserves legacy media, rejects stale replacements, and returns the prior committed identity on retry. Storage cleanup is a separate post-commit operation.';
commit;
