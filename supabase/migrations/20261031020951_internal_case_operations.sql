begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Private operational evidence. No raw IDs, selfies, reported media or secrets belong here.
create table public.compliance_records (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('staffing','vendor','data_map','retention','deletion','hold','destination','club_order')),
 title text not null check(length(btrim(title)) between 3 and 160),
 status text not null default 'draft' check(status in ('draft','in_progress','blocked','verified','completed')),
 fields jsonb not null default '{}' check(jsonb_typeof(fields)='object' and octet_length(fields::text)<=24000),
 revision integer not null default 1, updated_by uuid references public.app_users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index compliance_records_kind on public.compliance_records(kind,status);
create index compliance_records_actor on public.compliance_records(updated_by);
create table public.compliance_events (
 id bigint generated always as identity primary key,
 case_id uuid references public.content_reports(id) on delete set null,
 record_id uuid references public.compliance_records(id) on delete set null,
 actor_id uuid references public.app_users(id) on delete set null,
 action text not null, revision integer, created_at timestamptz not null default clock_timestamp()
);
create index compliance_events_case on public.compliance_events(case_id,created_at);
create index compliance_events_record on public.compliance_events(record_id,created_at);
create index compliance_events_actor on public.compliance_events(actor_id);
alter table public.compliance_records enable row level security;
alter table public.compliance_events enable row level security;
revoke all on public.compliance_records,public.compliance_events from public,anon,authenticated;
grant select,insert,update on public.compliance_records to service_role;
grant select,insert on public.compliance_events to service_role;
grant usage,select on sequence public.compliance_events_id_seq to service_role;
create policy compliance_records_service on public.compliance_records to service_role using(true) with check(true);
create policy compliance_events_service on public.compliance_events to service_role using(true) with check(true);

alter table public.content_reports add column received_at timestamptz,
 add column workflow jsonb not null default '{}' check(jsonb_typeof(workflow)='object' and octet_length(workflow::text)<=16000),
 add column workflow_revision integer not null default 0;
update public.content_reports set received_at=created_at;
alter table public.content_reports alter column received_at set not null;

create function private.compliance_owner(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.app_users where id=p_actor and role='admin' and account_state='active' and admin_workspace_role='owner');
$$;
revoke all on function private.compliance_owner(uuid) from public,anon,authenticated;
grant execute on function private.compliance_owner(uuid) to service_role;

-- Runs after the existing receipt trigger; external receipts may move the clock earlier only.
create function private.compliance_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.received_at is null then new.received_at:=new.created_at; end if;
 if new.received_at>new.created_at then raise exception 'Receipt cannot be later than submission'; end if;
 new.next_action_due_at:=new.next_action_due_at-(new.created_at-new.received_at);
 if new.case_kind='safety' and new.reason='Nonconsensual intimate image' then
  new.next_action_due_at:=least(new.next_action_due_at,new.received_at+interval '24 hours');
 end if;
 if new.intake ? 'californiaResponseDueAt' then
  new.intake:=jsonb_set(new.intake,'{californiaResponseDueAt}',to_jsonb(new.received_at+interval '45 days'));
 end if;
 return new;
end $$;
revoke all on function private.compliance_receipt() from public,anon,authenticated,service_role;
create trigger zz_compliance_receipt before insert on public.content_reports for each row execute function private.compliance_receipt();

create function public.record_external_case(p_actor uuid,p_received timestamptz,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.content_reports;
begin
 if not private.compliance_owner(p_actor) then raise exception 'Active owner access required'; end if;
 if p_received is null or p_received>clock_timestamp() or p_values->>'case_kind' not in ('safety','privacy') then raise exception 'Invalid original receipt'; end if;
 insert into public.content_reports(target_type,target_label,reason,details,case_kind,priority,intake,received_at)
 values('contact_message','External safety or privacy request',p_values->>'reason',p_values->>'details',p_values->>'case_kind',p_values->>'priority',
  (p_values->'intake')||jsonb_build_object('receiptSource',p_values->>'source','recordedBy',p_actor),p_received) returning * into r;
 insert into public.compliance_events(case_id,actor_id,action,revision) values(r.id,p_actor,'external_receipt_recorded',0);
 return to_jsonb(r);
end $$;
revoke all on function public.record_external_case(uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.record_external_case(uuid,timestamptz,jsonb) to service_role;

create function public.save_case_workflow(p_actor uuid,p_id uuid,p_revision integer,p_workflow jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare r public.content_reports; due timestamptz; hard_due timestamptz; person text; keys text;
begin
 if not private.compliance_owner(p_actor) then raise exception 'Active owner access required'; end if;
 select * into r from public.content_reports where id=p_id for update;
 if not found or r.case_kind not in ('safety','privacy') then raise exception 'Case unavailable'; end if;
 if r.status<>'open' then raise exception 'Closed case is read-only; create a linked follow-up'; end if;
 if r.workflow_revision<>p_revision then raise exception 'Case changed; refresh before saving'; end if;
 if jsonb_typeof(p_workflow) is distinct from 'object' or octet_length(p_workflow::text)>16000 then raise exception 'Invalid workflow'; end if;
 select key into keys from jsonb_each(p_workflow) where key not in
 ('ownerId','backupId','jurisdiction','verification','authority','triage','nextAction','nextDue','responseDue','deadlineReason','extensionNotice','notices','decision','followUp','copySearch','verificationDisposal','retentionTrigger','evidenceLocation','appealReference') limit 1;
 if keys is not null then raise exception 'Unknown workflow field'; end if;
 if exists(select 1 from jsonb_each(p_workflow) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>2000) then raise exception 'Workflow fields must be text up to 2000 characters'; end if;
 foreach person in array array[p_workflow->>'ownerId',p_workflow->>'backupId'] loop
  if coalesce(person,'')<>'' and not private.compliance_owner(person::uuid) then raise exception 'Choose an active owner with access to cases'; end if;
 end loop;
 if coalesce(p_workflow->>'ownerId','')<>'' and p_workflow->>'ownerId'=p_workflow->>'backupId' then raise exception 'Primary and backup must differ'; end if;
 if coalesce(p_workflow->>'verification','') not in ('','pending','verified','not_required','failed') then raise exception 'Invalid verification status'; end if;
 due:=nullif(p_workflow->>'nextDue','')::timestamptz;
 if due is null then raise exception 'Next action deadline required'; end if;
 if length(btrim(coalesce(p_workflow->>'nextAction','')))<3 then raise exception 'Next action required'; end if;
 if r.reason='Nonconsensual intimate image' and r.case_kind='safety' then
  hard_due:=r.received_at+interval '48 hours';
  if due>hard_due then raise exception 'The 48-hour removal clock cannot be extended'; end if;
 end if;
 if r.case_kind='privacy' and nullif(p_workflow->>'responseDue','') is not null then
  hard_due:=(p_workflow->>'responseDue')::timestamptz;
  if hard_due<r.received_at then raise exception 'Response deadline precedes receipt'; end if;
  if length(btrim(coalesce(p_workflow->>'deadlineReason','')))<10 then raise exception 'Record applicable deadline and basis'; end if;
  if lower(p_workflow->>'jurisdiction') ~ '(^|[^a-z])(ca|california)([^a-z]|$)' and r.reason in ('Access or portable copy','Delete my information','Correct my information') then
   if hard_due>r.received_at+interval '90 days' then raise exception 'California response deadline exceeds supported maximum'; end if;
   if hard_due>r.received_at+interval '45 days' and length(btrim(coalesce(p_workflow->>'extensionNotice','')))<10 then raise exception 'Record extension reason and notice before extending'; end if;
  end if;
  if due>hard_due then raise exception 'Next action must be on or before response deadline'; end if;
 end if;
 update public.content_reports set workflow=p_workflow,workflow_revision=workflow_revision+1,next_action_due_at=due where id=p_id returning * into r;
 insert into public.compliance_events(case_id,actor_id,action,revision) values(p_id,p_actor,'workflow_saved',r.workflow_revision);
 return to_jsonb(r);
end $$;

-- Preserve removal's existing atomic transaction. Require the private ledger before closure.
create function private.compliance_close_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare w jsonb:=new.workflow; field text;
begin
 if old.status<>'open' or new.status='open' or new.case_kind not in ('safety','privacy') then return new; end if;
 if not private.compliance_owner(nullif(w->>'ownerId','')::uuid) then raise exception 'Assign an active case owner in Tools > Safety & privacy before closure'; end if;
 foreach field in array array['triage','decision','notices','followUp','retentionTrigger'] loop
  if length(btrim(coalesce(w->>field,'')))<10 then raise exception 'Complete % in Tools > Safety & privacy before closure',field; end if;
 end loop;
 if new.case_kind='privacy' then
  if coalesce(w->>'verification','') not in ('verified','not_required','failed') then raise exception 'Record the verification outcome before closure'; end if;
  if length(btrim(coalesce(w->>'verificationDisposal','')))<10 or length(btrim(coalesce(w->>'authority','')))<10 or length(btrim(coalesce(w->>'jurisdiction','')))<2
   then raise exception 'Complete privacy authority, jurisdiction and verification-material disposal'; end if;
 elsif length(btrim(coalesce(w->>'copySearch','')))<10 then raise exception 'Record known-copy and derivative review before closure'; end if;
 insert into public.compliance_events(case_id,actor_id,action,revision) values(new.id,new.reviewed_by,'case_'||new.status,new.workflow_revision);
 return new;
end $$;
revoke all on function private.compliance_close_guard() from public,anon,authenticated,service_role;
create trigger compliance_close_guard before update of status on public.content_reports for each row execute function private.compliance_close_guard();

create function public.save_compliance_record(p_actor uuid,p_id uuid,p_revision integer,p_kind text,p_title text,p_status text,p_fields jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare r public.compliance_records; field text; required text[]; linked public.compliance_records;
begin
 if not private.compliance_owner(p_actor) then raise exception 'Active owner access required'; end if;
 if p_id is not null then
  select * into r from public.compliance_records where id=p_id for update;
  if not found or r.revision<>p_revision then raise exception 'Record changed; refresh before saving'; end if;
  if r.kind<>p_kind then raise exception 'Record kind cannot change'; end if;
 end if;
 if jsonb_typeof(p_fields) is distinct from 'object' or octet_length(p_fields::text)>24000 then raise exception 'Invalid record fields'; end if;
 if exists(select 1 from jsonb_each(p_fields) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>6000) then raise exception 'Record values must be text up to 6000 characters'; end if;
 if p_kind='deletion' then
  if p_id is not null and nullif(r.fields->>'holdId','') is not null and p_fields->>'holdId' is distinct from r.fields->>'holdId'
   and exists(select 1 from public.compliance_records where id=(r.fields->>'holdId')::uuid and kind='hold' and status<>'completed')
   then raise exception 'An active hold cannot be removed from the deletion record'; end if;
  if p_id is not null and coalesce(r.fields->>'triggerAt','')<>'' and p_fields->>'triggerAt' is distinct from r.fields->>'triggerAt' then raise exception 'Preserve the original deletion trigger'; end if;
  if nullif(p_fields->>'holdId','') is not null then
   select * into linked from public.compliance_records where id=(p_fields->>'holdId')::uuid and kind='hold' for update;
   if not found then raise exception 'Hold record not found'; end if;
   if p_status='completed' and linked.status<>'completed' then raise exception 'Release the linked hold before completing deletion'; end if;
  end if;
 end if;
 if p_status in ('verified','completed') then
  required:=case p_kind
   when 'staffing' then array['owner','backup','coverage','evidence','reviewAt']
   when 'vendor' then array['owner','legalEntity','account','purpose','contract','region','access','subprocessors','retention','security','evidence','reviewAt']
   when 'data_map' then array['owner','system','provider','region','access','category','retention','deletionJob','lastSuccess','exceptions','evidence','reviewAt']
   when 'retention' then array['owner','category','trigger','period','approver','adoptedAt','evidence','reviewAt']
   when 'deletion' then array['owner','scope','triggerAt','dueAt','policyId','application','media','vendors','exports','caches','embeds','backups','verification','evidence']
   when 'hold' then array['owner','authority','scope','startedAt','access','reviewAt','mandatoryLimits','evidence']
   when 'destination' then array['owner','domains','permission','visibility','revocation','cache','evidence','reviewAt']
   when 'club_order' then array['owner','operator','representative','authority','agreementVersion','orderVersion','pricing','dates','acceptedAt','evidence']
   else array[]::text[] end;
  foreach field in array required loop
   if length(btrim(coalesce(p_fields->>field,'')))<3 then raise exception 'Complete % before verifying this record',field; end if;
  end loop;
  if p_kind='hold' and p_status='completed' and (length(btrim(coalesce(p_fields->>'releaseEvidence','')))<10 or nullif(p_fields->>'releasedAt','') is null) then raise exception 'Record hold release time and evidence'; end if;
  if p_kind='deletion' then
   select * into linked from public.compliance_records where id=(p_fields->>'policyId')::uuid and kind='retention' for share;
   if not found or linked.status<>'verified' then raise exception 'An adopted retention policy is required'; end if;
   if (p_fields->>'dueAt')::timestamptz<(p_fields->>'triggerAt')::timestamptz then raise exception 'Deletion due date precedes original trigger'; end if;
  end if;
 end if;
 if p_id is null then
  insert into public.compliance_records(kind,title,status,fields,updated_by) values(p_kind,btrim(p_title),p_status,p_fields,p_actor) returning * into r;
 else
  update public.compliance_records set title=btrim(p_title),status=p_status,fields=p_fields,revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into r;
 end if;
 insert into public.compliance_events(record_id,actor_id,action,revision) values(r.id,p_actor,'record_'||p_status,r.revision);
 return to_jsonb(r);
end $$;

revoke all on function public.save_case_workflow(uuid,uuid,integer,jsonb),public.save_compliance_record(uuid,uuid,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_case_workflow(uuid,uuid,integer,jsonb),public.save_compliance_record(uuid,uuid,integer,text,text,text,jsonb) to service_role;

-- Extend the existing leased, idempotent outbox for the user-designated shared inbox.
alter table public.admin_review_email_deliveries alter column recipient_id drop not null;
alter table public.admin_review_email_deliveries add column mailbox text;
alter table public.admin_review_email_deliveries add constraint admin_email_recipient_kind check
 ((recipient_id is not null and mailbox is null) or (recipient_id is null and mailbox='safety@mydancr.com'));
create unique index admin_review_mailbox_event on public.admin_review_email_deliveries(event_key,mailbox) where mailbox is not null;

create function public.enqueue_case_alerts() returns integer
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare r record; key text; queued integer:=0; stage text;
begin
 for r in select id,priority,next_action_due_at from public.content_reports where status='open' and case_kind in ('safety','privacy') loop
  stage:=case when r.next_action_due_at<=now() then 'overdue:'||to_char(now() at time zone 'UTC','YYYYMMDDHH24')
   when r.next_action_due_at<=now()+interval '4 hours' then 'due:'||r.next_action_due_at::text else 'received' end;
  key:='compliance:'||r.id||':'||stage;
  insert into public.admin_review_email_events(event_key,kind,source_id,title,body)
   values(key,'content_report',r.id,case when stage like 'overdue:%' then 'Case overdue: owner and backup review required' when r.priority='urgent' then 'Urgent case requires review' else 'Case requires review' end,
    'Open the private safety and privacy queue. Next action due: '||coalesce(r.next_action_due_at::text,'review now')||'. Escalate urgent or overdue cases to the primary and backup reviewers.') on conflict do nothing;
  insert into public.admin_review_email_deliveries(event_key,mailbox) values(key,'safety@mydancr.com') on conflict do nothing;
  if found then queued:=queued+1; end if;
 end loop;
 return queued;
end $$;
revoke all on function public.enqueue_case_alerts() from public,anon,authenticated;
grant execute on function public.enqueue_case_alerts() to service_role;

create or replace function public.admin_review_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.admin_review_email_deliveries; email text; event public.admin_review_email_events; kind text;
begin
 select * into job from public.admin_review_email_deliveries where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found then return null; end if;
 select * into event from public.admin_review_email_events where event_key=job.event_key;
 kind:=event.kind;
 if job.mailbox is not null then
  if job.mailbox<>'safety@mydancr.com' or event.kind<>'content_report' or event.event_key not like 'compliance:%'
   or not exists(select 1 from public.content_reports where id=event.source_id and status='open' and case_kind in ('safety','privacy')) then return null; end if;
  email:=job.mailbox; kind:='compliance_case';
 else email:=private.admin_review_email_account(job.recipient_id,event.kind); end if;
 if email is null or (job.destination is not null and job.destination<>email) then return null; end if;
 update public.admin_review_email_deliveries set destination=email where id=p_id;
 return jsonb_build_object('email',email,'kind',kind,'title',event.title,'body',event.body,'sourceId',event.source_id);
end $$;

-- Snapshot schema names only. Actual access, deletion jobs and backup evidence remain unverified.
insert into public.compliance_records(kind,title,fields)
select 'data_map','public.'||table_name,jsonb_build_object('system','Supabase public.'||table_name,'provider','Supabase (contracting entity unverified)',
 'region','us-west-2 (production project)','category',string_agg(column_name,', ' order by ordinal_position),'evidence','Production information_schema snapshot; schema presence only, not retention or access verification.')
from information_schema.columns where table_schema='public' and table_name not in ('compliance_records','compliance_events')
group by table_name;
insert into public.compliance_records(kind,title,fields) values
 ('staffing','Safety and privacy coverage','{"mailbox":"safety@mydancr.com","evidence":"User confirmed this inbox receives email on 2026-10-30. Primary and backup reviewers remain unassigned."}'),
 ('vendor','Ondato verification','{"purpose":"Dancer age and identity verification","retention":"Client confirmed 30-day deletion, no retained derived facial templates or measurements, and no backups. Production trigger and completion evidence still required.","contract":"Signed Order, General Terms, Exhibit B DPA and SCC acceptance evidence pending."}'),
 ('vendor','Supabase database, auth and storage','{"purpose":"Production database, authentication and object storage","region":"us-west-2 (production project)","account":"hfmzwadzabmgxkjzmqun"}'),
 ('vendor','Vercel hosting','{"purpose":"Application hosting and scheduled jobs","account":"shiftstage"}'),
 ('vendor','OpenAI assistance and media processing','{"purpose":"Review assistance and appearance processing separately; confirm active models, payloads and retention settings."}'),
 ('vendor','Resend transactional email','{"purpose":"Transactional and operational email","security":"Case alerts contain reference and deadline only. Confirm actual provider settings and contract."}'),
 ('vendor','Stripe club billing','{"purpose":"Confirm active billing configuration, operative agreement and retained references."}'),
 ('destination','Authorized TV and embed destinations','{"visibility":"Record actual approved domains and receiving parties.","revocation":"Document and verify revocation, cache removal and downstream responsibilities."}'),
 ('retention','Guest, pickup, table and VIP requests','{"category":"Guest-list, pickup, table and VIP requests, passes and responses","trigger":"Visit or request closes","period":"Proposed 180 days; not adopted"}'),
 ('retention','Detailed interactions and analytics','{"category":"Check-ins, roster time, interactions, scores and historical appearance inputs","trigger":"Original event time","period":"Proposed rolling 13 months, then delete or irreversibly aggregate; not adopted"}'),
 ('retention','Support and privacy cases','{"category":"Support and privacy requests","trigger":"Case closure","period":"Proposed 24 months; narrower required records separately justified; not adopted"}'),
 ('retention','Safety decisions and appeals','{"category":"Necessary lawful safety decisions and notices; copyright work remains on hold","trigger":"Case closure","period":"Proposed 3 years, subject to specific lawful exception; not adopted"}'),
 ('retention','Account records','{"category":"Account, role, invitation and affiliation","trigger":"Account closure","period":"Proposed maximum 90 days, except separately justified records; not adopted"}'),
 ('retention','Removed media and derivatives','{"category":"Removed or rejected media and derivatives","trigger":"Removal or final review","period":"Proposed maximum 30 days; not adopted"}'),
 ('retention','Consent receipts','{"category":"Minimal versioned permission and authority evidence; exclude verification outcomes and vendor references","trigger":"Relationship ends or earlier withdrawn permission","period":"Proposed maximum 6 years; not adopted"}'),
 ('retention','Club financial records','{"category":"Orders, invoices, payment references and accounting","trigger":"Relevant fiscal year ends","period":"Proposed 7 years subject to actual requirements; not adopted"}'),
 ('retention','Security logs','{"category":"Security and diagnostic logs","trigger":"Original event time","period":"Proposed rolling 90 days; not adopted"}'),
 ('retention','Application backups','{"category":"Recovery copies; reapply deletions on restore","trigger":"Original deletion event","period":"Proposed maximum 90-day cycle; actual rotation unverified"}'),
 ('retention','Limited verification results','{"category":"Limited result, verification time and transaction reference; separate from consent receipts","trigger":"Account closure, or earlier purpose completion","period":"Public commitment: while active and no longer than 3 years after closure; verify implementation"}'),
 ('retention','Ondato raw verification','{"category":"Provider raw ID and selfie records; no independent application copies","trigger":"Exact provider trigger awaiting production evidence","period":"Client-confirmed 30 days, no retained facial templates and no backups; verify completion"}'),
 ('retention','Biometric destruction','{"category":"Any biometric identifiers or information","trigger":"Purpose satisfied or last interaction, whichever rule requires earlier destruction","period":"Public commitment: purpose completion or at most 3 years after last interaction; apply shorter provider and applicable limits"}'),
 ('retention','Restricted mandatory safety preservation','{"category":"CyberTipline report and necessary material; restricted safety custodian only, never attach files to this register","trigger":"Actual report date; legal owner confirms applicable duty","period":"Supplied schedule identifies one year after reporting under 18 USC 2258A; confirm scope, access and any other controlling requirement"}');
-- Restriction can happen immediately while case follow-up remains open.
create or replace function public.close_public_case(p_admin_id uuid,p_report_id uuid,p_action text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  r public.content_reports%rowtype;
  media_path text;
  bucket_name text;
  affected jsonb:='[]';
  receipt jsonb;
begin
  if not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then raise exception 'Active administrator required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('resolved','removed','restricted') or length(btrim(coalesce(p_notes,'')))<10 or length(p_notes)>2000 then raise exception 'Record the decision and follow-up in at least 10 characters' using errcode='22023'; end if;
  select * into r from public.content_reports where id=p_report_id for update;
  if not found then raise exception 'Case not found' using errcode='P0002'; end if;
  if r.status<>'open' then raise exception 'Case is already closed; refresh the queue' using errcode='40001'; end if;
  if p_action in ('removed','restricted') then
    if r.target_id is null or r.case_kind<>'safety' then raise exception 'Locate the reported content and use its moderation controls before resolving this case' using errcode='22023'; end if;
    if r.target_type='dancer_profile' then
      receipt:=public.transition_dancer_publication_safely(r.target_id,'disable',p_admin_id);
      if receipt->>'status'<>'disabled' or receipt->'is_public' is distinct from 'false'::jsonb then raise exception 'Profile restriction could not be confirmed'; end if;
      affected:=jsonb_build_array(jsonb_build_object('type',r.target_type,'id',r.target_id,'result','disabled'));
    elsif r.target_type='venue' then
      receipt:=public.change_venue_publication_safely(p_admin_id,r.target_id,'admin_edit','{"is_active":false}');
      if receipt->'is_active' is distinct from 'false'::jsonb then raise exception 'Club restriction could not be confirmed'; end if;
      affected:=jsonb_build_array(jsonb_build_object('type','venue','id',r.target_id,'result','inactive'));
    elsif r.target_type='shift' then
      update public.shifts set status='cancelled' where id=r.target_id returning jsonb_build_object('type','shift','id',id,'result',status) into receipt;
      if receipt is null or receipt->>'result'<>'cancelled' then raise exception 'Schedule restriction could not be confirmed'; end if;
      affected:=jsonb_build_array(receipt);
    elsif r.target_type in ('profile_photo','tv_video') then
      -- A short moderation-only lock stabilizes the target, copies and avatar
      -- sources before lookup. Timeout rolls back the whole case action.
      lock table public.dancer_profiles,public.dancer_photos,public.mydancr_tv_videos in share row exclusive mode;
      if r.target_type='profile_photo' then
        select storage_path into media_path from public.dancer_photos where id=r.target_id;
        bucket_name:='dancer-photos';
      else
        select storage_path into media_path from public.mydancr_tv_videos where id=r.target_id;
        bucket_name:='mydancr-tv-videos';
      end if;
      if media_path is null then raise exception 'Media target is unavailable; review before closing' using errcode='22023'; end if;
      insert into public.safety_media_restrictions(bucket,storage_path,report_id) values(bucket_name,media_path,r.id) on conflict do nothing;
      if r.target_type='profile_photo' then
        -- Include derived avatars in the hold, as well as every gallery reference.
        insert into public.safety_media_restrictions(bucket,storage_path,report_id)
          select 'dancer-photos',avatar_storage_path,r.id from public.dancer_profiles
          where (avatar_source_storage_path=media_path or avatar_source_photo_id=r.target_id) and avatar_storage_path is not null
          on conflict do nothing;
        with changed as (update public.dancer_photos set review_status='rejected' where storage_path=media_path returning id,review_status)
          select jsonb_agg(jsonb_build_object('type','profile_photo','id',id,'result',review_status)) into affected from changed;
        update public.dancer_profiles set avatar_storage_path=null,avatar_source_storage_path=null,avatar_source_photo_id=null
          where avatar_source_storage_path=media_path or avatar_source_photo_id=r.target_id or avatar_storage_path=media_path;
        if exists(select 1 from public.dancer_photos where storage_path=media_path and review_status<>'rejected') then raise exception 'Photo restriction could not be confirmed'; end if;
      else
        with changed as (update public.mydancr_tv_videos set status='removed',venue_featured=false,reviewed_by=p_admin_id,reviewed_at=clock_timestamp()
          where storage_path=media_path returning id,status)
          select jsonb_agg(jsonb_build_object('type','tv_video','id',id,'result',status)) into affected from changed;
        if exists(select 1 from public.mydancr_tv_videos where storage_path=media_path and status<>'removed') then raise exception 'Video restriction could not be confirmed'; end if;
      end if;
      if affected is null then raise exception 'No media restriction was confirmed'; end if;
    else raise exception 'This target has no automatic removal action' using errcode='22023'; end if;
  end if;
  update public.content_reports set status=case when p_action='restricted' then 'open' else p_action end, reviewed_by=case when p_action='restricted' then null else p_admin_id end, reviewed_at=case when p_action='restricted' then null else clock_timestamp() end,closure_notes=case when p_action='restricted' then null else btrim(p_notes) end,
    action_evidence=jsonb_build_object('action',p_action,'affected',affected,'restriction',case when p_action in ('restricted','removed') then jsonb_build_object('affected',affected,'at',clock_timestamp(),'actor',p_admin_id,'notes',btrim(p_notes)) else r.action_evidence->'restriction' end,'scope','Stored file references and linked derivatives; separately uploaded identical files require reviewer search','recordedAt',clock_timestamp())
    where id=r.id returning * into r;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_admin_id,'content_report',r.id,case when p_action in ('removed','restricted') then 'remove_reported_target' else 'resolve_report' end,btrim(p_notes));
  return to_jsonb(r);
end $$;
revoke all on function public.close_public_case(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.close_public_case(uuid,uuid,text,text) to service_role;

commit;
