-- Public offers do not require referral fees, internal rules, or lifecycle timestamps.
-- Authorized venue/admin handlers continue to read these through the service role.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
lock table public.club_deals in share row exclusive mode;

do $guard$
begin
  if (select array_agg(attname::text order by attnum) from pg_attribute
      where attrelid = 'public.club_deals'::regclass and attnum > 0 and not attisdropped)
    is distinct from array['id','venue_id','deal_title','deal_description','deal_terms','is_active',
      'valid_days','valid_start_time','valid_end_time','redemption_rules','payout_type',
      'payout_amount_cents','created_at','updated_at','currency','offer_type','booking_url','sort_order','removed_at']
  then raise exception 'PUBLIC_DEAL_COLUMN_SCHEMA_DRIFT'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.club_deals'::regclass)
  then raise exception 'PUBLIC_DEAL_RLS_REQUIRED'; end if;
end
$guard$;

revoke select on table public.club_deals from public, anon, authenticated;
revoke select (id, venue_id, deal_title, deal_description, deal_terms, is_active,
  valid_days, valid_start_time, valid_end_time, redemption_rules, payout_type,
  payout_amount_cents, created_at, updated_at, currency, offer_type, booking_url, sort_order, removed_at)
  on public.club_deals from public, anon, authenticated;
grant select (id, venue_id, deal_title, deal_description, deal_terms, is_active,
  valid_days, valid_start_time, valid_end_time, offer_type, booking_url, sort_order)
  on public.club_deals to anon, authenticated;

do $guard$
declare role_name text; column_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_table_privilege(role_name, 'public.club_deals', 'SELECT')
    then raise exception 'PUBLIC_DEAL_TABLE_SELECT_REMAINS'; end if;
    foreach column_name in array array['redemption_rules','payout_type','payout_amount_cents',
      'currency','created_at','updated_at','removed_at'] loop
      if has_column_privilege(role_name, 'public.club_deals', column_name, 'SELECT')
      then raise exception 'PUBLIC_DEAL_PRIVATE_COLUMN_ACCESS_REMAINS'; end if;
    end loop;
  end loop;
  if not has_table_privilege('service_role', 'public.club_deals', 'SELECT')
  then raise exception 'PUBLIC_DEAL_SERVER_SELECT_REQUIRED'; end if;
end
$guard$;
commit;
