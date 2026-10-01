begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Keep existing request deliveries and IDs. Cancellation is a separate event.
alter table public.internal_request_push_deliveries
  add column event_kind text not null default 'requested'
    check (event_kind in ('requested','cancelled'));
alter table public.internal_request_push_deliveries
  drop constraint internal_request_push_deliveries_request_id_recipient_id_key,
  add constraint internal_request_push_event_recipient_key unique(request_id,recipient_id,event_kind);

-- The API has already authorized this table capability. Recheck its live scope
-- under the same lock order as request creation/revocation before changing it.
create function public.cancel_internal_roster_request(p_venue_id uuid,p_link_id uuid,p_dancer_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare req public.internal_roster_requests; link public.internal_roster_links; dancer_name text;
begin
  select * into link from public.internal_roster_links l
    where l.id=p_link_id and l.venue_id=p_venue_id and l.active and l.kind='table' for update;
  if not found or not exists(
    select 1 from public.venues v join public.app_users u on u.id=v.owner_user_id
    where v.id=p_venue_id and v.is_active and u.role='venue' and u.account_state='active'
  ) then raise exception 'TABLE_UNAVAILABLE' using errcode='42501'; end if;
  select * into req from public.internal_roster_requests r
    where r.id=p_request_id and r.venue_id=p_venue_id and r.link_id=p_link_id and r.dancer_id=p_dancer_id for update;
  if not found or req.status not in ('pending','acknowledged','cancelled') then
    raise exception 'REQUEST_CHANGED' using errcode='40001';
  end if;
  if req.status='cancelled' then return jsonb_build_object('id',req.id,'status','cancelled'); end if;
  update public.internal_roster_requests set status='cancelled',updated_at=clock_timestamp() where id=req.id;
  select stage_name into dancer_name from public.dancer_profiles where id=p_dancer_id;
  with queued as (
    insert into public.internal_request_push_deliveries(request_id,recipient_id,event_kind)
    select req.id,u.id,'cancelled' from public.app_users u
    where u.role='venue' and u.account_state='active' and public.internal_roster_access(u.id,p_venue_id)
    on conflict(request_id,recipient_id,event_kind) do nothing
    returning id,recipient_id
  )
  insert into public.notifications(id,recipient_id,notification_type,title,body,payload)
  select q.id,q.recipient_id,'support_message','Table request cancelled',
    link.label || ' cancelled the request for ' || dancer_name || '.',
    jsonb_build_object('kind','internal_table_request','event','cancelled') from queued q;
  return jsonb_build_object('id',req.id,'status','cancelled');
end;
$$;

create function public.claim_internal_request_alerts(p_request_id uuid default null,p_limit integer default 4,p_event_kind text default null)
returns table(id uuid,lease_id uuid,recipient_id uuid,table_label text,stage_name text,event_kind text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare job public.internal_request_push_deliveries; req public.internal_roster_requests; label text; dancer_name text; eligible boolean;
begin
  if p_event_kind is not null and p_event_kind not in ('requested','cancelled') then
    raise exception 'INVALID_EVENT' using errcode='22023';
  end if;
  for job in select q.* from public.internal_request_push_deliveries q
    where (p_request_id is null or q.request_id=p_request_id)
      and (p_event_kind is null or q.event_kind=p_event_kind)
      and ((q.state='pending' and q.available_at<=now()) or (q.state='sending' and q.lease_until<=now()))
    order by q.available_at,q.id for update skip locked limit greatest(1,least(coalesce(p_limit,4),4))
  loop
    select * into req from public.internal_roster_requests r where r.id=job.request_id;
    label:=null; dancer_name:=null;
    select l.label into label from public.internal_roster_links l where l.id=req.link_id and l.active and l.kind='table';
    if job.event_kind='requested' then
      select m.stage_name into dancer_name from public.internal_roster_members(req.venue_id) m where m.id=req.dancer_id;
      eligible:=req.status='pending' and req.created_at>now()-interval '10 minutes';
    else
      select d.stage_name into dancer_name from public.dancer_profiles d where d.id=req.dancer_id;
      eligible:=req.status='cancelled' and job.created_at>now()-interval '10 minutes';
    end if;
    if not coalesce(eligible,false) or label is null or dancer_name is null
      or not public.internal_roster_access(job.recipient_id,req.venue_id) then
      update public.internal_request_push_deliveries q set state='skipped',finished_at=now(),lease_id=null,lease_until=null where q.id=job.id;
    elsif job.attempts>=5 then
      update public.internal_request_push_deliveries q set state='failed',finished_at=now(),lease_id=null,lease_until=null where q.id=job.id;
    else
      update public.internal_request_push_deliveries q set state='sending',attempts=q.attempts+1,
        lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' where q.id=job.id returning q.* into job;
      id:=job.id; lease_id:=job.lease_id; recipient_id:=job.recipient_id; table_label:=label; stage_name:=dancer_name; event_kind:=job.event_kind;
      return next;
    end if;
  end loop;
end;
$$;

-- During rollout the old application must never send a cancellation as a request.
create or replace function public.claim_internal_request_push(p_request_id uuid default null,p_limit integer default 12)
returns table(id uuid,lease_id uuid,recipient_id uuid,table_label text,stage_name text)
language sql security definer set search_path = public, pg_temp as $$
  select a.id,a.lease_id,a.recipient_id,a.table_label,a.stage_name
  from public.claim_internal_request_alerts(p_request_id,p_limit,'requested') a;
$$;
revoke all on function public.cancel_internal_roster_request(uuid,uuid,uuid,uuid),
  public.claim_internal_request_alerts(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.cancel_internal_roster_request(uuid,uuid,uuid,uuid),
  public.claim_internal_request_alerts(uuid,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
