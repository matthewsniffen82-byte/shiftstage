begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- No backfill: following alone never authorizes disclosure of contact details.
create table public.venue_customer_shares (
  customer_id uuid not null,
  venue_id uuid not null,
  name text not null check (char_length(name) between 2 and 100 and name !~ '[[:cntrl:]]'),
  email text not null check (char_length(email)<=254 and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
  city text not null default '' check (char_length(city)<=100 and city !~ '[[:cntrl:]]'),
  consent_version text not null check (consent_version='venue-customer-sharing-v1'),
  consented_at timestamptz not null default now(),
  primary key (customer_id,venue_id),
  foreign key (customer_id,venue_id) references public.venue_follows(customer_id,venue_id) on delete cascade
);
create index venue_customer_shares_recent on public.venue_customer_shares(venue_id,consented_at desc,customer_id);
alter table public.venue_customer_shares enable row level security;
revoke all on public.venue_customer_shares from public,anon,authenticated;
grant select,insert,update,delete on public.venue_customer_shares to service_role;

-- Contact data is returned only through the authorized server route.
-- Guest-list permission remains limited to active visits, never a marketing list.
create function public.get_venue_customers(p_venue_id uuid,p_source text default 'all',p_offset integer default 0)
returns table(id text,name text,email text,phone text,city text,joined_at timestamptz,is_follower boolean,is_guest boolean)
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_source is null or p_source not in ('all','followers','guests') or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception 'Invalid customer list page' using errcode='22023';
  end if;
  return query
  with followers as (
    select 'customer:'||s.customer_id::text as key,s.name,s.email,s.city,s.consented_at
    from public.venue_customer_shares s join public.app_users u on u.id=s.customer_id
    where s.venue_id=p_venue_id and u.role='customer' and u.account_state='active'
  ), guests as (
    select distinct on (coalesce('customer:'||r.customer_id::text,'guest:'||g.phone))
      coalesce('customer:'||r.customer_id::text,'guest:'||g.phone) as key,
      g.guest_name,g.email,g.phone,g.created_at
    from public.venue_guest_list_entries g join public.qr_redemptions r on r.id=g.pass_id
    left join public.app_users u on u.id=r.customer_id
    where g.venue_id=p_venue_id and r.venue_id=p_venue_id
      and r.status in ('generated','redeemed') and r.expires_at>now()
      and (r.customer_id is null or u.account_state='active')
    order by coalesce('customer:'||r.customer_id::text,'guest:'||g.phone),g.created_at desc,g.pass_id
  ), combined as (
    select coalesce(f.key,g.key) as key,coalesce(f.name,g.guest_name) as name,
      coalesce(f.email,g.email) as email,g.phone,coalesce(f.city,'') as city,
      greatest(f.consented_at,g.created_at) as joined_at,
      f.key is not null as is_follower,g.key is not null as is_guest
    from followers f full join guests g on g.key=f.key
  )
  select c.key,c.name,c.email,c.phone,c.city,c.joined_at,c.is_follower,c.is_guest
  from combined c
  where p_source='all' or (p_source='followers' and c.is_follower) or (p_source='guests' and c.is_guest)
  order by c.joined_at desc,c.key
  limit 51 offset p_offset;
end;
$$;
revoke all on function public.get_venue_customers(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.get_venue_customers(uuid,text,integer) to service_role;
commit;
