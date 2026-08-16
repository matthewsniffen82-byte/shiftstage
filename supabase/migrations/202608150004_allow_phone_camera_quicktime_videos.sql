alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_storage_mime_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_storage_mime_check
  check (storage_mime in ('video/mp4', 'video/webm', 'video/quicktime'));

update storage.buckets
set allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime']::text[]
where id = 'mydancr-tv-videos';
