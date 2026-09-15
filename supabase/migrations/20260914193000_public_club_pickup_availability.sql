begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- A public availability boolean, computed from the real row rather than any
-- client-supplied composite fields. No owner IDs or private pickup data are exposed.
create function public.club_pickup_available(public.venues) returns boolean language sql stable security definer
set search_path=pg_catalog,public as $$
  select exists(select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id
    where v.id=($1).id and v.club_pickup_enabled and v.is_active and v.page_review_status='published'
    and v.published_at is not null and owner.role='venue' and owner.account_state='active')
$$;
revoke all on function public.club_pickup_available(public.venues) from public,anon,authenticated,service_role;
grant execute on function public.club_pickup_available(public.venues) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
