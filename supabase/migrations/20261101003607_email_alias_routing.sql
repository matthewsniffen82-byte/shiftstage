begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Shared mailbox copies use their own durable receipt, never a BCC per staff
-- member. Individual staff delivery and access checks remain unchanged.
alter table public.admin_review_email_deliveries drop constraint admin_email_recipient_kind;
alter table public.admin_review_email_deliveries add constraint admin_email_recipient_kind check (
 (recipient_id is not null and mailbox is null) or
 (recipient_id is null and mailbox is not null and mailbox in
   ('approvals@mydancr.com','dmca@mydancr.com','safety@mydancr.com'))
);

create function private.queue_admin_review_alias() returns trigger
language plpgsql security definer set search_path='' as $$
declare mailbox text;
begin
 if new.kind in ('club_application','deal_request','page_changes','media_approval') then
  mailbox:='approvals@mydancr.com';
 elsif new.kind='copyright_case' then
  mailbox:='dmca@mydancr.com';
 end if;
 -- The existing case worker owns safety/privacy arrivals and deadline reminders.
 if mailbox is not null then
  insert into public.admin_review_email_deliveries(event_key,mailbox)
   values(new.event_key,mailbox) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function private.queue_admin_review_alias() from public,anon,authenticated;
create trigger admin_review_alias_after_insert after insert on public.admin_review_email_events
 for each row execute function private.queue_admin_review_alias();

create or replace function public.admin_review_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.admin_review_email_deliveries; email text; event public.admin_review_email_events; kind text;
begin
 select * into job from public.admin_review_email_deliveries
  where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found then return null; end if;
 select * into event from public.admin_review_email_events where event_key=job.event_key;
 if not found then return null; end if;
 kind:=event.kind;
 if job.mailbox is not null then
  if job.mailbox='safety@mydancr.com' then
   if event.kind<>'content_report' or event.event_key not like 'compliance:%'
    or not exists(select 1 from public.content_reports where id=event.source_id and status='open' and case_kind in ('safety','privacy')) then return null; end if;
   kind:='compliance_case';
  elsif job.mailbox='approvals@mydancr.com' then
   if event.kind not in ('club_application','deal_request','page_changes','media_approval') then return null; end if;
  elsif job.mailbox='dmca@mydancr.com' then
   if event.kind<>'copyright_case' then return null; end if;
  else return null;
  end if;
  email:=job.mailbox;
 else
  email:=private.admin_review_email_account(job.recipient_id,event.kind);
 end if;
 if email is null or (job.destination is not null and job.destination<>email) then return null; end if;
 update public.admin_review_email_deliveries set destination=email where id=p_id;
 return jsonb_build_object('email',email,'kind',kind,'title',event.title,'body',event.body,'sourceId',event.source_id);
end $$;
revoke all on function public.admin_review_email_target(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_review_email_target(uuid,uuid) to service_role;

-- Only new events get shared copies; do not replay historical notifications.
commit;
