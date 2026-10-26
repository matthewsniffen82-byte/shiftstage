-- Pilot and subscription offers do not require per-redemption referral payouts.
-- Keep the approved admission catalog and existing synthetic demo exception.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.has_active_club_deal(public.venues) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.club_deals d where d.venue_id=$1.id and d.is_active
   and d.offer_type='admission'
   and d.deal_title in ('Half-off admission','Skip the line','Free admission'))
 or ($1.slug='spearmint-rhino-las-vegas-demo' and exists(
   select 1 from auth.users manager where manager.id=$1.owner_user_id
     and manager.email='spearmint-rhino-las-vegas-demo@synthetic.mydancr.invalid'
     and manager.raw_app_meta_data->>'dataset_marker'='mydancr-spearmint-rhino-las-vegas-demo-v1'
     and manager.banned_until>now()));
$$;

revoke all on function public.has_active_club_deal(public.venues) from public;
grant execute on function public.has_active_club_deal(public.venues) to anon, authenticated, service_role;
notify pgrst,'reload schema';
commit;
