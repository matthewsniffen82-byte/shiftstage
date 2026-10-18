begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Separate channel receipts prevent an unsuccessful push from resending email.
create table public.dancer_table_request_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.internal_roster_requests(id) on delete cascade,
  recipient_id uuid not null references public.app_users(id) on delete cascade,
  channel text not null check (channel in ('email','push')),
  table_label text not null,
  venue_name text not null,
  state text not null default 'pending' check (state in ('pending','sending','sent','skipped','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (request_id,recipient_id,channel)
);
create index dancer_table_request_deliveries_due on public.dancer_table_request_deliveries(available_at,id)
  where state in ('pending','sending');
create index dancer_table_request_deliveries_recipient on public.dancer_table_request_deliveries(recipient_id);
alter table public.dancer_table_request_deliveries enable row level security;
revoke all on public.dancer_table_request_deliveries from public,anon,authenticated;
grant all on public.dancer_table_request_deliveries to service_role;

create function public.queue_dancer_table_request_alerts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dancer_user uuid; label text; club_name text;
begin
  if tg_op='UPDATE' then
    if new.status in ('cancelled','completed') and old.status is distinct from new.status then
      update public.notifications n set
        title=case when new.status='cancelled' then 'Table request cancelled' else 'Table request completed' end,
        body=q.table_label || ' at ' || q.venue_name || case when new.status='cancelled' then ' cancelled the request.' else ': club staff marked your request completed.' end,
        payload=n.payload || jsonb_build_object('status',new.status)
      from public.dancer_table_request_deliveries q
      where q.request_id=new.id and q.channel='push' and n.id=q.id and n.recipient_id=q.recipient_id;
    end if;
    return new;
  end if;
  select d.user_id,l.label,v.name into dancer_user,label,club_name
  from public.dancer_profiles d join public.app_users u on u.id=d.user_id
  join public.internal_roster_links l on l.id=new.link_id and l.venue_id=new.venue_id
  join public.venues v on v.id=new.venue_id
  where d.id=new.dancer_id and u.role='dancer' and u.account_state='active'
    and l.active and l.kind='table' and v.is_active;
  if dancer_user is null or new.status<>'pending' then return new; end if;
  with queued as (
    insert into public.dancer_table_request_deliveries(request_id,recipient_id,channel,table_label,venue_name)
    select new.id,dancer_user,c,label,club_name from unnest(array['email','push']) c
    on conflict (request_id,recipient_id,channel) do nothing returning id,channel
  )
  insert into public.notifications(id,recipient_id,notification_type,title,body,payload)
  select q.id,dancer_user,'support_message','New table request',
    label || ' at ' || club_name || ' requested you. Check with club staff for the current status.',
    jsonb_build_object('kind','dancer_table_request','requestId',new.id,'venueId',new.venue_id,'tableLabel',label,'status',new.status)
  from queued q where q.channel='push';
  return new;
end;
$$;
revoke all on function public.queue_dancer_table_request_alerts() from public,anon,authenticated,service_role;
create trigger queue_dancer_table_request_alerts after insert or update of status on public.internal_roster_requests
  for each row execute function public.queue_dancer_table_request_alerts();

create function public.claim_dancer_table_request_alerts(p_request_id uuid default null,p_limit integer default 4,p_channels text[] default array['email','push'])
returns table(id uuid,lease_id uuid,recipient_id uuid,channel text,table_label text,venue_name text)
language plpgsql security invoker set search_path = '' as $$
declare job public.dancer_table_request_deliveries; req public.internal_roster_requests;
begin
  if p_channels is null or not p_channels <@ array['email','push']::text[] then
    raise exception 'INVALID_CHANNELS' using errcode='22023';
  end if;
  for job in select q.* from public.dancer_table_request_deliveries q
    where (p_request_id is null or q.request_id=p_request_id) and q.channel=any(p_channels)
      and ((q.state='pending' and q.available_at<=now()) or (q.state='sending' and q.lease_until<=now()))
    order by q.available_at,q.id for update skip locked limit greatest(1,least(coalesce(p_limit,4),4))
  loop
    select * into req from public.internal_roster_requests r where r.id=job.request_id;
    if req.status not in ('pending','acknowledged') or req.created_at<=now()-interval '10 minutes'
      or not exists(select 1 from public.dancer_profiles d join public.app_users u on u.id=d.user_id
        where d.id=req.dancer_id and d.user_id=job.recipient_id and u.role='dancer' and u.account_state='active')
      or not exists(select 1 from public.internal_roster_links l where l.id=req.link_id and l.venue_id=req.venue_id and l.active and l.kind='table')
      or not exists(select 1 from public.internal_roster_members(req.venue_id) m where m.id=req.dancer_id) then
      update public.dancer_table_request_deliveries q set state='skipped',finished_at=now(),lease_id=null,lease_until=null where q.id=job.id;
    elsif job.attempts>=5 then
      update public.dancer_table_request_deliveries q set state='failed',finished_at=now(),lease_id=null,lease_until=null where q.id=job.id;
    else
      update public.dancer_table_request_deliveries q set state='sending',attempts=q.attempts+1,
        lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' where q.id=job.id returning q.* into job;
      id:=job.id; lease_id:=job.lease_id; recipient_id:=job.recipient_id; channel:=job.channel;
      table_label:=job.table_label; venue_name:=job.venue_name;
      return next;
    end if;
  end loop;
end;
$$;

create function public.finish_dancer_table_request_alert(p_id uuid,p_lease_id uuid,p_outcome text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_outcome not in ('sent','skipped','retry') or p_outcome is null then
    raise exception 'INVALID_OUTCOME' using errcode='22023';
  end if;
  update public.dancer_table_request_deliveries q set
    state=case when p_outcome<>'retry' then p_outcome when q.attempts>=5 then 'failed' else 'pending' end,
    finished_at=case when p_outcome<>'retry' or q.attempts>=5 then now() else null end,
    available_at=now()+make_interval(secs=>least(240,15*power(2,q.attempts)::integer)),
    lease_id=null,lease_until=null
  where q.id=p_id and q.lease_id=p_lease_id and q.state='sending' and q.lease_until>now();
  return found;
end;
$$;
revoke all on function public.claim_dancer_table_request_alerts(uuid,integer,text[]),public.finish_dancer_table_request_alert(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_dancer_table_request_alerts(uuid,integer,text[]),public.finish_dancer_table_request_alert(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
