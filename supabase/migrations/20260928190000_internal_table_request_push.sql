begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Queue only new table requests, in the same transaction as the request.
-- No guest capability, phone number, or copied profile is stored here.
create table public.internal_request_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.internal_roster_requests(id) on delete cascade,
  recipient_id uuid not null references public.app_users(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','sending','sent','skipped','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(request_id,recipient_id)
);
create index internal_request_push_due on public.internal_request_push_deliveries(available_at)
  where state in ('pending','sending');
alter table public.internal_request_push_deliveries enable row level security;
revoke all on public.internal_request_push_deliveries from public,anon,authenticated;
grant all on public.internal_request_push_deliveries to service_role;

create function public.queue_internal_request_push() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.internal_request_push_deliveries(request_id,recipient_id)
  select new.id,u.id from public.app_users u
  where u.role='venue' and u.account_state='active'
    and (u.id=(select owner_user_id from public.venues where id=new.venue_id)
      or exists(select 1 from public.venue_team_members m where m.venue_id=new.venue_id
        and m.user_id=u.id and m.status='active' and m.role in ('manager','staff')));
  return new;
end;
$$;
revoke all on function public.queue_internal_request_push() from public,anon,authenticated,service_role;
create trigger queue_internal_request_push after insert on public.internal_roster_requests
for each row execute function public.queue_internal_request_push();

create function public.claim_internal_request_push(p_request_id uuid default null,p_limit integer default 12)
returns table(id uuid,lease_id uuid,recipient_id uuid,table_label text,stage_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare job public.internal_request_push_deliveries; req public.internal_roster_requests; label text; dancer_name text;
begin
  for job in select q.* from public.internal_request_push_deliveries q
    where (p_request_id is null or q.request_id=p_request_id)
      and ((q.state='pending' and q.available_at<=now()) or (q.state='sending' and q.lease_until<=now()))
    order by q.available_at,q.id for update skip locked limit greatest(1,least(coalesce(p_limit,12),50))
  loop
    select * into req from public.internal_roster_requests where internal_roster_requests.id=job.request_id;
    label:=null; dancer_name:=null;
    select l.label into label from public.internal_roster_links l where l.id=req.link_id and l.active and l.kind='table';
    select m.stage_name into dancer_name from public.internal_roster_members(req.venue_id) m where m.id=req.dancer_id;
    if req.status is distinct from 'pending' or req.created_at<=now()-interval '10 minutes'
      or label is null or dancer_name is null or not public.internal_roster_access(job.recipient_id,req.venue_id) then
      update public.internal_request_push_deliveries q set state='skipped',finished_at=now(),lease_id=null,lease_until=null where q.id=job.id;
    elsif job.attempts>=5 then
      update public.internal_request_push_deliveries q set state='failed',finished_at=now(),lease_id=null,lease_until=null where q.id=job.id;
    else
      update public.internal_request_push_deliveries q set state='sending',attempts=q.attempts+1,
        lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' where q.id=job.id returning q.* into job;
      id:=job.id; lease_id:=job.lease_id; recipient_id:=job.recipient_id; table_label:=label; stage_name:=dancer_name;
      return next;
    end if;
  end loop;
end;
$$;

create function public.finish_internal_request_push(p_id uuid,p_lease_id uuid,p_outcome text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_outcome is null or p_outcome not in ('sent','skipped','retry') then raise exception 'INVALID_OUTCOME' using errcode='22023'; end if;
  update public.internal_request_push_deliveries q set
    state=case when p_outcome='retry' then case when q.attempts>=5 then 'failed' else 'pending' end else p_outcome end,
    available_at=now()+make_interval(secs=>least(240,15*(2^q.attempts)::integer)),
    finished_at=case when p_outcome<>'retry' or q.attempts>=5 then now() else null end,
    lease_id=null,lease_until=null
  where q.id=p_id and q.state='sending' and q.lease_id=p_lease_id and q.lease_until>now();
  return found;
end;
$$;
revoke all on function public.claim_internal_request_push(uuid,integer),public.finish_internal_request_push(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_internal_request_push(uuid,integer),public.finish_internal_request_push(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
