begin;

-- Enforce the same 25 MB ceiling for upload reservations and stored videos.
alter table public.mydancr_tv_videos drop constraint mydancr_tv_file_size_check;
alter table public.mydancr_tv_videos add constraint mydancr_tv_file_size_check
  check (file_size_bytes between 1 and 26214400);

update storage.buckets set file_size_limit = 26214400 where id = 'mydancr-tv-videos';

notify pgrst, 'reload schema';
commit;
