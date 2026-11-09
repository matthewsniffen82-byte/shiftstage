create table private.venue_email_preparation (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  failures integer not null default 0
);
create index venue_email_preparation_due on private.venue_email_preparation(next_attempt_at,venue_id);
revoke all on private.venue_email_preparation from public,anon,authenticated;
grant select,insert,update on private.venue_email_preparation to service_role;

create function private.schedule_new_venue_email_preparation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.venue_email_preparation(venue_id) values(new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function private.schedule_new_venue_email_preparation() from public,anon,authenticated;
create trigger schedule_new_venue_email_preparation after insert on public.venues
for each row execute function private.schedule_new_venue_email_preparation();
insert into private.venue_email_preparation(venue_id) select id from public.venues on conflict do nothing;

-- Commit the retry time before doing work so a timeout at one club cannot
-- monopolize the next claim. The lease token fences stale workers.
create function public.claim_venue_email_preparation() returns table(venue_id uuid,lease_id uuid)
language sql volatile security invoker set search_path='' as $$
  with due as (
    select j.venue_id from private.venue_email_preparation j
    join public.venues v on v.id=j.venue_id and v.is_active
    join public.app_users a on a.id=v.owner_user_id and a.role='venue' and a.account_state='active'
    where j.next_attempt_at<=now() order by j.next_attempt_at,j.venue_id
    limit 4 for update of j skip locked
  )
  update private.venue_email_preparation j set lease_id=gen_random_uuid(),
    next_attempt_at=now()+interval '1 minute'*least(60,power(2,least(j.failures,6))::integer),
    failures=least(j.failures+1,7)
  from due where j.venue_id=due.venue_id returning j.venue_id,j.lease_id
$$;

create function public.prepare_club_email_alerts(p_venue uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from private.venue_email_preparation where venue_id=p_venue and lease_id=p_lease for update;
  if not found then return false; end if;
  if exists (select 1 from public.venues v join public.app_users a on a.id=v.owner_user_id
    where v.id=p_venue and v.is_active and a.role='venue' and a.account_state='active') then
    perform private.attach_media_batches(p_venue,null);
    perform private.prepare_venue_weekly_summary(p_venue);
  end if;
  update private.venue_email_preparation set lease_id=null,failures=0,next_attempt_at=now()+interval '1 minute'
    where venue_id=p_venue;
  return true;
end $$;
revoke all on function public.claim_venue_email_preparation(), public.prepare_club_email_alerts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_venue_email_preparation(), public.prepare_club_email_alerts(uuid,uuid) to service_role;

-- Keep callers from an earlier release compatible during rollout. The hourly
-- lifecycle retention rule already handles terminal receipts older than 30 days.
create or replace function public.prepare_venue_email_alerts() returns void
language plpgsql security invoker set search_path='' as $$
declare job record;
begin
  for job in select * from public.claim_venue_email_preparation() loop
    begin
      perform public.prepare_club_email_alerts(job.venue_id,job.lease_id);
    exception when others then
      raise warning 'Club email preparation deferred (%)',sqlstate;
    end;
  end loop;
end $$;
