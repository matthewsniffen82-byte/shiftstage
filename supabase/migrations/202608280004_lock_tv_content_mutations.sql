begin;

-- MyDancr TV uploads are prepared by an authenticated server route and use a
-- short-lived signed upload token. Browser sessions do not need unrestricted
-- Storage writes or direct moderation-table mutations.
revoke insert, update, delete on table public.mydancr_tv_videos from anon, authenticated;

drop policy if exists "dancers upload own MyDancr TV files" on storage.objects;
drop policy if exists "dancers delete own MyDancr TV files" on storage.objects;

commit;
