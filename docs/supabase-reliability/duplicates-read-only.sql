-- Metadata and aggregate counts only; no private rows or mutations.
begin isolation level repeatable read read only;
set local statement_timeout = '20s';
set local lock_timeout = '1s';
select jsonb_build_object(
  'captured_at', now(),
  'read_only', current_setting('transaction_read_only'),
  'shift_rows', (select count(*) from public.shifts),
  'scheduled_date_duplicate_groups', (select count(*) from (
    select dancer_id,venue_id,shift_date from public.shifts
    where shift_source='scheduled' and status='posted'
    group by dancer_id,venue_id,shift_date having count(*)>1
  ) duplicates),
  'active_session_duplicate_groups', (select count(*) from (
    -- A dressing-room tap can activate an existing scheduled row in place.
    select dancer_id from public.shifts where shift_source<>'demo_locked'
      and status='posted' and checked_in_at is not null and checked_out_at is null
      and location_verification_expires_at>now()
    group by dancer_id having count(*)>1
  ) duplicates),
  'photo_storage_duplicate_groups', (select count(*) from (
    select storage_path from public.dancer_photos group by storage_path having count(*)>1
  ) duplicates),
  'case_insensitive_dancer_slug_duplicate_groups', (select count(*) from (
    select lower(slug) from public.dancer_profiles group by lower(slug) having count(*)>1
  ) duplicates),
  'unique_indexes', (select coalesce(jsonb_agg(jsonb_build_object(
    'table',t.relname,'name',i.relname,'definition',pg_get_indexdef(i.oid),
    'valid',x.indisvalid,'ready',x.indisready
  ) order by t.relname,i.relname),'[]'::jsonb)
    from pg_index x join pg_class i on i.oid=x.indexrelid
    join pg_class t on t.oid=x.indrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and x.indisunique
  )
) as duplicate_review;
rollback;
