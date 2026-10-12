begin;
set local lock_timeout = '3s';

alter table public.club_shuttle_requests
  add column staff_status text not null default 'received' check (staff_status in ('received','contacted','arranged','completed','cancelled')),
  add column staff_status_version integer not null default 0,
  add column staff_updated_at timestamptz,
  add column staff_updated_by uuid references public.app_users(id) on delete set null;
grant update (staff_status,staff_status_version,staff_updated_at,staff_updated_by) on public.club_shuttle_requests to service_role;
create index club_shuttle_requests_open_queue on public.club_shuttle_requests(venue_id,created_at desc) where staff_status in ('received','contacted','arranged');

create table public.venue_ride_status_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.club_shuttle_requests(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  actor_id uuid references public.app_users(id) on delete set null,
  status text not null check (status in ('received','contacted','arranged','completed','cancelled')),
  created_at timestamptz not null default now()
);
create index venue_ride_status_events_request on public.venue_ride_status_events(request_id,created_at);
alter table public.venue_ride_status_events enable row level security;
revoke all on public.venue_ride_status_events from public,anon,authenticated;
grant select,insert on public.venue_ride_status_events to service_role;
grant usage,select on sequence public.venue_ride_status_events_id_seq to service_role;

create function public.set_venue_ride_status(p_actor uuid,p_venue uuid,p_request uuid,p_status text,p_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare updated public.club_shuttle_requests%rowtype;
begin
  if not exists(select 1 from public.app_users u where u.id=p_actor and u.role='venue' and u.account_state='active')
    or not exists(select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id and owner.account_state='active'
      where v.id=p_venue and (v.owner_user_id=p_actor or exists(select 1 from public.venue_team_members t where t.venue_id=v.id and t.user_id=p_actor and t.role='manager' and t.status='active')))
    then raise exception 'Venue manager access required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('received','contacted','arranged','completed','cancelled') or p_version is null or p_version<0 then
    raise exception 'Invalid ride status' using errcode='22023'; end if;
  update public.club_shuttle_requests set staff_status=p_status,staff_status_version=staff_status_version+1,staff_updated_at=now(),staff_updated_by=p_actor
    where id=p_request and venue_id=p_venue and staff_status_version=p_version returning * into updated;
  if not found then raise exception 'Ride changed or unavailable' using errcode='40001'; end if;
  insert into public.venue_ride_status_events(request_id,venue_id,actor_id,status) values(p_request,p_venue,p_actor,p_status);
  return jsonb_build_object('id',updated.id,'staff_status',updated.staff_status,'staff_status_version',updated.staff_status_version,'staff_updated_at',updated.staff_updated_at);
end $$;
revoke all on function public.set_venue_ride_status(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.set_venue_ride_status(uuid,uuid,uuid,text,integer) to service_role;

create function public.get_venue_operations(p_venue uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'vipPending',(select count(*) from public.venue_vip_requests where venue_id=p_venue and status='pending'),
    'tablePending',(select count(*) from public.internal_roster_requests where venue_id=p_venue and status='pending' and created_at>=now()-interval '6 hours'),
    'guestExpected',(select count(*) from public.venue_guest_list_entries g join public.qr_redemptions q on q.id=g.pass_id and q.venue_id=g.venue_id where g.venue_id=p_venue and q.status='generated' and q.expires_at>now()),
    'admitted',(select count(*) from public.qr_redemptions where venue_id=p_venue and admission_pass_version=1 and status='redeemed' and redeemed_at>=p_since and redeemed_at<p_until),
    'ridesOpen',(select count(*) from public.club_shuttle_requests where venue_id=p_venue and staff_status in ('received','contacted','arranged') and created_at>=now()-interval '48 hours'),
    'teamReady',exists(select 1 from public.venue_team_members where venue_id=p_venue and status='active'),
    'checkInReady',exists(select 1 from public.nfc_tags where venue_id=p_venue and tag_type='dressing_room' and status='active')
  );
$$;
revoke all on function public.get_venue_operations(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_operations(uuid,timestamptz,timestamptz) to service_role;

create function public.search_venue_guests(p_venue uuid,p_search text,p_status text,p_since timestamptz,p_offset integer)
returns table(id uuid,name text,phone text,email text,created_at timestamptz,expires_at timestamptz,arrival_method text,status text,redeemed_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_search is null or length(p_search)>100 or p_status not in ('all','generated','redeemed') or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception 'Invalid guest search' using errcode='22023'; end if;
  return query select g.pass_id,g.guest_name,g.phone,g.email,g.created_at,q.expires_at,q.arrival_method,q.status,q.redeemed_at
  from public.venue_guest_list_entries g join public.qr_redemptions q on q.id=g.pass_id and q.venue_id=g.venue_id
  where g.venue_id=p_venue and q.expires_at>now() and q.status in ('generated','redeemed')
    and (p_status='all' or q.status=p_status) and (p_since is null or g.created_at>=p_since)
    and (p_search='' or strpos(lower(concat_ws(' ',g.guest_name,g.phone,g.email)),lower(p_search))>0)
  order by g.created_at desc,g.pass_id limit 51 offset p_offset;
end $$;
revoke all on function public.search_venue_guests(uuid,text,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.search_venue_guests(uuid,text,text,timestamptz,integer) to service_role;

create function public.search_venue_customers(p_venue_id uuid,p_source text default 'all',p_offset integer default 0,p_search text default '')
returns table(id text,name text,email text,phone text,city text,joined_at timestamptz,is_follower boolean,is_guest boolean)
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_search is null or length(p_search)>100 or p_source is null or p_source not in ('all','followers','guests') or p_offset is null or p_offset<0 or p_offset>100000 then
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
  where (p_source='all' or (p_source='followers' and c.is_follower) or (p_source='guests' and c.is_guest))
    and (p_search='' or strpos(lower(c.name),lower(p_search))>0)
  order by c.joined_at desc,c.key
  limit 51 offset p_offset;
end;
$$;
revoke all on function public.search_venue_customers(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.search_venue_customers(uuid,text,integer,text) to service_role;

commit;
