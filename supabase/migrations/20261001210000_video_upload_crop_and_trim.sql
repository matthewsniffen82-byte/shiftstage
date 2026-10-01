begin;

-- Keep the published duration limit at 30 seconds. Longer private sources are
-- represented by the selected clip's metadata until the server applies the edit.
alter table public.mydancr_tv_videos add column if not exists upload_edit jsonb;
alter table public.mydancr_tv_videos
  add constraint mydancr_tv_upload_edit_check
  check (upload_edit is null or (jsonb_typeof(upload_edit) = 'object' and upload_edit->>'version' = '1'));
revoke select (upload_edit), insert (upload_edit), update (upload_edit), references (upload_edit)
  on public.mydancr_tv_videos from public, anon, authenticated;
grant select (upload_edit), insert (upload_edit), update (upload_edit)
  on public.mydancr_tv_videos to service_role;

alter table public.mydancr_tv_videos drop constraint mydancr_tv_file_size_check;
alter table public.mydancr_tv_videos add constraint mydancr_tv_file_size_check
  check (file_size_bytes between 1 and 104857600);
update storage.buckets set file_size_limit = 104857600 where id = 'mydancr-tv-videos';

notify pgrst, 'reload schema';
commit;
