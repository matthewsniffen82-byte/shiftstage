begin isolation level repeatable read read only;
set local statement_timeout = '20s';
select jsonb_build_object(
 'captured_at', now(),
 'read_only', current_setting('transaction_read_only'),
 'photo_rows', (select count(*) from public.dancer_photos),
 'duplicate_gallery_slot_groups', (select count(*) from (
   select dancer_id, sort_order from public.dancer_photos where not is_primary
   and review_status in ('approved','pending') group by dancer_id,sort_order having count(*)>1
 ) duplicates),
 'duplicate_primary_groups', (select count(*) from (
   select dancer_id from public.dancer_photos where is_primary
   and review_status in ('approved','pending') group by dancer_id having count(*)>1
 ) duplicates),
 'empty_avatar_paths', (select count(*) from public.dancer_profiles where avatar_storage_path=''),
 'avatar_paths_shared_with_gallery', (select count(*) from public.dancer_profiles d
   where exists(select 1 from public.dancer_photos p where p.storage_path=d.avatar_storage_path)),
 'moderation_error_records', (select count(*) from public.image_moderation_records where status='moderation_error'),
 'rls', (select jsonb_object_agg(relname,relrowsecurity) from pg_class
   where oid in ('public.dancer_profiles'::regclass,'public.dancer_photos'::regclass,'public.image_moderation_records'::regclass))
) as media_preflight;
rollback;
