begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- One independent email receipt for each newly queued staff event. Do not
-- backfill old requests or change any recipient's notification preferences.
create table public.internal_request_email_deliveries (
  id uuid primary key references public.internal_request_push_deliveries(id) on delete cascade,
  table_label text not null,
  stage_name text not null,
  venue_name text not null,
  state text not null default 'pending' check (state in ('pending','sending','sent','skipped','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index internal_request_email_due on public.internal_request_email_deliveries(available_at,id)
  where state in ('pending','sending');
alter table public.internal_request_email_deliveries enable row level security;
revoke all on public.internal_request_email_deliveries from public,anon,authenticated;
grant all on public.internal_request_email_deliveries to service_role;

create function public.queue_internal_request_email() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.internal_request_email_deliveries(id,table_label,stage_name,venue_name)
  select new.id,l.label,d.stage_name,v.name
  from public.internal_roster_requests r
  join public.internal_roster_links l on l.id=r.link_id and l.venue_id=r.venue_id
  join public.dancer_profiles d on d.id=r.dancer_id
  join public.venues v on v.id=r.venue_id
  where r.id=new.request_id
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.queue_internal_request_email() from public,anon,authenticated,service_role;
create trigger queue_internal_request_email after insert on public.internal_request_push_deliveries
  for each row execute function public.queue_internal_request_email();

create function public.claim_internal_request_emails(p_request_id uuid default null,p_limit integer default 4,p_event_kind text default null)
returns table(id uuid,lease_id uuid,recipient_id uuid,table_label text,stage_name text,venue_name text,event_kind text)
language plpgsql security invoker set search_path = '' as $$
declare job public.internal_request_email_deliveries; source public.internal_request_push_deliveries;
  req public.internal_roster_requests; eligible boolean;
begin
  if p_event_kind is not null and p_event_kind not in ('requested','cancelled') then
    raise exception 'INVALID_EVENT' using errcode='22023';
  end if;
  for job in select q.* from public.internal_request_email_deliveries q
    join public.internal_request_push_deliveries s on s.id=q.id
    where (p_request_id is null or s.request_id=p_request_id)
      and (p_event_kind is null or s.event_kind=p_event_kind)
      and ((q.state='pending' and q.available_at<=now()) or (q.state='sending' and q.lease_until<=now()))
    order by q.available_at,q.id for update of q skip locked limit greatest(1,least(coalesce(p_limit,4),4))
  loop
    select * into source from public.internal_request_push_deliveries s where s.id=job.id;
    select * into req from public.internal_roster_requests r where r.id=source.request_id;
    if source.event_kind='requested' then
      eligible:=req.status in ('pending','acknowledged') and req.created_at>now()-interval '10 minutes'
        and exists(select 1 from public.internal_roster_members(req.venue_id) m where m.id=req.dancer_id);
    else
      eligible:=req.status='cancelled' and job.created_at>now()-interval '10 minutes';
    end if;
    if not coalesce(eligible,false)
      or not exists(select 1 from public.internal_roster_links l where l.id=req.link_id and l.venue_id=req.venue_id and l.active and l.kind='table')
      or not exists(select 1 from public.venues v where v.id=req.venue_id and v.is_active)
      or not public.internal_roster_access(source.recipient_id,req.venue_id) then
      update public.internal_request_email_deliveries q set state='skipped',finished_at=now(),lease_id=null,lease_until=null where q.id=job.id;
    elsif job.attempts>=5 then
      update public.internal_request_email_deliveries q set state='failed',finished_at=now(),lease_id=null,lease_until=null where q.id=job.id;
    else
      update public.internal_request_email_deliveries q set state='sending',attempts=q.attempts+1,
        lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' where q.id=job.id returning q.* into job;
      id:=job.id; lease_id:=job.lease_id; recipient_id:=source.recipient_id;
      table_label:=job.table_label; stage_name:=job.stage_name; venue_name:=job.venue_name; event_kind:=source.event_kind;
      return next;
    end if;
  end loop;
end;
$$;

create function public.finish_internal_request_email(p_id uuid,p_lease_id uuid,p_outcome text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_outcome is null or p_outcome not in ('sent','skipped','retry') then raise exception 'INVALID_OUTCOME' using errcode='22023'; end if;
  update public.internal_request_email_deliveries q set
    state=case when p_outcome='retry' then case when q.attempts>=5 then 'failed' else 'pending' end else p_outcome end,
    available_at=now()+make_interval(secs=>least(240,15*(2^q.attempts)::integer)),
    finished_at=case when p_outcome<>'retry' or q.attempts>=5 then now() else null end,
    lease_id=null,lease_until=null
  where q.id=p_id and q.state='sending' and q.lease_id=p_lease_id and q.lease_until>now();
  return found;
end;
$$;
revoke all on function public.claim_internal_request_emails(uuid,integer,text),public.finish_internal_request_email(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_internal_request_emails(uuid,integer,text),public.finish_internal_request_email(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
