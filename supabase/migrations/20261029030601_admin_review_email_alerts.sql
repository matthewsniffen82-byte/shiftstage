begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.admin_review_email_events (
 event_key text primary key, kind text not null check(kind in ('club_application','deal_request','page_changes','content_report','copyright_case','media_approval')),
 source_id uuid not null, title text not null, body text not null, created_at timestamptz not null default now()
);
create table public.admin_review_email_deliveries (
 id uuid primary key default gen_random_uuid(), event_key text not null references public.admin_review_email_events(event_key) on delete cascade,
 recipient_id uuid not null references public.app_users(id) on delete cascade,
 notification_id uuid unique references public.notifications(id) on delete set null,
 destination text, status text not null default 'pending' check(status in ('pending','sending','accepted','skipped','failed')),
 attempts integer not null default 0, created_at timestamptz not null default now(), next_attempt_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, provider_id text, outcome text, finished_at timestamptz,
 unique(event_key,recipient_id)
);
create index admin_review_email_due on public.admin_review_email_deliveries(next_attempt_at,id) where status in ('pending','sending');
create index admin_review_email_recipient on public.admin_review_email_deliveries(recipient_id);
alter table public.admin_review_email_events enable row level security;
alter table public.admin_review_email_deliveries enable row level security;
revoke all on public.admin_review_email_events,public.admin_review_email_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.admin_review_email_events,public.admin_review_email_deliveries to service_role;
create policy admin_review_email_events_service on public.admin_review_email_events to service_role using(true) with check(true);
create policy admin_review_email_deliveries_service on public.admin_review_email_deliveries to service_role using(true) with check(true);

-- Reviewers can access media; the other queues are owner-only. Resolve access and the
-- verified Auth address again at delivery; editable metadata never grants access.
create function private.admin_review_email_account(p_user uuid,p_kind text) returns text
language sql stable security definer set search_path='' as $$
 select lower(btrim(u.email)) from auth.users u join public.app_users a on a.id=u.id
 where u.id=p_user and a.role='admin' and (a.admin_workspace_role='owner' or (p_kind='media_approval' and a.admin_workspace_role='reviewer')) and a.account_state='active'
 and u.deleted_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
 and lower(btrim(u.email))=lower(btrim(a.email)) and u.email not ilike '%@admin.mydancr.local';
$$;
revoke all on function private.admin_review_email_account(uuid,text) from public,anon,authenticated;
grant execute on function private.admin_review_email_account(uuid,text) to service_role;

-- Trigger-only, unexposed function. Source-table permissions/RLS authorize the
-- originating write before this trigger runs; it cannot be called as an API.
create function private.admin_review_email_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare n jsonb:=to_jsonb(new); o jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 k text; kind text; title text; message text; club text; dancer text; source uuid:=(n->>'id')::uuid; recipient uuid; notice uuid;
begin
 if tg_table_schema<>'public' then return new; end if;
 k:=tg_table_name||':'||source;
 if tg_table_name in ('image_moderation_records','mydancr_tv_videos') then
  if n->>'club_reviewed_at' is null then return new; end if;
  if tg_table_name='image_moderation_records' then
   if n->>'decision' is distinct from 'review' then return new; end if;
   select stage_name into dancer from public.dancer_profiles where user_id=(n->>'user_id')::uuid;
   title:=case when n->>'upload_context' like 'profile_main%' then 'Main photo awaiting approval' else 'Photo awaiting approval' end;
  else
   if n->>'status' is distinct from 'submitted' or n->>'upload_validation_pending' is distinct from 'false'
    or n->'moderation_details'->>'fileChecksPassed' is distinct from 'true' then return new; end if;
   select stage_name into dancer from public.dancer_profiles where id=(n->>'dancer_id')::uuid;
   title:='Video awaiting approval';
  end if;
  k:=k||':'||(n->>'club_reviewed_at'); kind:='media_approval';
  message:=coalesce(left(dancer,160),'A dancer')||' has club-approved media waiting for MyDancr’s final approval.';
 elsif tg_table_name='venue_signup_requests' then
  if n->>'status'<>'pending' or o->>'status'='pending' then return new; end if;
  kind:='club_application'; title:='New club application';
  message:=left(n->>'venue_name',160)||' has submitted a verified club application for review.';
 elsif tg_table_name='venue_club_deal_requests' then
  if tg_op<>'INSERT' or n->>'status'<>'pending' then return new; end if;
  select name into club from public.venues where id=(n->>'venue_id')::uuid;
  kind:='deal_request'; title:='New club deal request';
  message:=coalesce(left(club,160),'A club')||' requested '||case when n->>'request_type'='remove' then 'removal of' else 'a new' end||' Club Deal: '||left(n->>'offer_title',160)||'.';
 elsif tg_table_name='venues' then
  if n->>'page_review_status'<>'changes_requested' or (o->>'page_review_status'='changes_requested' and n->>'page_review_notes' is not distinct from o->>'page_review_notes') then return new; end if;
  k:=k||':'||md5(coalesce(n->>'page_reviewed_at',n->>'updated_at','')||coalesce(n->>'page_review_notes',''));
  kind:='page_changes'; title:='Club page changes requested';
  message:=left(n->>'name',160)||' requested changes to its club page. Open Site Admin to review the feedback.';
 elsif tg_table_name='content_reports' then
  if tg_op<>'INSERT' or n->>'status'<>'open' then return new; end if;
  kind:='content_report'; title:='New content report';
  message:='A report about '||coalesce(left(n->>'target_label',160),'site content')||' is waiting for review. Open Site Admin for the report details.';
 elsif tg_table_name='dmca_cases' then
  if tg_op<>'INSERT' then return new; end if;
  kind:='copyright_case'; title:='New copyright case';
  message:='Copyright case '||source||' has been submitted. Open Site Admin to review it.';
 elsif tg_table_name='dmca_counter_notices' then
  if tg_op<>'INSERT' then return new; end if;
  source:=(n->>'case_id')::uuid; kind:='copyright_case'; title:='Copyright counter-notice received';
  message:='A counter-notice was submitted for copyright case '||source||'. Open Site Admin to review it.';
 else return new;
 end if;
 insert into public.admin_review_email_events(event_key,kind,source_id,title,body) values(k,kind,source,title,message) on conflict do nothing;
 if not found then return new; end if;
 for recipient in select id from public.app_users where role='admin' and account_state='active'
 and (admin_workspace_role='owner' or (kind='media_approval' and admin_workspace_role='reviewer')) loop
  insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
  values(recipient,'support_message','in_app',title,message,jsonb_build_object('kind','admin_review','reviewKind',kind,'sourceId',source,'emailPath','/admin?alert='||kind),now()) returning id into notice;
  insert into public.admin_review_email_deliveries(event_key,recipient_id,notification_id) values(k,recipient,notice) on conflict do nothing;
 end loop;
 return new;
end $$;
revoke all on function private.admin_review_email_event() from public,anon,authenticated,service_role;

create trigger admin_club_application_email after insert or update of status on public.venue_signup_requests for each row execute function private.admin_review_email_event();
create trigger admin_deal_request_email after insert on public.venue_club_deal_requests for each row execute function private.admin_review_email_event();
create trigger admin_page_changes_email after update of page_review_status,page_review_notes on public.venues for each row execute function private.admin_review_email_event();
create trigger admin_content_report_email after insert on public.content_reports for each row execute function private.admin_review_email_event();
create trigger admin_copyright_case_email after insert on public.dmca_cases for each row execute function private.admin_review_email_event();
create trigger admin_copyright_counter_email after insert on public.dmca_counter_notices for each row execute function private.admin_review_email_event();
create trigger admin_photo_review_email after insert or update of decision,club_reviewed_at on public.image_moderation_records for each row execute function private.admin_review_email_event();
create trigger admin_video_review_email after insert or update of status,club_reviewed_at,upload_validation_pending,moderation_details on public.mydancr_tv_videos for each row execute function private.admin_review_email_event();

create function public.claim_admin_review_emails(p_limit integer default 1) returns table(id uuid,lease_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 -- Retries end before the provider's 24-hour idempotency window closes.
 update public.admin_review_email_deliveries q set status='failed',outcome='retry_expired',finished_at=now(),lease_id=null,lease_until=null
 where status in ('pending','sending') and (lease_until is null or lease_until<=now()) and (attempts>=10 or created_at<now()-interval '20 hours');
 return query with due as (
  select q.id from public.admin_review_email_deliveries q where q.status in ('pending','sending') and q.next_attempt_at<=now()
  and (q.lease_until is null or q.lease_until<=now()) order by q.next_attempt_at,q.id
  for update skip locked limit least(greatest(coalesce(p_limit,1),1),10)
 ) update public.admin_review_email_deliveries q set status='sending',attempts=q.attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where q.id=due.id returning q.id,q.lease_id;
end $$;

create function public.admin_review_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.admin_review_email_deliveries; email text; event public.admin_review_email_events;
begin
 select * into job from public.admin_review_email_deliveries where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found then return null; end if;
 select * into event from public.admin_review_email_events where event_key=job.event_key;
 email:=private.admin_review_email_account(job.recipient_id,event.kind);
 if email is null or (job.destination is not null and job.destination<>email) then return null; end if;
 update public.admin_review_email_deliveries set destination=email where id=p_id;
 return jsonb_build_object('email',email,'kind',event.kind,'title',event.title,'body',event.body,'sourceId',event.source_id);
end $$;

create function public.finish_admin_review_email(p_id uuid,p_lease uuid,p_status text,p_outcome text,p_provider_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_status is null or p_status not in ('accepted','retry','failed','skipped') then raise exception 'Invalid email outcome'; end if;
 update public.admin_review_email_deliveries set status=case when p_status='retry' then 'pending' else p_status end,
 next_attempt_at=now()+least(interval '60 minutes',interval '1 minute'*power(2,attempts)),
 lease_id=null,lease_until=null,outcome=left(p_outcome,100),provider_id=left(p_provider_id,200),
 finished_at=case when p_status='retry' then null else now() end
 where id=p_id and lease_id=p_lease and status='sending' and lease_until>now();
 return found;
end $$;
revoke all on function public.claim_admin_review_emails(integer),public.admin_review_email_target(uuid,uuid),public.finish_admin_review_email(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_admin_review_emails(integer),public.admin_review_email_target(uuid,uuid),public.finish_admin_review_email(uuid,uuid,text,text,text) to service_role;

notify pgrst,'reload schema';
commit;
