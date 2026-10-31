begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Operational state is private. Policy text and personal evidence stay out of source control.
create table public.lifecycle_retention_rules (
 source text primary key, relation_name text generated always as (split_part(source,':',1)) stored,
 policy_id uuid references public.compliance_records(id), policy_revision integer,
 due_expression text not null, enabled boolean not null default true
);
create table public.lifecycle_retention_runs (
 id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(),
 source text not null, status text not null check(status in ('completed','blocked','failed')),
 removed integer not null default 0, reason text, error_code text, retry_after timestamptz
);
create table public.deletion_recovery_ledger (
 sequence bigint generated always as identity primary key,
 source_schema text not null, source_table text not null, record_key jsonb not null,
 operation text not null default 'delete' check(operation in ('delete','clear')), cleared_columns text[] not null default '{}',
 deleted_at timestamptz not null default clock_timestamp(),
 check(jsonb_typeof(record_key)='object' and octet_length(record_key::text)<=4000)
);
create index deletion_recovery_ledger_time on public.deletion_recovery_ledger(deleted_at);
create table public.retention_media_jobs (
 id uuid primary key default gen_random_uuid(), bucket text not null, storage_path text not null,
 family text not null check(family in ('image','video','object')),
 trigger_at timestamptz not null default clock_timestamp(),
 state text not null default 'pending' check(state in ('pending','deleting','completed','failed')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, completed_at timestamptz,
 error_code text, confirmed_objects integer, unique(bucket,storage_path),
 check(length(storage_path) between 1 and 1024 and storage_path !~ '(^/|\.\.|\\)')
);
create index retention_media_jobs_due on public.retention_media_jobs(next_attempt_at) where state<>'completed';
create table public.retention_recovery_exports (
 id uuid primary key, created_at timestamptz not null default now(), through_sequence bigint not null,
 object_path text not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$')
);
create table public.retention_recovery_state (
 singleton boolean primary key default true check(singleton), coverage_started_at timestamptz not null default clock_timestamp(),
 export_lease uuid, export_lease_until timestamptz
);
insert into public.retention_recovery_state(singleton) values(true);
create table public.retention_evidence_archive (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('consent','financial')),
 source text not null, record_key jsonb not null, minimal_evidence jsonb not null,
 trigger_at timestamptz not null, expires_at timestamptz not null,
 unique(source,record_key), check(octet_length(minimal_evidence::text)<4000)
);

do $$ declare t text; begin
 foreach t in array array['lifecycle_retention_rules','lifecycle_retention_runs','deletion_recovery_ledger','retention_media_jobs','retention_recovery_exports','retention_recovery_state','retention_evidence_archive'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
  execute format('create policy service_access on public.%I to service_role using(true) with check(true)',t);
 end loop;
end $$;
grant usage,select on sequence public.deletion_recovery_ledger_sequence_seq to service_role;

-- First closure/removal is a durable clock, not updated_at or the date this job was installed.
alter table public.app_users add column retention_closed_at timestamptz;
alter table public.support_threads add column retention_closed_at timestamptz;
alter table public.content_reports add column retention_closed_at timestamptz;
alter table public.dmca_cases add column retention_closed_at timestamptz;
alter table public.dancer_photos add column retention_removed_at timestamptz;
alter table public.dancer_profiles add column approval_email_recorded_at timestamptz;
alter table public.mydancr_tv_videos add column retention_removed_at timestamptz;
alter table public.image_moderation_records add column retention_removed_at timestamptz;
update public.content_reports set retention_closed_at=reviewed_at where status in ('resolved','removed');
update public.dmca_cases set retention_closed_at=coalesce(restored_at,reviewed_at) where status in ('closed','restored','rejected');
update public.mydancr_tv_videos set retention_removed_at=reviewed_at where status='rejected';
update public.image_moderation_records set retention_removed_at=coalesce(reviewed_at,completed_at) where decision='rejected';
update public.dancer_photos p set retention_removed_at=r.reviewed_at from public.image_moderation_records r
 where r.image_id=p.id and p.review_status='rejected' and r.reviewed_at is not null;
update public.dancer_profiles p set approval_email_recorded_at=q.first_recorded from
 (select recipient_id,min(created_at) first_recorded from public.dancer_media_email_deliveries where payload->>'kind'='dancer_profile_approved' group by recipient_id)q
 where p.user_id=q.recipient_id;
create or replace function private.queue_dancer_profile_approval_email() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status is distinct from 'approved' or new.verification_status is distinct from 'approved'
  or new.venue_approved_at is null or new.disabled_at is not null or new.approval_email_recorded_at is not null then return new; end if;
 if tg_op='UPDATE' and old.status='approved' and old.verification_status='approved' and old.venue_approved_at is not null and old.disabled_at is null then return new; end if;
 if not exists(select 1 from public.app_users where id=new.user_id and role='dancer' and account_state='active') then return new; end if;
 insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload)
 values(new.user_id,'Your MyDancr profile is approved','Your MyDancr dancer profile is approved. Open your dashboard to view your profile and check-in status.',
 jsonb_build_object('kind','dancer_profile_approved','dancerId',new.id,'emailPath','/dashboard/dancer'))
 on conflict (recipient_id) where payload->>'kind'='dancer_profile_approved' do nothing;
 update public.dancer_profiles set approval_email_recorded_at=clock_timestamp() where id=new.id and approval_email_recorded_at is null;
 return new;
end $$;
revoke all on function private.queue_dancer_profile_approval_email() from public,anon,authenticated;
grant execute on function private.queue_dancer_profile_approval_email() to service_role;

create function private.retention_original_clock() returns trigger language plpgsql security invoker set search_path='' as $$
declare old_row jsonb:=to_jsonb(old); new_row jsonb:=to_jsonb(new); col text:=tg_argv[0]; state_col text:=tg_argv[1]; terminal boolean;
begin
 terminal:=(new_row->>state_col)=any(string_to_array(tg_argv[2],','));
 if old_row->>col is not null then new_row:=jsonb_set(new_row,array[col],old_row->col);
 elsif terminal and (old_row->>state_col) is distinct from (new_row->>state_col) then
  new_row:=jsonb_set(new_row,array[col],to_jsonb(clock_timestamp()));
 else new_row:=jsonb_set(new_row,array[col],'null'); end if;
 new:=jsonb_populate_record(new,new_row); return new;
end $$;
create trigger retention_clock before update on public.app_users for each row execute function private.retention_original_clock('retention_closed_at','account_state','deleted');
create trigger retention_clock before update on public.support_threads for each row execute function private.retention_original_clock('retention_closed_at','status','closed');
create trigger retention_clock before update on public.content_reports for each row execute function private.retention_original_clock('retention_closed_at','status','resolved,removed');
create trigger retention_clock before update on public.dmca_cases for each row execute function private.retention_original_clock('retention_closed_at','status','closed,restored,rejected');
create trigger retention_clock before update on public.dancer_photos for each row execute function private.retention_original_clock('retention_removed_at','review_status','rejected');
create trigger retention_clock before update on public.mydancr_tv_videos for each row execute function private.retention_original_clock('retention_removed_at','status','rejected');
create trigger retention_clock before update on public.image_moderation_records for each row execute function private.retention_original_clock('retention_removed_at','decision','rejected');

-- Capture only primary keys, never row payloads, emails, names, images or verification results.
-- This internal trigger needs write access when Auth or ordinary RLS callers delete rows.
create function private.capture_deletion_recovery_key() returns trigger language plpgsql security definer set search_path='' as $$
declare k jsonb:='{}'; col text; row_value jsonb:=to_jsonb(old); cleared text[];
begin
 if tg_table_schema not in ('public','auth') then raise exception 'Invalid recovery trigger'; end if;
 foreach col in array tg_argv loop k:=k||jsonb_build_object(col,row_value->col); end loop;
 if k='{}' then raise exception 'Recovery key missing'; end if;
 if tg_op='UPDATE' then
  -- Preserve removal of personal fields and actor/reference links without retaining their old values.
  select array_agg(e.key order by e.key) into cleared from jsonb_each(to_jsonb(new))e
  where e.value='null' and row_value->e.key is distinct from 'null'::jsonb and row_value ? e.key
   and (e.key ~ '(_id|_path|email|phone|address|name|notes|details)$' or e.key in ('verification_url','provider_integration_id'))
   and e.key not in ('lease_id','lease_token','attempt_id');
  if cleared is not null then insert into public.deletion_recovery_ledger(source_schema,source_table,record_key,operation,cleared_columns)
   values(tg_table_schema,tg_table_name,k,'clear',cleared); end if;
  return new;
 end if;
 insert into public.deletion_recovery_ledger(source_schema,source_table,record_key) values(tg_table_schema,tg_table_name,k); return old;
end $$;
revoke all on function private.capture_deletion_recovery_key() from public,anon,authenticated,service_role;
do $$ declare r record; args text; begin
 for r in select c.oid,n.nspname,c.relname,p.conkey from pg_class c join pg_namespace n on n.oid=c.relnamespace
 join pg_constraint p on p.conrelid=c.oid and p.contype='p'
 where (n.nspname='public' or n.nspname='auth' and c.relname='users') and c.relkind='r'
 and c.relname not in ('deletion_recovery_ledger','lifecycle_retention_rules','lifecycle_retention_runs','retention_media_jobs','retention_recovery_exports','retention_recovery_state',
 'diagnostic_retention_runs','diagnostic_retention_settings','diagnostic_retention_hold_reviews','diagnostic_retention_exceptions',
 'compliance_records','compliance_events','dmca_agent_settings') loop
  select string_agg(quote_literal(a.attname),',' order by k.ord) into args
  from unnest(r.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=r.oid and a.attnum=k.attnum;
  execute format('create trigger retention_deleted_key after %s on %I.%I for each row execute function private.capture_deletion_recovery_key(%s)',case when r.nspname='auth' then 'delete' else 'delete or update' end,r.nspname,r.relname,args);
 end loop;
end $$;

-- Fixed SQL expressions are migrations, never request-supplied SQL. Bind every rule to the adopted revision.
create function private.retention_financial_deadline(event_time timestamptz) returns timestamptz language sql immutable security invoker set search_path='' as $$
 select (date_trunc('year',event_time at time zone 'America/Los_Angeles')+interval '8 years') at time zone 'America/Los_Angeles';
$$;
create function private.retention_account_end(account_id uuid) returns timestamptz language sql stable security invoker set search_path='' as $$
 select retention_closed_at from public.app_users where id=account_id and account_state='deleted';
$$;
create function private.retention_pickup_end(request_id uuid) returns timestamptz language sql stable security invoker set search_path='' as $$
 select case when status in ('completed','cancelled','expired','no_show') then coalesce(completed_at,cancelled_at,expires_at) end
 from public.pickup_requests where id=request_id;
$$;
revoke all on function private.retention_financial_deadline(timestamptz),private.retention_account_end(uuid),private.retention_pickup_end(uuid) from public,anon,authenticated;
grant execute on function private.retention_financial_deadline(timestamptz),private.retention_account_end(uuid),private.retention_pickup_end(uuid) to service_role;
insert into public.lifecycle_retention_rules(source,policy_id,policy_revision,due_expression)
select v.source,p.id,p.revision,v.due_expression from (values
 ('admin_review_email_deliveries','Security logs',$e$case when t.status in ('accepted','skipped','failed') and coalesce(t.lease_until,'-infinity')<now() then t.created_at+interval '90 days' end$e$),
 ('admin_review_email_events','Security logs',$e$case when not exists(select 1 from public.admin_review_email_deliveries d where d.event_key=t.event_key and d.status in ('pending','sending')) then t.created_at+interval '90 days' end$e$),
 ('dancer_media_email_deliveries','Security logs',$e$case when t.status in ('accepted','skipped','failed') and coalesce(t.lease_until,'-infinity')<now() then t.created_at+interval '90 days' end$e$),
 ('venue_email_deliveries','Security logs',$e$case when t.status in ('accepted','skipped','failed') and coalesce(t.lease_until,'-infinity')<now() then t.created_at+interval '30 days' end$e$),
 ('internal_request_email_deliveries','Security logs',$e$case when t.state in ('sent','skipped','failed') and coalesce(t.lease_until,'-infinity')<now() then t.created_at+interval '90 days' end$e$),
 ('internal_request_push_deliveries','Security logs',$e$case when t.state in ('sent','skipped','failed') and coalesce(t.lease_until,'-infinity')<now() then t.created_at+interval '90 days' end$e$),
 ('dancer_table_request_deliveries','Security logs',$e$case when t.state in ('sent','skipped','failed') and coalesce(t.lease_until,'-infinity')<now() then t.created_at+interval '90 days' end$e$),
 ('web_push_receipts','Security logs',$e$t.delivered_at+interval '90 days'$e$),
 ('support_ai_runs','Security logs',$e$t.created_at+interval '90 days'$e$),
 ('venue_email_events','Security logs',$e$case when t.event_key not like 'media:%' then t.created_at+interval '90 days' end$e$),
 ('venue_email_events:media','Account records',$e$case when t.event_key like 'media:%' and not exists(
  select 1 from public.dancer_club_media((select array_agg(id) from public.dancer_profiles)) m
  left join public.club_media_permissions p on p.venue_id=t.venue_id and p.source=m.source and p.media_id=m.id
  where t.event_key='media:'||t.venue_id||':'||m.source||':'||m.id||':'||m.content_version and p.content_version is distinct from m.content_version
 ) then t.created_at end$e$),
 ('retention_evidence_archive:consent','Consent receipts',$e$case when t.kind='consent' then t.expires_at end$e$),
 ('retention_evidence_archive:financial','Club financial records',$e$case when t.kind='financial' then t.expires_at end$e$),
 ('club_invoices','Club financial records',$e$case when t.status in ('paid','void','voided','uncollectible') then private.retention_financial_deadline(greatest(t.period_end::timestamptz,t.paid_at,t.created_at)) end$e$),
 ('agent_commission_events','Club financial records',$e$case when not exists(select 1 from public.nats_agent_commission_exports e where e.agent_commission_event_id=t.id) then private.retention_financial_deadline(greatest(t.created_at,t.paid_at,t.voided_at)) end$e$),
 ('deal_revenue_events','Club financial records',$e$case when not exists(select 1 from public.agent_commission_events a where a.deal_revenue_event_id=t.id) and not exists(select 1 from public.club_invoice_items i where i.revenue_event_id=t.id) then private.retention_financial_deadline(greatest(t.created_at,t.venue_payment_received_at,t.dancer_paid_at,t.refunded_at,t.voided_at)) end$e$),
 ('commission_events','Club financial records',$e$case when not exists(select 1 from public.dancer_earning_status_history h where h.earning_id=t.id) and not exists(select 1 from public.dancer_payout_items i where i.commission_event_id=t.id) and not exists(select 1 from public.nats_commission_exports e where e.commission_event_id=t.id) then private.retention_financial_deadline(greatest(t.created_at,t.paid_at,t.reversed_at,t.voided_at)) end$e$),
 ('dancer_earning_status_history','Club financial records',$e$private.retention_financial_deadline(t.created_at)$e$),
 ('dancer_payout_batches','Club financial records',$e$case when t.status in ('paid','failed','cancelled','canceled') then private.retention_financial_deadline(greatest(t.created_at,t.paid_at,t.failed_at,t.canceled_at)) end$e$),
 ('financial_audit_events','Club financial records',$e$private.retention_financial_deadline(t.created_at)$e$),
 ('nats_commission_exports','Club financial records',$e$private.retention_financial_deadline(greatest(t.created_at,t.reconciled_at))$e$),
 ('nats_agent_commission_exports','Club financial records',$e$private.retention_financial_deadline(greatest(t.created_at,t.reconciled_at))$e$),
 ('dancer_age_verifications','Limited verification results',$e$private.retention_account_end(t.user_id)+interval '3 years'$e$),
 ('user_terms_acceptances','Consent receipts',$e$private.retention_account_end(t.user_id)+interval '6 years'$e$),
 ('dancer_agreement_acceptances','Consent receipts',$e$private.retention_account_end(t.user_id)+interval '6 years'$e$),
 ('dancer_biometric_consents','Consent receipts',$e$private.retention_account_end(t.user_id)+interval '6 years'$e$),
 ('account_terms_acceptances','Consent receipts',$e$private.retention_account_end(t.user_id)+interval '6 years'$e$),
 ('vip_access_acceptances','Consent receipts',$e$private.retention_account_end(t.user_id)+interval '6 years'$e$),
 ('customer_email_consent_events','Consent receipts',$e$least(private.retention_account_end(t.user_id),(select min(c.recorded_at) from public.customer_email_consent_events c where c.user_id=t.user_id and c.channel=t.channel and not c.enabled and c.recorded_at>=t.recorded_at))+interval '6 years'$e$),
 ('dmca_cases','Safety decisions and appeals',$e$case when t.status in ('closed','restored','rejected') and not t.court_filing_received then t.retention_closed_at+interval '3 years' end$e$),
 ('shifts','Detailed interactions and analytics',$e$case when coalesce(t.working_status,'')<>'working' and t.ends_at<now() then greatest(t.ends_at,t.ended_at,t.checked_out_at)+interval '13 months' end$e$),
 ('gallery_media_reference_history','Detailed interactions and analytics',$e$t.recorded_at+interval '13 months'$e$),
 ('pickup_messages','Guest, pickup, table and VIP requests',$e$case when not exists(select 1 from public.pickup_reports r where r.pickup_request_id=t.pickup_request_id) then private.retention_pickup_end(t.pickup_request_id)+interval '180 days' end$e$),
 ('pickup_read_receipts','Guest, pickup, table and VIP requests',$e$private.retention_pickup_end(t.pickup_request_id)+interval '180 days'$e$),
 ('pickup_guest_access','Guest, pickup, table and VIP requests',$e$private.retention_pickup_end(t.pickup_request_id)+interval '180 days'$e$),
 ('pickup_events','Guest, pickup, table and VIP requests',$e$case when not exists(select 1 from public.pickup_reports r where r.pickup_request_id=t.pickup_request_id) then private.retention_pickup_end(t.pickup_request_id)+interval '180 days' end$e$),
 ('pickup_consents','Consent receipts',$e$private.retention_pickup_end(t.pickup_request_id)+interval '180 days'$e$),
 ('pickup_arrival_evidence','Guest, pickup, table and VIP requests',$e$private.retention_pickup_end(t.pickup_request_id)+interval '180 days'$e$),
 ('pickup_requests','Guest, pickup, table and VIP requests',$e$case when not exists(select 1 from public.pickup_reports r where r.pickup_request_id=t.id) then private.retention_pickup_end(t.id)+interval '180 days' end$e$),
 ('venue_guest_list_entries','Guest, pickup, table and VIP requests',$e$(select greatest(r.expires_at,r.redeemed_at,r.voided_at)+interval '180 days' from public.qr_redemptions r where r.id=t.pass_id)$e$),
 ('venue_ride_status_events','Guest, pickup, table and VIP requests',$e$t.created_at+interval '180 days'$e$),
 ('profile_views','Detailed interactions and analytics',$e$t.viewed_at + interval '13 months'$e$),
 ('schedule_views','Detailed interactions and analytics',$e$t.viewed_at + interval '13 months'$e$),
 ('social_clicks','Detailed interactions and analytics',$e$t.clicked_at + interval '13 months'$e$),
 ('direction_requests','Detailed interactions and analytics',$e$t.requested_at + interval '13 months'$e$),
 ('discovery_events','Detailed interactions and analytics',$e$t.occurred_at + interval '13 months'$e$),
 ('mydancr_tv_events','Detailed interactions and analytics',$e$t.occurred_at + interval '13 months'$e$),
 ('venue_page_events','Detailed interactions and analytics',$e$t.occurred_at + interval '13 months'$e$),
 ('venue_interactions','Detailed interactions and analytics',$e$t.occurred_at + interval '13 months'$e$),
 ('shift_location_events','Detailed interactions and analytics',$e$t.occurred_at + interval '13 months'$e$),
 ('venue_dancer_attendance_events','Detailed interactions and analytics',$e$t.occurred_at + interval '13 months'$e$),
 ('venue_dancer_affiliation_events','Detailed interactions and analytics',$e$t.occurred_at + interval '13 months'$e$),
 ('nfc_tap_events','Detailed interactions and analytics',$e$t.occurred_at + interval '13 months'$e$),
 ('ranking_events','Detailed interactions and analytics',$e$t.created_at + interval '13 months'$e$),
 ('media_likes','Detailed interactions and analytics',$e$t.created_at + interval '13 months'$e$),
 ('going_signals','Detailed interactions and analytics',$e$t.created_at + interval '13 months'$e$),
 ('dancer_hair_color_periods','Detailed interactions and analytics',$e$case when t.ended_at is not null then t.ended_at + interval '13 months' end$e$),
 ('venue_dancer_work_sessions','Detailed interactions and analytics',$e$case when t.closed_at is not null then t.closed_at + interval '13 months' end$e$),
 ('discovery_sessions','Security logs',$e$t.expires_at$e$),
 ('account_email_actions','Security logs',$e$t.created_at + interval '90 days'$e$),
 ('user_terms_signup_intents','Account records',$e$t.expires_at$e$),
 ('dancer_agreement_signup_intents','Account records',$e$t.expires_at$e$),
 ('customer_email_signup_intents','Account records',$e$t.expires_at$e$),
 ('customer_signup_venue_shares','Guest, pickup, table and VIP requests',$e$t.expires_at$e$),
 ('venue_team_invitations','Account records',$e$case when t.accepted_at is null then coalesce(t.revoked_at,t.expires_at) end$e$),
 ('venue_vip_invitations','Account records',$e$case when t.accepted_at is null then coalesce(t.revoked_at,t.expires_at) end$e$),
 ('venue_dancer_verification_tokens','Account records',$e$coalesce(t.revoked_at,t.expires_at)$e$),
 ('internal_roster_requests','Guest, pickup, table and VIP requests',$e$case when t.status in ('completed','cancelled') then coalesce(t.completed_at,t.cancelled_at) + interval '180 days' end$e$),
 ('venue_vip_requests','Guest, pickup, table and VIP requests',$e$case when t.status in ('declined','cancelled') then coalesce(t.declined_at,t.cancelled_at) + interval '180 days' when t.status='confirmed' then t.starts_at + interval '180 days' end$e$),
 ('support_threads','Support and privacy cases',$e$case when t.status='closed' then t.retention_closed_at + interval '24 months' end$e$),
 ('content_reports','Support and privacy cases',$e$case when t.case_kind in ('privacy','support') and t.status in ('resolved','removed') then t.retention_closed_at + interval '24 months' end$e$),
 ('content_reports:safety','Safety decisions and appeals',$e$case when t.case_kind='safety' and t.status in ('resolved','removed') and not exists(select 1 from public.safety_media_restrictions s where s.report_id=t.id) and coalesce(t.workflow->>'preservation','')='' then t.retention_closed_at + interval '3 years' end$e$),
 ('dancer_photos','Removed media and derivatives',$e$case when t.review_status='rejected' then t.retention_removed_at + interval '30 days' end$e$),
 ('image_moderation_records','Removed media and derivatives',$e$case when t.decision='rejected' then t.retention_removed_at + interval '30 days' end$e$),
 ('mydancr_tv_videos','Removed media and derivatives',$e$case when t.status='rejected' then t.retention_removed_at + interval '30 days' end$e$)
) v(source,title,due_expression) left join lateral (select id,revision from public.compliance_records where kind='retention' and title=v.title and status='verified' order by created_at,id limit 1)p on true;

create function public.preview_lifecycle_retention() returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' set statement_timeout='20s' as $$
declare r record; n bigint; sources jsonb:='[]'; blocked text;
begin
 for r in select * from public.lifecycle_retention_rules order by source loop
  blocked:=case when not r.enabled then 'paused' when not exists(select 1 from public.compliance_records where id=r.policy_id and revision=r.policy_revision and status='verified') then 'policy_review_required'
   when exists(select 1 from public.compliance_records where kind='hold' and status<>'completed') then 'active_preservation_hold' end;
  execute format('select count(*) from public.%I t where (%s)<=now()',r.relation_name,r.due_expression) into n;
  sources:=sources||jsonb_build_array(jsonb_build_object('source',r.source,'due',n,'blocker',blocked));
 end loop;
 return jsonb_build_object('asOf',now(),'sources',sources,'batchLimit',100,
  'media',coalesce((select jsonb_agg(x) from(select state,count(*) count from public.retention_media_jobs group by state)x),'[]'),
  'latestExport',(select to_jsonb(x) from (select created_at,through_sequence from public.retention_recovery_exports order by created_at desc limit 1)x),
  'unmappedClocks',jsonb_build_object('closedAccounts',(select count(*) from public.app_users where account_state='deleted' and retention_closed_at is null),
   'support',(select count(*) from public.support_threads where status='closed' and retention_closed_at is null),
   'rejectedPhotos',(select count(*) from public.dancer_photos where review_status='rejected' and retention_removed_at is null)));
end $$;

create function public.run_lifecycle_retention() returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' set statement_timeout='25s' set lock_timeout='2s' as $$
declare r record; n integer; code text; result jsonb:='[]'; blocker text;
begin
 if not pg_try_advisory_xact_lock(71031,90) then return jsonb_build_object('status','busy'); end if;
 perform set_config('mydancr.retention_worker','on',true);
 perform 1 from public.compliance_records where kind in ('retention','hold') order by id for share;
 for r in select * from public.lifecycle_retention_rules order by source loop
  blocker:=case when not r.enabled then 'paused' when not exists(select 1 from public.compliance_records where id=r.policy_id and revision=r.policy_revision and status='verified') then 'policy_review_required'
   when exists(select 1 from public.compliance_records where kind='hold' and status<>'completed') then 'active_preservation_hold' end;
  if blocker is not null then
   insert into public.lifecycle_retention_runs(source,status,reason,retry_after) values(r.source,'blocked',blocker,now()+interval '1 hour');
   result:=result||jsonb_build_array(jsonb_build_object('source',r.source,'status','blocked','reason',blocker)); continue;
  end if;
  begin
   execute format('with candidates as (select t.ctid from public.%I t where (%s)<=now() order by (%s),t.ctid limit 100 for update skip locked) delete from public.%I t using candidates c where t.ctid=c.ctid',r.relation_name,r.due_expression,r.due_expression,r.relation_name);
   get diagnostics n=row_count;
   insert into public.lifecycle_retention_runs(source,status,removed) values(r.source,'completed',n);
   result:=result||jsonb_build_array(jsonb_build_object('source',r.source,'status','completed','removed',n));
  exception when others then
   get stacked diagnostics code=returned_sqlstate;
   insert into public.lifecycle_retention_runs(source,status,error_code,retry_after) values(r.source,'failed',code,now()+interval '1 hour');
   result:=result||jsonb_build_array(jsonb_build_object('source',r.source,'status','failed','errorCode',code));
  end;
 end loop;
 delete from public.lifecycle_retention_runs where started_at<now()-interval '90 days';
 -- Original deletion clock. An export or restore never extends the recovery-key retention.
 delete from public.deletion_recovery_ledger where deleted_at<now()-interval '90 days';
 perform set_config('mydancr.retention_worker','off',true);
 return jsonb_build_object('status',case when exists(select 1 from jsonb_array_elements(result)x where x->>'status'='failed') then 'failed' else 'completed' end,'sources',result);
end $$;

-- Existing append-only audit safeguards stay in place for ordinary operations.
-- Only the bounded retention transaction (or isolated recovery) can expire records.
create or replace function public.prohibit_financial_record_delete() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and current_user in ('service_role','postgres') and current_setting('mydancr.retention_worker',true)='on' then return old; end if;
 raise exception using errcode='22023',message='Financial records cannot be deleted outside retention.';
end $$;
create or replace function public.prevent_pickup_history_rewrite() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and current_user in ('service_role','postgres') and current_setting('mydancr.retention_worker',true)='on' then return old; end if;
 raise exception using errcode='42501',message='Pickup history cannot be edited or deleted outside retention.';
end $$;
revoke all on function public.prohibit_financial_record_delete(),public.prevent_pickup_history_rewrite() from public,anon,authenticated,service_role;

create function private.archive_pickup_retention_evidence() returns trigger language plpgsql security invoker set search_path='' as $$
declare ended timestamptz; deadline timestamptz; k jsonb; evidence jsonb; category text;
begin
 if current_setting('mydancr.retention_worker',true) is distinct from 'on' then return old; end if;
 ended:=private.retention_pickup_end(old.pickup_request_id);
 if ended is null then raise exception 'Original pickup closure is required'; end if;
 if tg_table_name='pickup_consents' then
  category:='consent'; deadline:=ended+interval '6 years';
  k:=jsonb_build_object('pickup_request_id',old.pickup_request_id,'user_id',old.user_id,'consent_version',old.consent_version);
  evidence:=jsonb_build_object('consent_version',old.consent_version,'accepted_at',old.accepted_at);
 else
  if not exists(select 1 from public.deal_revenue_events where qr_redemption_id=old.redemption_id) then return old; end if;
  category:='financial'; deadline:=private.retention_financial_deadline(old.created_at);
  k:=jsonb_build_object('id',old.id);
  evidence:=jsonb_build_object('redemption_id',old.redemption_id,'source',old.source,'created_at',old.created_at);
 end if;
 if deadline>now() then
  insert into public.retention_evidence_archive(kind,source,record_key,minimal_evidence,trigger_at,expires_at)
  values(category,tg_table_name,k,evidence,ended,deadline) on conflict(source,record_key) do nothing;
 end if;
 return old;
end $$;
create trigger retention_minimal_consent before delete on public.pickup_consents for each row execute function private.archive_pickup_retention_evidence();
create trigger retention_minimal_arrival before delete on public.pickup_arrival_evidence for each row execute function private.archive_pickup_retention_evidence();
revoke all on function private.archive_pickup_retention_evidence() from public,anon,authenticated;
grant execute on function private.archive_pickup_retention_evidence() to service_role;

do $$ declare r record; begin
 for r in select distinct relation_name from public.lifecycle_retention_rules loop
  execute format('grant select,update,delete on public.%I to service_role',r.relation_name);
 end loop;
end $$;
-- Queue storage bytes in the SAME transaction as reference removal, including Auth cascades.
-- Guard against reintroducing a retired path. Randomized upload paths must never be reused.
create function private.track_retention_media() returns trigger language plpgsql security definer set search_path='' as $$
declare before_path text:=to_jsonb(old)->>tg_argv[1]; after_path text:=to_jsonb(new)->>tg_argv[1];
begin
 if tg_table_schema<>'public' then raise exception 'Invalid media retention trigger'; end if;
 if tg_op<>'DELETE' and after_path is not null and after_path is distinct from before_path then
  perform pg_advisory_xact_lock(hashtextextended(tg_argv[0]||'/'||after_path,71));
  if exists(select 1 from public.retention_media_jobs where bucket=tg_argv[0] and state in ('deleting','completed')
    and (storage_path=after_path or starts_with(after_path,storage_path||'.'))) then
   raise exception 'Retired media path cannot be reused';
  end if;
 end if;
 if before_path is not null and (tg_op='DELETE' or before_path is distinct from after_path) then
  perform pg_advisory_xact_lock(hashtextextended(tg_argv[0]||'/'||before_path,71));
  insert into public.retention_media_jobs(bucket,storage_path,family) values(tg_argv[0],before_path,tg_argv[2]) on conflict(bucket,storage_path) do nothing;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function private.track_retention_media() from public,anon,authenticated,service_role;
do $$ declare r record; begin
 for r in select * from (values
 ('dancer_photos','storage_path','dancer-photos','image'),
 ('dancer_profiles','avatar_storage_path','dancer-photos','image'),
 ('image_moderation_records','final_storage_path','dancer-photos','image'),
 ('image_moderation_records','temporary_storage_path','dancr-image-moderation-temp','object'),
 ('image_moderation_records','temporary_storage_path','dancr-image-moderation-review','object'),
 ('mydancr_tv_videos','storage_path','mydancr-tv-videos','video'),
 ('photo_upload_reservations','storage_path','dancer-photo-uploads','object'),
 ('venue_ownership_claims','proof_storage_path','venue-ownership-proofs','object'),
 ('venues','cover_image_storage_path','venue-cover-images','image'),
 ('venues','logo_storage_path','venue-logo-images','image'),
 ('venues','qr_code_storage_path','venue-qr-codes','object')
 )v(relation_name,column_name,bucket,family) loop
  execute format('create trigger %I before insert or update of %I or delete on public.%I for each row execute function private.track_retention_media(%L,%L,%L)',
   'retention_media_'||r.column_name||'_'||substr(md5(r.bucket),1,6),r.column_name,r.relation_name,r.bucket,r.column_name,r.family);
 end loop;
end $$;

-- This lookup deliberately treats pending/rejected but still-linked media as referenced.
create function private.retention_media_referenced(b text,p text) returns boolean language sql stable security invoker set search_path='' as $$
 select case b
 when 'dancer-photos' then exists(select 1 from public.dancer_photos where storage_path=p)
  or exists(select 1 from public.dancer_profiles where avatar_storage_path=p or starts_with(avatar_storage_path,p||'.') or avatar_source_storage_path=p)
  or exists(select 1 from public.image_moderation_records where final_storage_path=p)
 when 'mydancr-tv-videos' then exists(select 1 from public.mydancr_tv_videos where storage_path=p)
 when 'dancr-image-moderation-temp' then exists(select 1 from public.image_moderation_records where temporary_storage_path=p)
 when 'dancr-image-moderation-review' then exists(select 1 from public.image_moderation_records where temporary_storage_path=p)
 when 'dancer-photo-uploads' then exists(select 1 from public.photo_upload_reservations where storage_path=p)
 when 'venue-ownership-proofs' then exists(select 1 from public.venue_ownership_claims where proof_storage_path=p)
 when 'venue-cover-images' then exists(select 1 from public.venues where cover_image_storage_path=p)
 when 'venue-logo-images' then exists(select 1 from public.venues where logo_storage_path=p)
 when 'venue-qr-codes' then exists(select 1 from public.venues where qr_code_storage_path=p)
 else true end;
$$;

create function public.claim_retention_media() returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' set statement_timeout='10s' as $$
declare j public.retention_media_jobs; result jsonb:='[]';
begin
 if not pg_try_advisory_xact_lock(71031,90) then return result; end if;
 if exists(select 1 from public.compliance_records where kind='hold' and status<>'completed') then return result; end if;
 if not exists(select 1 from public.lifecycle_retention_rules r join public.compliance_records p on p.id=r.policy_id and p.revision=r.policy_revision
  where r.source='dancer_photos' and r.enabled and p.status='verified') then return result; end if;
 for j in select * from public.retention_media_jobs where state<>'completed' and next_attempt_at<=now() and (lease_until is null or lease_until<now())
  order by next_attempt_at,id limit 20 for update skip locked loop
  perform pg_advisory_xact_lock(hashtextextended(j.bucket||'/'||j.storage_path,71));
  if private.retention_media_referenced(j.bucket,j.storage_path) or exists(select 1 from public.safety_media_restrictions where bucket=j.bucket and storage_path=j.storage_path) then
   update public.retention_media_jobs set next_attempt_at=now()+interval '1 hour',error_code='reference_or_restriction' where id=j.id; continue;
  end if;
  update public.retention_media_jobs set state='deleting',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=j.id returning * into j;
  result:=result||jsonb_build_array(to_jsonb(j));
 end loop;
 return result;
end $$;

-- A released historic gallery reference is evidence of removal; unrelated objects are never guessed to be abandoned.
insert into public.retention_media_jobs(bucket,storage_path,family,trigger_at)
select 'dancer-photos',h.storage_path,'image',min(h.recorded_at) from public.gallery_media_reference_history h
where h.event_kind='released' and not private.retention_media_referenced('dancer-photos',h.storage_path)
group by h.storage_path on conflict(bucket,storage_path) do nothing;

create function public.export_deletion_recovery(p_lease uuid) returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare s public.retention_recovery_state; ceiling bigint;
begin
 select * into s from public.retention_recovery_state where singleton for update;
 if s.export_lease_until>now() and s.export_lease<>p_lease then raise exception 'Recovery export busy'; end if;
 update public.retention_recovery_state set export_lease=p_lease,export_lease_until=now()+interval '5 minutes' where singleton;
 select coalesce(max(sequence),0) into ceiling from public.deletion_recovery_ledger;
 if (select count(*) from public.deletion_recovery_ledger)>50000 then raise exception 'Recovery export requires paginated maintenance'; end if;
 return jsonb_build_object('version',1,'exportedAt',clock_timestamp(),'coverageStartedAt',s.coverage_started_at,'throughSequence',ceiling,
 'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by sequence) from public.deletion_recovery_ledger l where sequence<=ceiling and deleted_at>=now()-interval '90 days'),'[]'),
 'media',coalesce((select jsonb_agg(to_jsonb(j) order by id) from public.retention_media_jobs j),'[]'));
end $$;
create function public.assert_retention_restore_isolated() returns boolean language sql stable security invoker set search_path='' as $$
 select not has_schema_privilege('anon','public','USAGE') and not has_schema_privilege('authenticated','public','USAGE');
$$;
create function public.closed_accounts_for_retention() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(id),'[]') from (
  select a.id from public.app_users a where a.account_state='deleted'
  and exists(select 1 from public.lifecycle_retention_rules r join public.compliance_records p on p.id=r.policy_id and p.revision=r.policy_revision
   where r.source='venue_team_invitations' and r.enabled and p.status='verified')
  and not exists(select 1 from public.compliance_records where kind='hold' and status<>'completed')
  order by a.retention_closed_at nulls last,a.id limit 20
 ) candidates;
$$;
revoke all on function public.assert_retention_restore_isolated(),public.closed_accounts_for_retention() from public,anon,authenticated;
grant execute on function public.assert_retention_restore_isolated(),public.closed_accounts_for_retention() to service_role;
create function public.confirm_deletion_recovery_export(p_lease uuid,p_sequence bigint,p_sha256 text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.retention_recovery_state where singleton and export_lease=p_lease and export_lease_until>now()) then raise exception 'Recovery export lease expired'; end if;
 insert into public.retention_recovery_exports(id,through_sequence,object_path,sha256) values(p_lease,p_sequence,'current.json',p_sha256);
 update public.retention_recovery_state set export_lease=null,export_lease_until=null where singleton;
 delete from public.retention_recovery_exports where created_at<now()-interval '90 days';
 return true;
end $$;

-- Service-only recovery primitive. Call only in an isolated restored target, never as a live-site test.
-- No arbitrary relation or predicate can be passed: the table must carry our PK-only recovery trigger.
create function public.reapply_deleted_record(p_schema text,p_table text,p_key jsonb,p_deleted_at timestamptz) returns integer
language plpgsql security invoker set search_path='' set lock_timeout='2s' set statement_timeout='10s' as $$
declare rel regclass; keys text[]; names text[]; n integer;
begin
 if p_schema<>'public' or p_deleted_at>clock_timestamp() or p_deleted_at<now()-interval '90 days' then raise exception 'Unsupported recovery record'; end if;
 rel:=to_regclass(format('%I.%I',p_schema,p_table));
 if not public.assert_retention_restore_isolated() then raise exception 'Restored target must be isolated'; end if;
 if not exists(select 1 from pg_trigger where tgrelid=rel and tgname='retention_deleted_key') then raise exception 'Unregistered recovery source'; end if;
 select array_agg(a.attname::text order by a.attname) into keys from pg_constraint c cross join unnest(c.conkey)k
 join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k where c.conrelid=rel and c.contype='p';
 select array_agg(k order by k) into names from jsonb_object_keys(p_key) k;
 if keys is distinct from names or exists(select 1 from jsonb_each(p_key) where value='null') then raise exception 'Invalid recovery primary key'; end if;
 perform set_config('mydancr.retention_worker','on',true);
 execute format('delete from %s t where to_jsonb(t) @> $1',rel) using p_key;
 get diagnostics n=row_count;
 perform set_config('mydancr.retention_worker','off',true);
 update public.deletion_recovery_ledger set deleted_at=least(deleted_at,p_deleted_at) where source_schema=p_schema and source_table=p_table and record_key=p_key;
 return n;
end $$;
create function public.reapply_cleared_fields(p_table text,p_key jsonb,p_columns text[],p_deleted_at timestamptz) returns integer
language plpgsql security invoker set search_path='' set lock_timeout='2s' set statement_timeout='10s' as $$
declare rel regclass; keys text[]; names text[]; assignments text; n integer;
begin
 if p_deleted_at>clock_timestamp() or p_deleted_at<now()-interval '90 days' or coalesce(cardinality(p_columns),0)=0 then raise exception 'Unsupported recovery record'; end if;
 rel:=to_regclass(format('public.%I',p_table));
 if not public.assert_retention_restore_isolated() then raise exception 'Restored target must be isolated'; end if;
 if not exists(select 1 from pg_trigger where tgrelid=rel and tgname='retention_deleted_key') then raise exception 'Unregistered recovery source'; end if;
 select array_agg(a.attname::text order by a.attname) into keys from pg_constraint c cross join unnest(c.conkey)k
 join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k where c.conrelid=rel and c.contype='p';
 select array_agg(k order by k) into names from jsonb_object_keys(p_key)k;
 if keys is distinct from names or exists(select 1 from jsonb_each(p_key) where value='null')
 or exists(select 1 from unnest(p_columns)c where c=any(keys) or not exists(select 1 from pg_attribute a where a.attrelid=rel and a.attname=c and not a.attisdropped and a.attnum>0)) then raise exception 'Invalid recovery fields'; end if;
 select string_agg(format('%I=null',c),',') into assignments from unnest(p_columns)c;
 execute format('update %s t set %s where to_jsonb(t) @> $1',rel,assignments) using p_key;
 get diagnostics n=row_count;
 update public.deletion_recovery_ledger set deleted_at=least(deleted_at,p_deleted_at) where source_schema='public' and source_table=p_table and record_key=p_key and operation='clear';
 return n;
end $$;
revoke all on function public.reapply_cleared_fields(text,jsonb,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.reapply_cleared_fields(text,jsonb,text[],timestamptz) to service_role;
revoke all on function public.export_deletion_recovery(uuid),public.confirm_deletion_recovery_export(uuid,bigint,text),public.reapply_deleted_record(text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.export_deletion_recovery(uuid),public.confirm_deletion_recovery_export(uuid,bigint,text),public.reapply_deleted_record(text,text,jsonb,timestamptz) to service_role;

create function public.finish_retention_media(p_id uuid,p_lease uuid,p_paths jsonb,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.retention_media_jobs; item jsonb;
begin
 select * into j from public.retention_media_jobs where id=p_id and lease_id=p_lease and state='deleting' for update;
 if not found then raise exception 'Refresh media cleanup lease'; end if;
 if p_error is not null then
  update public.retention_media_jobs set state='failed',error_code='storage_cleanup_failed',lease_id=null,lease_until=null,next_attempt_at=now()+interval '1 hour' where id=j.id; return false;
 end if;
 if jsonb_typeof(p_paths) is distinct from 'array' or jsonb_array_length(p_paths) not between 1 and 32 then raise exception 'Missing storage confirmation'; end if;
 if not exists(select 1 from jsonb_array_elements(p_paths)x where x->>'bucket'=j.bucket and x->>'path'=j.storage_path) then raise exception 'Missing original object confirmation'; end if;
 for item in select * from jsonb_array_elements(p_paths) loop
  if exists(select 1 from storage.objects where bucket_id=item->>'bucket' and name=item->>'path') then raise exception 'Storage object still present'; end if;
 end loop;
 update public.retention_media_jobs set state='completed',completed_at=clock_timestamp(),lease_id=null,lease_until=null,error_code=null,confirmed_objects=jsonb_array_length(p_paths) where id=j.id;
 return true;
end $$;

revoke all on function private.retention_media_referenced(text,text),public.claim_retention_media(),public.finish_retention_media(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function private.retention_media_referenced(text,text),public.claim_retention_media(),public.finish_retention_media(uuid,uuid,jsonb,text) to service_role;
revoke all on function private.retention_original_clock(),public.preview_lifecycle_retention(),public.run_lifecycle_retention() from public,anon,authenticated;
grant execute on function private.retention_original_clock(),public.preview_lifecycle_retention(),public.run_lifecycle_retention() to service_role;
notify pgrst,'reload schema';
commit;
