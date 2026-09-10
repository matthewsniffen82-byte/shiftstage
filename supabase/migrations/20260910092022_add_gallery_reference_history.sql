-- Durable reference observations, not storage deletion authorization.
-- Preserve history through photo/profile deletion; intentionally no source FKs.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.gallery_media_reference_history (
  event_id bigint generated always as identity primary key,
  recorded_at timestamptz not null default clock_timestamp(),
  transaction_id bigint not null default txid_current(),
  source_kind text not null check (source_kind in ('photo','avatar')),
  source_id uuid not null,
  profile_id uuid not null,
  storage_path text not null check (storage_path <> ''),
  event_kind text not null check (event_kind in ('baseline','referenced','released'))
);
create index gallery_media_reference_history_profile_event_idx
  on public.gallery_media_reference_history(profile_id,event_id);

alter table public.gallery_media_reference_history enable row level security;
revoke all on public.gallery_media_reference_history from public,anon,authenticated,service_role;
revoke all on sequence public.gallery_media_reference_history_event_id_seq from public,anon,authenticated,service_role;
grant select on public.gallery_media_reference_history to service_role;

create function public.capture_gallery_media_reference_history()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  v_kind text;
  v_old_id uuid;
  v_new_id uuid;
  v_old_profile uuid;
  v_new_profile uuid;
  v_old_path text;
  v_new_path text;
begin
  -- Restrict this privileged writer to its two fixed source relations.
  if tg_level <> 'ROW' or tg_when <> 'AFTER' or tg_op not in ('INSERT','UPDATE','DELETE') then
    raise exception 'GALLERY_HISTORY_INVALID_TRIGGER' using errcode='42501';
  end if;
  if tg_relid = 'public.dancer_photos'::regclass then
    v_kind := 'photo';
    if tg_op <> 'INSERT' then
      v_old_id := old.id; v_old_profile := old.dancer_id; v_old_path := old.storage_path;
    end if;
    if tg_op <> 'DELETE' then
      v_new_id := new.id; v_new_profile := new.dancer_id; v_new_path := new.storage_path;
    end if;
  elsif tg_relid = 'public.dancer_profiles'::regclass then
    v_kind := 'avatar';
    if tg_op <> 'INSERT' then
      v_old_id := old.id; v_old_profile := old.id; v_old_path := old.avatar_storage_path;
    end if;
    if tg_op <> 'DELETE' then
      v_new_id := new.id; v_new_profile := new.id; v_new_path := new.avatar_storage_path;
    end if;
  else
    raise exception 'GALLERY_HISTORY_INVALID_SOURCE' using errcode='42501';
  end if;
  if tg_op = 'UPDATE' and v_old_id is not distinct from v_new_id
    and v_old_profile is not distinct from v_new_profile and v_old_path is not distinct from v_new_path then
    return null;
  end if;
  if v_old_path is not null and v_old_path <> '' then
    insert into public.gallery_media_reference_history(source_kind,source_id,profile_id,storage_path,event_kind)
      values(v_kind,v_old_id,v_old_profile,v_old_path,'released');
  end if;
  if v_new_path is not null and v_new_path <> '' then
    insert into public.gallery_media_reference_history(source_kind,source_id,profile_id,storage_path,event_kind)
      values(v_kind,v_new_id,v_new_profile,v_new_path,'referenced');
  end if;
  return null;
end;
$function$;
revoke all on function public.capture_gallery_media_reference_history() from public,anon,authenticated,service_role;

-- Hold both sources stable only while installing triggers and copying the
-- current reference baseline. No media bytes or source rows are changed.
lock table public.dancer_profiles,public.dancer_photos in share row exclusive mode;
create trigger dancer_photos_capture_media_reference
  after insert or delete or update of id,dancer_id,storage_path on public.dancer_photos
  for each row execute function public.capture_gallery_media_reference_history();
create trigger dancer_profiles_capture_avatar_reference
  after insert or delete or update of id,avatar_storage_path on public.dancer_profiles
  for each row execute function public.capture_gallery_media_reference_history();

insert into public.gallery_media_reference_history(source_kind,source_id,profile_id,storage_path,event_kind)
  select 'photo',id,dancer_id,storage_path,'baseline' from public.dancer_photos
  where storage_path is not null and storage_path <> '';
insert into public.gallery_media_reference_history(source_kind,source_id,profile_id,storage_path,event_kind)
  select 'avatar',id,id,avatar_storage_path,'baseline' from public.dancer_profiles
  where avatar_storage_path is not null and avatar_storage_path <> '';

comment on table public.gallery_media_reference_history is
  'Private append-only observations of committed gallery/avatar references. Baseline is capture time, not original publication time. A released reference never authorizes deletion: other references and unfinished publishers may exist. No source FKs so cascade deletion preserves recovery evidence.';
comment on function public.capture_gallery_media_reference_history() is
  'Restricted AFTER ROW trigger writer for dancer_photos and dancer_profiles. History commits or rolls back with its source mutation. No direct browser/service execution or history writes are granted.';
commit;
