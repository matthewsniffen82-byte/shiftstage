begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Internal card choice is independent of the avatar, public primary and pins.
create table public.dancer_internal_main_photos (
  dancer_id uuid primary key references public.dancer_profiles(id) on delete cascade,
  photo_id uuid not null references public.dancer_photos(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index dancer_internal_main_photos_photo_idx on public.dancer_internal_main_photos(photo_id);
alter table public.dancer_internal_main_photos enable row level security;
revoke all on public.dancer_internal_main_photos from public, anon, authenticated;
grant all on public.dancer_internal_main_photos to service_role;

create function public.set_dancer_internal_main_photo(p_actor_user_id uuid, p_photo_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
as $function$
declare
  v_dancer uuid;
begin
  if p_actor_user_id is null or p_photo_id is null then
    raise exception 'INTERNAL_PHOTO_INVALID_INPUT' using errcode = '22023';
  end if;

  -- Match the gallery publisher's profile-before-photo lock order.
  select d.id into v_dancer from public.dancer_profiles d
    where d.user_id = p_actor_user_id and d.disabled_at is null for update;
  if not found or not exists (
    select 1 from public.app_users a where a.id = p_actor_user_id
      and a.role = 'dancer' and a.account_state = 'active' and a.dmca_suspended_at is null
  ) then
    raise exception 'INTERNAL_PHOTO_FORBIDDEN' using errcode = '42501';
  end if;

  perform p.id from public.dancer_photos p where p.id = p_photo_id
    and p.dancer_id = v_dancer and p.review_status = 'approved' for update;
  if not found then
    raise exception 'INTERNAL_PHOTO_UNAVAILABLE' using errcode = 'P0002';
  end if;

  insert into public.dancer_internal_main_photos(dancer_id, photo_id)
    values(v_dancer, p_photo_id)
    on conflict(dancer_id) do update set photo_id = excluded.photo_id, updated_at = now();
  return p_photo_id;
end;
$function$;
revoke all on function public.set_dancer_internal_main_photo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_dancer_internal_main_photo(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
commit;
