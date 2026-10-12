begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- A management link proves access to an existing preference, never new consent.
create table public.customer_update_links (
  customer_id uuid not null references public.app_users(id) on delete cascade,
  subscription_id uuid not null references public.venue_update_subscriptions(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key(customer_id,subscription_id)
);
create index customer_update_links_subscription on public.customer_update_links(subscription_id);
create index venue_update_subscriptions_contact on public.venue_update_subscriptions(channel,destination,venue_id);
alter table public.customer_update_links enable row level security;
revoke all on public.customer_update_links from public,anon,authenticated;
grant select,insert,delete on public.customer_update_links to service_role;

-- Server-only: email/phone must come from freshly verified Auth user fields.
-- An authenticated pass owner already received its private management links.
create function public.customer_accessible_updates(p_customer_id uuid,p_email text,p_phone text)
returns table(id uuid,venue_id uuid,channel text,destination text,consented_at timestamptz,withdrawn_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select s.id,s.venue_id,s.channel,s.destination,s.consented_at,s.withdrawn_at
  from public.venue_update_subscriptions s
  where exists(select 1 from public.app_users u where u.id=p_customer_id and u.role='customer' and u.account_state='active')
  and (
    (s.channel='email' and s.destination=nullif(lower(trim(p_email)),''))
    or (s.channel='text' and s.destination=nullif(p_phone,''))
    or exists(select 1 from public.customer_update_links l where l.customer_id=p_customer_id and l.subscription_id=s.id)
    or exists(select 1 from public.venue_update_consent_events e join public.qr_redemptions r on r.id=e.source_id
      where e.subscription_id=s.id and e.source='guest_list' and r.customer_id=p_customer_id and r.venue_id=s.venue_id)
  );
$$;

create function public.get_customer_club_privacy(p_customer_id uuid,p_email text,p_phone text,p_offset integer default 0)
returns table(venue_id uuid,venue_name text,share jsonb,subscriptions jsonb)
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid page' using errcode='22023'; end if;
  return query
  with updates as materialized (select * from public.customer_accessible_updates(p_customer_id,p_email,p_phone)),
  shares as (select s.* from public.venue_customer_shares s join public.app_users u on u.id=s.customer_id
    where s.customer_id=p_customer_id and u.role='customer' and u.account_state='active'),
  clubs as (select s.venue_id from shares s union select s.venue_id from updates s)
  select v.id,v.name,
    (select jsonb_build_object('name',s.name,'email',s.email,'city',s.city,'consentedAt',s.consented_at) from shares s where s.venue_id=v.id),
    coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'channel',s.channel,'destination',s.destination,
      'consentedAt',s.consented_at,'withdrawnAt',s.withdrawn_at) order by s.channel,s.id) from updates s where s.venue_id=v.id),'[]'::jsonb)
  from clubs c join public.venues v on v.id=c.venue_id
  order by v.name,v.id limit 21 offset p_offset;
end $$;

create function public.stop_customer_club_update(p_customer_id uuid,p_email text,p_phone text,p_subscription_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  update public.venue_update_subscriptions s set withdrawn_at=coalesce(s.withdrawn_at,now())
    where s.id=p_subscription_id and s.id in (select a.id from public.customer_accessible_updates(p_customer_id,p_email,p_phone) a);
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.customer_accessible_updates(uuid,text,text),public.get_customer_club_privacy(uuid,text,text,integer),public.stop_customer_club_update(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.customer_accessible_updates(uuid,text,text),public.get_customer_club_privacy(uuid,text,text,integer),public.stop_customer_club_update(uuid,text,text,uuid) to service_role;
commit;
