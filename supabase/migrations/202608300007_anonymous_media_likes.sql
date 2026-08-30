alter table public.dancer_photos
  add column if not exists like_count bigint not null default 0;

alter table public.mydancr_tv_videos
  add column if not exists like_count bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dancer_photos_like_count_nonnegative'
      and conrelid = 'public.dancer_photos'::regclass
  ) then
    alter table public.dancer_photos
      add constraint dancer_photos_like_count_nonnegative check (like_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'mydancr_tv_videos_like_count_nonnegative'
      and conrelid = 'public.mydancr_tv_videos'::regclass
  ) then
    alter table public.mydancr_tv_videos
      add constraint mydancr_tv_videos_like_count_nonnegative check (like_count >= 0);
  end if;
end
$$;

create table if not exists public.media_likes (
  id uuid primary key default gen_random_uuid(),
  visitor_token_hash text not null,
  photo_id uuid references public.dancer_photos(id) on delete cascade,
  video_id uuid references public.mydancr_tv_videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint media_likes_one_target check (num_nonnulls(photo_id, video_id) = 1),
  constraint media_likes_private_visitor_hash check (visitor_token_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists media_likes_visitor_photo_unique
  on public.media_likes(visitor_token_hash, photo_id)
  where photo_id is not null;

create unique index if not exists media_likes_visitor_video_unique
  on public.media_likes(visitor_token_hash, video_id)
  where video_id is not null;

create index if not exists media_likes_photo_count_idx
  on public.media_likes(photo_id)
  where photo_id is not null;

create index if not exists media_likes_video_count_idx
  on public.media_likes(video_id)
  where video_id is not null;

create or replace function public.sync_media_like_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.photo_id is not null then
      update public.dancer_photos
      set like_count = like_count + 1
      where id = new.photo_id;
    else
      update public.mydancr_tv_videos
      set like_count = like_count + 1
      where id = new.video_id;
    end if;
    return new;
  end if;

  if old.photo_id is not null then
    update public.dancer_photos
    set like_count = greatest(0, like_count - 1)
    where id = old.photo_id;
  else
    update public.mydancr_tv_videos
    set like_count = greatest(0, like_count - 1)
    where id = old.video_id;
  end if;
  return old;
end;
$$;

revoke all on function public.sync_media_like_count() from public, anon, authenticated;

drop trigger if exists sync_media_like_count_after_insert_delete on public.media_likes;
create trigger sync_media_like_count_after_insert_delete
after insert or delete on public.media_likes
for each row execute function public.sync_media_like_count();

alter table public.media_likes enable row level security;
revoke all on table public.media_likes from public, anon, authenticated;
revoke update (like_count) on table public.dancer_photos from public, anon, authenticated;
revoke update (like_count) on table public.mydancr_tv_videos from public, anon, authenticated;

comment on table public.media_likes is
  'Private, service-role-only anonymous media reactions. Raw visitor tokens are never stored.';
