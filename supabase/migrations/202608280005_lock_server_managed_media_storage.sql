begin;

-- Identity-document collection is retired, and venue branding is validated and
-- moderated by authenticated server routes. Browser sessions should not write
-- directly to any of these Storage buckets.
drop policy if exists "dancers upload own verification files" on storage.objects;
drop policy if exists "dancers update own verification files" on storage.objects;
drop policy if exists "dancers delete own verification files" on storage.objects;

drop policy if exists "venue owners manage own cover images" on storage.objects;
drop policy if exists "venue owners manage own logo images" on storage.objects;

commit;
