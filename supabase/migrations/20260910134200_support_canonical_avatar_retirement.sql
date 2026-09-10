-- Extend only the recognized master directory. Existing receipts and reference
-- guards remain permanent; no source records or storage objects are modified.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $preflight$
begin
  if md5(pg_get_functiondef('public.claim_gallery_storage_retirement(uuid,text)'::regprocedure)) <> '80580bd986dd3d1eeb793b7dcdd74aa9'
    or md5(pg_get_functiondef('public.gallery_storage_family(text)'::regprocedure)) <> 'a2400e2d1276542a034b29698e152f2f'
    or md5(pg_get_functiondef('public.guard_gallery_storage_reference()'::regprocedure)) <> '4eacfe09a1c51d2a614c4c7934f26741' then
    raise exception 'AVATAR_RETIREMENT_DEPENDENCY_CHANGED';
  end if;
  if has_function_privilege('anon','public.claim_gallery_storage_retirement(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_gallery_storage_retirement(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_gallery_storage_retirement(uuid,text)','EXECUTE') then
    raise exception 'AVATAR_RETIREMENT_PERMISSIONS_CHANGED';
  end if;
end;
$preflight$;

create or replace function public.claim_gallery_storage_retirement(p_profile_id uuid,p_storage_path text)
returns jsonb language plpgsql volatile security definer set search_path = '' set timezone = 'UTC'
as $function$
declare
  v_retirement public.gallery_storage_retirements%rowtype;
begin
  if p_profile_id is null or p_storage_path is null then
    raise exception 'GALLERY_RETIREMENT_INPUT_REQUIRED' using errcode='22023';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'GALLERY_RETIREMENT_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  -- Only a canonical master in the previously published profile directory can
  -- retire. Unrecognized/variant/external paths remain available for recovery.
  if p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(avatar/)?[A-Za-z0-9][A-Za-z0-9._-]*[.](jpg|jpeg|png|webp)$'
    or position('..' in p_storage_path)>0
    or split_part(p_storage_path,'/',2)<>p_profile_id::text
    or public.gallery_storage_family(p_storage_path)<>p_storage_path then
    return jsonb_build_object('status','retained','reason','unrecognized_path','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mydancr:gallery-retirement:' || p_storage_path,0));
  if not exists(select 1 from public.gallery_media_reference_history
    where profile_id=p_profile_id and public.gallery_storage_family(storage_path)=p_storage_path) then
    return jsonb_build_object('status','retained','reason','no_reference_history','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  if exists(select 1 from public.dancer_photos where public.gallery_storage_family(storage_path)=p_storage_path)
    or exists(select 1 from public.dancer_profiles where public.gallery_storage_family(avatar_storage_path)=p_storage_path)
    or exists(select 1 from public.image_moderation_records where public.gallery_storage_family(final_storage_path)=p_storage_path) then
    return jsonb_build_object('status','retained','reason','referenced','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  select * into v_retirement from public.gallery_storage_retirements where storage_path=p_storage_path;
  if not found then
    insert into public.gallery_storage_retirements(storage_path,profile_id)
      values(p_storage_path,p_profile_id) returning * into v_retirement;
  end if;
  return jsonb_build_object('status','retired','storage_path',v_retirement.storage_path,
    'profile_id',v_retirement.profile_id,'retirement_id',v_retirement.retirement_id,'retired_at',v_retirement.retired_at);
end;
$function$;
commit;
