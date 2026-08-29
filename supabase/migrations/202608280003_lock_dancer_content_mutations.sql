begin;

-- Dancer identity, publication, media review, and social content mutations flow
-- through authenticated server routes so protected columns cannot be changed via
-- direct PostgREST or Storage API calls.
revoke insert, update, delete on table public.dancer_profiles from anon, authenticated;
revoke insert, update, delete on table public.dancer_photos from anon, authenticated;
revoke insert, update, delete on table public.social_links from anon, authenticated;
revoke insert, update, delete on table public.image_moderation_records from anon, authenticated;

drop policy if exists "dancers update own draft profile" on public.dancer_profiles;
drop policy if exists "dancers create own profile" on public.dancer_profiles;
drop policy if exists "dancers manage own photos" on public.dancer_photos;
drop policy if exists "dancers manage own social links" on public.social_links;
drop policy if exists "users insert own moderation shell" on public.image_moderation_records;

drop policy if exists "dancers upload own dancer photo files" on storage.objects;
drop policy if exists "dancers update own dancer photo files" on storage.objects;
drop policy if exists "dancers delete own dancer photo files" on storage.objects;

commit;
