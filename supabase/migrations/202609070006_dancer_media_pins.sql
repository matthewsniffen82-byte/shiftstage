begin;
set local lock_timeout = '5s';

alter table public.dancer_photos
  add column if not exists is_pinned boolean not null default false;
alter table public.mydancr_tv_videos
  add column if not exists is_pinned boolean not null default false;

comment on column public.dancer_photos.is_pinned is
  'Owner-selected priority within the dancer photo gallery; independent of the avatar and legacy photo slots.';
comment on column public.mydancr_tv_videos.is_pinned is
  'Owner-selected priority within the dancer video gallery; does not boost the shared TV feed.';

commit;
