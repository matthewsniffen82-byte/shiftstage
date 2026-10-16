begin;
set local lock_timeout = '3s';

-- Source identity survives a photo's deletion until the deferred trigger runs.
-- Keep existing avatars until the dancer next changes their approved main photo.
alter table public.dancer_profiles add column avatar_source_photo_id uuid,
  add column avatar_source_storage_path text;
update public.dancer_profiles profile set avatar_source_photo_id = photo.id,
  avatar_source_storage_path = photo.storage_path
from public.dancer_photos photo
where photo.dancer_id = profile.id and photo.is_primary and photo.review_status = 'approved';
update public.dancer_profiles set avatar_storage_path = avatar_source_storage_path
where avatar_storage_path is null and avatar_source_storage_path is not null;

create function public.sync_main_photo_avatar()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  target uuid;
  targets uuid[];
  profile public.dancer_profiles%rowtype;
  photo public.dancer_photos%rowtype;
  avatar_path text;
begin
  if tg_op = 'UPDATE' then
    if new.dancer_id is not distinct from old.dancer_id and new.id is not distinct from old.id
      and new.storage_path is not distinct from old.storage_path
      and new.is_primary is not distinct from old.is_primary
      and new.review_status is not distinct from old.review_status then return null; end if;
    targets := array[old.dancer_id, new.dancer_id];
  elsif tg_op = 'DELETE' then targets := array[old.dancer_id];
  else targets := array[new.dancer_id]; end if;
  for target in select distinct id from unnest(targets) id order by id loop
    select * into profile from public.dancer_profiles where id = target for update;
    if not found then continue; end if;
    select * into photo from public.dancer_photos where dancer_id = target
      and is_primary and review_status = 'approved' order by id limit 1;
    if profile.avatar_source_photo_id is not distinct from photo.id
      and profile.avatar_source_storage_path is not distinct from photo.storage_path then continue; end if;
    avatar_path := photo.storage_path;
    if avatar_path is not null and exists(select 1 from storage.objects
      where bucket_id = 'dancer-photos' and name = photo.storage_path || '.avatar.jpg') then
      avatar_path := photo.storage_path || '.avatar.jpg';
    end if;
    update public.dancer_profiles set avatar_storage_path = avatar_path,
      avatar_source_photo_id = photo.id, avatar_source_storage_path = photo.storage_path
    where id = target;
  end loop;
  return null;
end;
$$;
revoke all on function public.sync_main_photo_avatar() from public, anon, authenticated;
-- Evaluate the final main photo, never the transient gap during an atomic replacement.
create constraint trigger sync_main_photo_avatar
after insert or update or delete on public.dancer_photos
deferrable initially deferred for each row execute function public.sync_main_photo_avatar();

create function public.save_main_photo_avatar_crop(
  p_user_id uuid, p_profile_id uuid, p_photo_id uuid, p_source_path text,
  p_expected_avatar_updated_at timestamptz, p_storage_path text
) returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare
  profile public.dancer_profiles%rowtype;
  prefix text;
  previous_path text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode = '0A000';
  end if;
  perform 1 from public.app_users where id = p_user_id and role = 'dancer' and account_state = 'active' for update;
  if not found then raise exception 'AVATAR_OWNER_INVALID' using errcode = '42501'; end if;
  select * into profile from public.dancer_profiles where id = p_profile_id and user_id = p_user_id for update;
  if not found or profile.disabled_at is not null then
    raise exception 'AVATAR_OWNER_INVALID' using errcode = '42501';
  end if;
  if profile.avatar_updated_at is distinct from p_expected_avatar_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode = '40001';
  end if;
  perform 1 from public.dancer_photos where id = p_photo_id and dancer_id = p_profile_id
    and is_primary and review_status = 'approved' and storage_path = p_source_path for update;
  if not found then raise exception 'AVATAR_SOURCE_CHANGED' using errcode = '40001'; end if;
  prefix := p_user_id::text || '/' || p_profile_id::text || '/avatar/';
  if p_storage_path is null or left(p_storage_path, length(prefix)) <> prefix
    or length(p_storage_path) > 1024 or p_storage_path <> btrim(p_storage_path)
    or p_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'AVATAR_STORAGE_OWNER_MISMATCH' using errcode = '42501';
  end if;
  if not exists(select 1 from storage.objects where bucket_id = 'dancer-photos' and name = p_storage_path)
    or not exists(select 1 from storage.objects where bucket_id = 'dancer-photos' and name = p_source_path) then
    raise exception 'AVATAR_STORAGE_MISSING' using errcode = 'P0002';
  end if;
  previous_path := profile.avatar_storage_path;
  update public.dancer_profiles set avatar_storage_path = p_storage_path,
    avatar_source_photo_id = p_photo_id, avatar_source_storage_path = p_source_path
  where id = p_profile_id returning * into profile;
  return jsonb_build_object('profile_id', profile.id, 'avatar_storage_path', profile.avatar_storage_path,
    'avatar_updated_at', profile.avatar_updated_at, 'previous_storage_path', previous_path);
end;
$$;
revoke all on function public.save_main_photo_avatar_crop(uuid,uuid,uuid,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.save_main_photo_avatar_crop(uuid,uuid,uuid,text,timestamptz,text) to service_role;
comment on function public.sync_main_photo_avatar() is
  'Links the avatar to the final approved main photo at commit. A new main photo invalidates older avatar upload/crop intent; gallery-only edits preserve a custom crop.';
commit;
