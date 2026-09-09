-- Aggregate diagnostics only. Review the target before running; no row IDs,
-- private records, account changes, schema mutations, or repairs are returned.
begin isolation level repeatable read read only;
set local statement_timeout = '20s';
set local lock_timeout = '1s';

select jsonb_build_object(
  'captured_at', now(),
  'read_only', current_setting('transaction_read_only'),
  'missing_primary_keys', (
    select count(*) from pg_class t join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relkind in ('r','p')
      and not exists (select 1 from pg_constraint c where c.conrelid=t.oid and c.contype='p')
  ),
  'unvalidated_foreign_keys', (
    select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace
    where n.nspname='public' and c.contype='f' and not c.convalidated
  ),
  'set_null_required_columns', (
    select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
    where n.nspname='public' and c.contype='f' and c.confdeltype='n' and a.attnotnull
  ),
  'liquor_check_exceptions', (
    select jsonb_build_object('total',count(*),'active',count(*) filter (where is_active))
    from public.club_deals
    where public.club_deal_is_liquor_related(offer_type,deal_title,deal_description,deal_terms)
  ),
  'dancer_profile_role_mismatches', (
    select count(*) from public.dancer_profiles d join public.app_users a on a.id=d.user_id
    where a.role <> 'dancer'
  ),
  'shift_affiliation_mismatches', (
    select count(*) from public.shifts s join public.venue_dancer_affiliations a on a.id=s.venue_affiliation_id
    where s.dancer_id<>a.dancer_id or s.venue_id<>a.venue_id
  ),
  'video_shift_dancer_mismatches', (
    select count(*) from public.mydancr_tv_videos v join public.shifts s on s.id=v.shift_id
    where v.dancer_id<>s.dancer_id
  )
) as relationship_review;
rollback;
