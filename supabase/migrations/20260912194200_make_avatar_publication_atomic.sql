-- Preserve avatar intent across background work, publication and deletion.
-- Existing reviews remain legacy; no existing avatar or review is adopted or removed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.image_moderation_records
  add column avatar_expected_path text,
  add column avatar_expected_updated_at timestamptz,
  add constraint image_moderation_avatar_intent_check check (
    (avatar_expected_updated_at is null and avatar_expected_path is null)
    or (avatar_expected_updated_at is not null and isfinite(avatar_expected_updated_at)
      and upload_context='profile_avatar'
      and (avatar_expected_path is null or length(avatar_expected_path)<=1024))
  );

create function public.advance_dancer_avatar_version()
returns trigger language plpgsql security invoker set search_path=''
as $function$
begin
  if tg_level<>'ROW' or tg_when<>'BEFORE' or tg_op<>'UPDATE'
    or tg_relid<>'public.dancer_profiles'::regclass then
    raise exception 'INVALID_AVATAR_VERSION_TRIGGER' using errcode='42501';
  end if;
  if old.avatar_updated_at is not null and not isfinite(old.avatar_updated_at) then
    raise exception 'AVATAR_VERSION_UNAVAILABLE' using errcode='40001';
  end if;
  new.avatar_updated_at:=greatest(pg_catalog.clock_timestamp(),old.avatar_updated_at+interval '1 microsecond');
  return new;
end;
$function$;
revoke all on function public.advance_dancer_avatar_version() from public,anon,authenticated,service_role;
create trigger advance_dancer_avatar_version
before update of avatar_storage_path,avatar_updated_at on public.dancer_profiles
for each row execute function public.advance_dancer_avatar_version();

create function public.advance_avatar_review_version()
returns trigger language plpgsql security invoker set search_path=''
as $function$
begin
  if tg_level<>'ROW' or tg_when<>'BEFORE' or tg_op<>'UPDATE'
    or tg_relid<>'public.image_moderation_records'::regclass then
    raise exception 'INVALID_AVATAR_REVIEW_TRIGGER' using errcode='42501';
  end if;
  if old.upload_context='profile_avatar' or new.upload_context='profile_avatar' then
    if old.updated_at is null or not isfinite(old.updated_at) then
      raise exception 'AVATAR_REVIEW_VERSION_UNAVAILABLE' using errcode='40001';
    end if;
    new.updated_at:=greatest(pg_catalog.clock_timestamp(),old.updated_at+interval '1 microsecond');
  end if;
  return new;
end;
$function$;
revoke all on function public.advance_avatar_review_version() from public,anon,authenticated,service_role;
create trigger advance_avatar_review_version before update on public.image_moderation_records
for each row execute function public.advance_avatar_review_version();

create function public.create_dancer_avatar_review(
  p_user_id uuid,p_profile_id uuid,p_expected_avatar_path text,p_expected_avatar_updated_at timestamptz,
  p_temporary_storage_path text,p_idempotency_key text,p_provider_model text
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s'
as $function$
declare
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_record public.image_moderation_records%rowtype;
  v_prefix text;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_user_id is null or p_profile_id is null or p_temporary_storage_path is null
    or length(p_temporary_storage_path)>1024 or p_temporary_storage_path<>btrim(p_temporary_storage_path)
    or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 256
    or p_provider_model is null or length(p_provider_model) not between 1 and 128
    or (p_expected_avatar_updated_at is not null and not isfinite(p_expected_avatar_updated_at)) then
    raise exception 'AVATAR_INVALID_INPUT' using errcode='22023';
  end if;
  select * into v_account from public.app_users where id=p_user_id for update;
  if not found or v_account.role is distinct from 'dancer' or v_account.account_state is distinct from 'active' or v_account.dmca_suspended_at is not null then
    raise exception 'AVATAR_ACCOUNT_UNAVAILABLE' using errcode='42501';
  end if;
  select * into v_profile from public.dancer_profiles where id=p_profile_id and user_id=p_user_id for update;
  if not found then raise exception 'AVATAR_PROFILE_UNAVAILABLE' using errcode='42501';end if;
  if exists(select 1 from public.image_moderation_records where user_id=p_user_id and idempotency_key=p_idempotency_key) then
    raise exception 'AVATAR_REVIEW_ALREADY_EXISTS' using errcode='23505';
  end if;
  if v_profile.avatar_storage_path is distinct from p_expected_avatar_path
    or v_profile.avatar_updated_at is distinct from p_expected_avatar_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode='40001';
  end if;
  v_prefix:=p_user_id::text || '/' || p_profile_id::text || '/';
  if left(p_temporary_storage_path,length(v_prefix))<>v_prefix
    or p_temporary_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'AVATAR_STORAGE_OWNER_MISMATCH' using errcode='42501';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='dancr-image-moderation-temp' and name=p_temporary_storage_path) then
    raise exception 'AVATAR_SOURCE_MISSING' using errcode='P0002';
  end if;
  -- Reserving intent changes only the version. Keep the currently displayed avatar.
  update public.dancer_profiles set avatar_updated_at=clock_timestamp()
    where id=p_profile_id returning * into v_profile;
  insert into public.image_moderation_records(user_id,temporary_storage_path,upload_context,
    provider,provider_model,provider_flagged,decision,status,reason_codes,category_flags,category_scores,
    idempotency_key,photo_publication_mode,replacement_photo_id,attempt_count,
    avatar_expected_path,avatar_expected_updated_at)
  values(p_user_id,p_temporary_storage_path,'profile_avatar','openai',p_provider_model,false,'review','moderating',
    '[]','{}','{}',p_idempotency_key,'legacy',null,1,v_profile.avatar_storage_path,v_profile.avatar_updated_at)
  returning * into v_record;
  return jsonb_build_object('profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
    'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
    'record',to_jsonb(v_record));
end;
$function$;
revoke all on function public.create_dancer_avatar_review(uuid,uuid,text,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.create_dancer_avatar_review(uuid,uuid,text,timestamptz,text,text,text) to service_role;

create function public.publish_approved_dancer_avatar(
  p_record_id uuid,p_expected_updated_at timestamptz,p_storage_path text,
  p_reason_codes jsonb,p_category_flags jsonb,p_category_scores jsonb,p_provider_flagged boolean,
  p_reviewer_id uuid default null,p_review_notes text default null,
  p_legacy_avatar_path text default null,p_legacy_avatar_updated_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s'
as $function$
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
    perform 1 from public.app_users where id=p_reviewer_id and role='admin' and account_state='active' for share;
    if not found then raise exception 'AVATAR_REVIEWER_FORBIDDEN' using errcode='42501';end if;
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
revoke all on function public.publish_approved_dancer_avatar(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.publish_approved_dancer_avatar(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,uuid,text,text,timestamptz) to service_role;

create function public.clear_dancer_avatar_safely(
  p_user_id uuid,p_profile_id uuid,p_expected_avatar_path text,p_expected_avatar_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s'
as $function$
declare
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_records jsonb;
  v_ids uuid[];
  v_previous text;
  v_affected integer;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_user_id is null or p_profile_id is null
    or (p_expected_avatar_updated_at is not null and not isfinite(p_expected_avatar_updated_at)) then
    raise exception 'AVATAR_INVALID_INPUT' using errcode='22023';
  end if;
  select * into v_account from public.app_users where id=p_user_id for update;
  if not found or v_account.role is distinct from 'dancer' or v_account.account_state is distinct from 'active' then
    raise exception 'AVATAR_ACCOUNT_UNAVAILABLE' using errcode='42501';
  end if;
  select * into v_profile from public.dancer_profiles where id=p_profile_id and user_id=p_user_id for update;
  if not found then raise exception 'AVATAR_PROFILE_UNAVAILABLE' using errcode='42501';end if;
  if v_profile.avatar_storage_path is distinct from p_expected_avatar_path
    or v_profile.avatar_updated_at is distinct from p_expected_avatar_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode='40001';
  end if;
  -- Every new avatar reservation takes this same profile lock first.
  if (select count(*) from public.image_moderation_records where user_id=p_user_id and upload_context='profile_avatar')>1000 then
    raise exception 'AVATAR_REVIEW_LIMIT' using errcode='54000';
  end if;
  perform 1 from public.image_moderation_records where user_id=p_user_id and upload_context='profile_avatar' order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,
    'temporary_storage_path',temporary_storage_path,'final_storage_path',final_storage_path) order by id),'[]'::jsonb),
    coalesce(array_agg(id order by id),'{}'::uuid[]) into v_records,v_ids
    from public.image_moderation_records where user_id=p_user_id and upload_context='profile_avatar';
  if cardinality(v_ids)>1000 then raise exception 'AVATAR_REVIEW_LIMIT' using errcode='54000';end if;
  delete from public.image_moderation_records where id=any(v_ids) and user_id=p_user_id and upload_context='profile_avatar';
  get diagnostics v_affected=row_count;
  if v_affected<>cardinality(v_ids) then raise exception 'AVATAR_DELETE_UNCONFIRMED' using errcode='40001';end if;
  v_previous:=v_profile.avatar_storage_path;
  update public.dancer_profiles set avatar_storage_path=null,avatar_updated_at=clock_timestamp()
    where id=p_profile_id returning * into v_profile;
  return jsonb_build_object('profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
    'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
    'deleted_records',v_records,'previous_storage_path',v_previous);
end;
$function$;
revoke all on function public.clear_dancer_avatar_safely(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.clear_dancer_avatar_safely(uuid,uuid,text,timestamptz) to service_role;

create function public.recenter_dancer_avatar_safely(
  p_reviewer_id uuid,p_profile_id uuid,p_expected_avatar_path text,p_expected_avatar_updated_at timestamptz,
  p_storage_path text,p_source_path text,p_source_photo_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s'
as $function$
declare
  v_owner uuid;
  v_profile public.dancer_profiles%rowtype;
  v_photo public.dancer_photos%rowtype;
  v_prefix text;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_reviewer_id is null or p_profile_id is null or p_storage_path is null or p_source_path is null
    or p_expected_avatar_path is null or p_expected_avatar_path=''
    or length(p_storage_path)>1024 or p_storage_path<>btrim(p_storage_path)
    or length(p_source_path)>1024
    or (p_expected_avatar_updated_at is not null and not isfinite(p_expected_avatar_updated_at)) then
    raise exception 'AVATAR_INVALID_INPUT' using errcode='22023';
  end if;
  select user_id into v_owner from public.dancer_profiles where id=p_profile_id;
  if not found then raise exception 'AVATAR_PROFILE_MISSING' using errcode='P0002';end if;
  perform 1 from public.app_users where id=v_owner and role='dancer' for update;
  if not found then raise exception 'AVATAR_OWNER_INVALID' using errcode='42501';end if;
  perform 1 from public.app_users where id=p_reviewer_id and role='admin' and account_state='active' for share;
  if not found then raise exception 'AVATAR_REVIEWER_FORBIDDEN' using errcode='42501';end if;
  select * into v_profile from public.dancer_profiles where id=p_profile_id and user_id=v_owner for update;
  if not found or v_profile.avatar_storage_path is distinct from p_expected_avatar_path
    or v_profile.avatar_updated_at is distinct from p_expected_avatar_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode='40001';
  end if;
  if p_source_photo_id is null then
    if p_source_path is distinct from p_expected_avatar_path then
      raise exception 'AVATAR_SOURCE_CHANGED' using errcode='40001';
    end if;
  else
    select * into v_photo from public.dancer_photos where id=p_source_photo_id and dancer_id=p_profile_id for update;
    if not found or v_photo.storage_path is distinct from p_source_path or v_photo.review_status is distinct from 'approved' then
      raise exception 'AVATAR_SOURCE_CHANGED' using errcode='40001';
    end if;
  end if;
  v_prefix:=v_owner::text || '/' || p_profile_id::text || '/avatar/';
  if left(p_storage_path,length(v_prefix))<>v_prefix or p_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'AVATAR_STORAGE_OWNER_MISMATCH' using errcode='42501';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=p_storage_path)
    or not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=p_source_path) then
    raise exception 'AVATAR_STORAGE_MISSING' using errcode='P0002';
  end if;
  update public.dancer_profiles set avatar_storage_path=p_storage_path,avatar_updated_at=clock_timestamp()
    where id=p_profile_id returning * into v_profile;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_reviewer_id,'dancer_profile',p_profile_id,'recenter_dancer_avatar',
      case when p_source_photo_id is null then 'Source: avatar' else 'Source: approved photo' end);
  return jsonb_build_object('profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
    'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
    'previous_storage_path',p_expected_avatar_path);
end;
$function$;
revoke all on function public.recenter_dancer_avatar_safely(uuid,uuid,text,timestamptz,text,text,uuid) from public,anon,authenticated;
grant execute on function public.recenter_dancer_avatar_safely(uuid,uuid,text,timestamptz,text,text,uuid) to service_role;

comment on column public.image_moderation_records.avatar_expected_updated_at is
  'Private server-recorded avatar intent. NULL marks historical reviews requiring an explicit administrator decision.';
comment on function public.publish_approved_dancer_avatar(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,uuid,text,text,timestamptz) is
  'Service-only avatar publication with persistent upload intent and exact review version; profile and review commit together. Storage cleanup follows only a checked acknowledgement.';
commit;
