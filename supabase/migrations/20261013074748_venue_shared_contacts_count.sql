begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Match the unfiltered shared-contact directory without its 51-row page limit.
-- Following alone grants no access; guest details remain limited to active visits.
create function public.count_venue_customers(p_venue_id uuid)
returns bigint
language sql stable security invoker set search_path = '' as $$
  select count(*) from (
    select 'customer:' || s.customer_id::text as contact_key
    from public.venue_customer_shares s
    join public.app_users u on u.id = s.customer_id
    where s.venue_id = p_venue_id and u.role = 'customer' and u.account_state = 'active'
    union
    select coalesce('customer:' || r.customer_id::text, 'guest:' || g.phone) as contact_key
    from public.venue_guest_list_entries g
    join public.qr_redemptions r on r.id = g.pass_id
    left join public.app_users u on u.id = r.customer_id
    where g.venue_id = p_venue_id and r.venue_id = p_venue_id
      and r.status in ('generated', 'redeemed') and r.expires_at > now()
      and (r.customer_id is null or u.account_state = 'active')
  ) contacts;
$$;
revoke all on function public.count_venue_customers(uuid) from public, anon, authenticated;
grant execute on function public.count_venue_customers(uuid) to service_role;
commit;
