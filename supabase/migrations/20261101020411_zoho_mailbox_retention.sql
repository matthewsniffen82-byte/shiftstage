begin;
set local statement_timeout='30s';

create table public.mailbox_retention_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 updated_at timestamptz not null default now(), updated_by uuid references public.app_users(id) on delete set null
);
insert into public.mailbox_retention_settings(singleton) values(true);
create table public.mailbox_retention_jobs (
 id uuid primary key default gen_random_uuid(),
 source_table text not null check(source_table in ('content_reports','support_threads')), source_id uuid not null,
 category text not null check(category in ('support','privacy','safety')),
 account_id text not null check(account_id ~ '^[0-9]{1,24}$'),
 message_id text not null check(message_id ~ '^[0-9]{1,24}$'), folder_id text not null check(folder_id ~ '^[0-9]{1,24}$'),
 search_phrase text not null check(length(search_phrase) between 8 and 150 and search_phrase !~ '["\n\r]' and position('::' in search_phrase)=0),
 closed_at timestamptz not null, maximum_due_at timestamptz not null, due_at timestamptz not null,
 policy_id uuid not null references public.compliance_records(id), policy_revision integer not null,
 approved_by uuid references public.app_users(id) on delete set null, approved_at timestamptz not null default now(),
 minimization_reason text not null default '' check(length(minimization_reason)<=500),
 source_deleted boolean not null default false, source_invalidated boolean not null default false, paused boolean not null default false,
 state text not null default 'scheduled' check(state in ('scheduled','processing','retry','trashed','trash_removed','absent')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, first_removed_at timestamptz, last_checked_at timestamptz, error_code text,
 unique(account_id,message_id), check(due_at>=closed_at and due_at<=maximum_due_at)
);
create index mailbox_retention_due on public.mailbox_retention_jobs(next_attempt_at,due_at) where not paused;
create index mailbox_retention_source on public.mailbox_retention_jobs(source_table,source_id);
create table public.mailbox_retention_receipts (
 id uuid primary key default gen_random_uuid(), job_id uuid references public.mailbox_retention_jobs(id) on delete set null,
 created_at timestamptz not null default now(), outcome text not null check(outcome ~ '^[a-z0-9_]{1,80}$'),
 actor_id uuid references public.app_users(id) on delete set null
);
create index mailbox_retention_receipts_time on public.mailbox_retention_receipts(created_at);
do $$ declare t text; begin
 foreach t in array array['mailbox_retention_settings','mailbox_retention_jobs','mailbox_retention_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
  execute format('create policy service_access on public.%I to service_role using(true) with check(true)',t);
 end loop;
end $$;

create function private.mailbox_owner(p_actor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.app_users where id=p_actor and role='admin' and account_state='active' and admin_workspace_role='owner');
$$;
create function public.mailbox_case_context(p_source text,p_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare category text; stamp timestamptz; terminal boolean; preserved boolean:=false; policy public.compliance_records;
begin
 if p_source='content_reports' then
  select r.case_kind,r.retention_closed_at,r.status in ('resolved','removed'),
   coalesce(r.workflow->>'preservation','')<>'' or exists(select 1 from public.safety_media_restrictions s where s.report_id=r.id)
  into category,stamp,terminal,preserved from public.content_reports r where r.id=p_id;
 elsif p_source='support_threads' then
  select 'support',t.retention_closed_at,t.status='closed' into category,stamp,terminal from public.support_threads t where t.id=p_id;
 else raise exception 'Invalid mailbox case source'; end if;
 if category is null or category not in ('support','privacy','safety') or stamp is null or not terminal or preserved or stamp>now() then return null; end if;
 if (select count(*) from public.compliance_records where kind='retention' and status='verified'
  and title=case when category='safety' then 'Safety decisions and appeals' else 'Support and privacy cases' end)<>1 then return null; end if;
 select * into policy from public.compliance_records where kind='retention' and status='verified'
  and title=case when category='safety' then 'Safety decisions and appeals' else 'Support and privacy cases' end;
 if policy.id is null then return null; end if;
 return jsonb_build_object('category',category,'closedAt',stamp,'maximumDueAt',stamp+case when category='safety' then interval '3 years' else interval '24 months' end,
  'policyId',policy.id,'policyRevision',policy.revision);
end $$;

create function public.enroll_mailbox_retention(p_actor uuid,p_source text,p_source_id uuid,p_account text,p_messages jsonb,p_earlier timestamptz default null,p_reason text default '',p_search text default null)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare ctx jsonb; item jsonb; j public.mailbox_retention_jobs; result jsonb:='[]'; deadline timestamptz;
begin
 if not private.mailbox_owner(p_actor) then raise exception 'Owner access required'; end if;
 if p_source='content_reports' then perform 1 from public.content_reports where id=p_source_id for share;
 elsif p_source='support_threads' then perform 1 from public.support_threads where id=p_source_id for share; end if;
 ctx:=public.mailbox_case_context(p_source,p_source_id);
 if ctx is null then raise exception 'A closed case with an adopted policy and no preservation restriction is required'; end if;
 if p_messages is null or jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages) not between 1 and 100 then raise exception 'Select 1 to 100 messages'; end if;
 deadline:=coalesce(p_earlier,(ctx->>'maximumDueAt')::timestamptz);
 if deadline<(ctx->>'closedAt')::timestamptz or deadline>(ctx->>'maximumDueAt')::timestamptz
  or p_earlier is not null and length(trim(p_reason))<10 or length(p_reason)>500 then raise exception 'Invalid earlier-deletion decision'; end if;
 for item in select value from jsonb_array_elements(p_messages) loop
  insert into public.mailbox_retention_jobs(source_table,source_id,category,account_id,message_id,folder_id,closed_at,maximum_due_at,due_at,policy_id,policy_revision,approved_by,minimization_reason,search_phrase)
  values(p_source,p_source_id,ctx->>'category',p_account,item->>'messageId',item->>'folderId',(ctx->>'closedAt')::timestamptz,(ctx->>'maximumDueAt')::timestamptz,deadline,(ctx->>'policyId')::uuid,(ctx->>'policyRevision')::int,p_actor,p_reason,coalesce(nullif(trim(p_search),''),p_source_id::text))
  on conflict(account_id,message_id) do nothing returning * into j;
  if not found then
   select * into j from public.mailbox_retention_jobs where account_id=p_account and message_id=item->>'messageId' for update;
   if j.source_table<>p_source or j.source_id<>p_source_id or j.category<>ctx->>'category' or j.lease_until>now() then raise exception 'Message has another case or an active deletion attempt'; end if;
   -- Fresh review may shorten a deadline but never silently restart the original clock.
   if j.closed_at<>(ctx->>'closedAt')::timestamptz or deadline>j.due_at then raise exception 'Original closure and earlier disposal deadline must be preserved'; end if;
   update public.mailbox_retention_jobs set source_invalidated=false,policy_id=(ctx->>'policyId')::uuid,policy_revision=(ctx->>'policyRevision')::int,
    due_at=deadline,approved_by=p_actor,approved_at=now(),minimization_reason=p_reason,search_phrase=coalesce(nullif(trim(p_search),''),p_source_id::text),
    folder_id=item->>'folderId',next_attempt_at=now(),error_code=null where id=j.id;
   insert into public.mailbox_retention_receipts(job_id,outcome,actor_id) values(j.id,'reviewed',p_actor);
  else insert into public.mailbox_retention_receipts(job_id,outcome,actor_id) values(j.id,'scheduled',p_actor); end if;
  result:=result||jsonb_build_array(j.id);
 end loop;
 return result;
end $$;

-- A source reopening, changing category/clock, or disappearing while open invalidates its enrollment.
-- Internal trigger only: ordinary source writers must not receive direct queue permissions.
create function private.invalidate_mailbox_retention() returns trigger language plpgsql security definer set search_path='' as $$
declare row_value jsonb; eligible boolean; v_category text; stamp timestamptz;
begin
 if tg_table_schema<>'public' or tg_table_name not in ('content_reports','support_threads') then raise exception 'Invalid mailbox source trigger'; end if;
 row_value:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 v_category:=case when tg_table_name='support_threads' then 'support' else row_value->>'case_kind' end;
 stamp:=(row_value->>'retention_closed_at')::timestamptz;
 eligible:=case when tg_table_name='support_threads' then row_value->>'status'='closed' else row_value->>'status' in ('resolved','removed') end;
 update public.mailbox_retention_jobs set
  source_deleted=(tg_op='DELETE'), source_invalidated=source_invalidated or not coalesce(eligible,false) or stamp is null or closed_at is distinct from stamp or v_category is distinct from mailbox_retention_jobs.category
   or coalesce(row_value->'workflow'->>'preservation','')<>''
   or exists(select 1 from public.safety_media_restrictions s where s.report_id=(row_value->>'id')::uuid)
 where source_table=tg_table_name and source_id=(row_value->>'id')::uuid;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger mailbox_retention_source before update or delete on public.content_reports for each row execute function private.invalidate_mailbox_retention();
create trigger mailbox_retention_source before update or delete on public.support_threads for each row execute function private.invalidate_mailbox_retention();

create function private.mailbox_job_blocker(j public.mailbox_retention_jobs) returns text language plpgsql stable security invoker set search_path='' as $$
declare ctx jsonb;
begin
 if not coalesce((select enabled from public.mailbox_retention_settings where singleton),false) then return 'paused'; end if;
 if j.paused or j.source_invalidated then return 'case_review_required'; end if;
 if exists(select 1 from public.compliance_records where kind='hold' and status<>'completed') then return 'preservation_hold'; end if;
 if not exists(select 1 from public.compliance_records where id=j.policy_id and revision=j.policy_revision and status='verified') then return 'policy_review_required'; end if;
 if not j.source_deleted then
  ctx:=public.mailbox_case_context(j.source_table,j.source_id);
  if ctx is null or (ctx->>'closedAt')::timestamptz<>j.closed_at or ctx->>'category'<>j.category then return 'case_review_required'; end if;
 end if;
 if j.due_at>now() then return 'not_due'; end if;
 return null;
end $$;

create function public.claim_mailbox_retention(p_account text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.mailbox_retention_jobs;
begin
 if not coalesce((select enabled from public.mailbox_retention_settings where singleton),false) then return null; end if;
 if exists(select 1 from public.compliance_records where kind='hold' and status<>'completed') then return null; end if;
 -- Minimal message references support a bounded recovery/reconciliation window, not indefinite tracking.
 delete from public.mailbox_retention_receipts where created_at<now()-interval '90 days';
 delete from public.mailbox_retention_jobs where first_removed_at<now()-interval '90 days' and state='absent' and not paused and not source_invalidated and last_checked_at>now()-interval '2 days';
 select * into j from public.mailbox_retention_jobs x where account_id=p_account and due_at<=now() and next_attempt_at<=now()
  and coalesce(lease_until,'-infinity')<now() and private.mailbox_job_blocker(x) is null order by next_attempt_at,due_at,id limit 1 for update skip locked;
 if not found then return null; end if;
 update public.mailbox_retention_jobs set state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.check_mailbox_retention_lease(p_id uuid,p_lease uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.mailbox_retention_jobs j where id=p_id and lease_id=p_lease and lease_until>now() and state='processing' and private.mailbox_job_blocker(j) is null);
$$;
create function public.finish_mailbox_retention(p_id uuid,p_lease uuid,p_outcome text,p_folder text default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.mailbox_retention_jobs;
begin
 if p_outcome not in ('trashed','trash_removed','absent','provider_unavailable','verification_failed','case_review_required','copy_review_required') then raise exception 'Invalid mailbox outcome'; end if;
 select * into j from public.mailbox_retention_jobs where id=p_id and lease_id=p_lease and lease_until>now() and state='processing' for update;
 if not found then return false; end if;
 update public.mailbox_retention_jobs set state=case when p_outcome in ('trashed','trash_removed','absent') then p_outcome else 'retry' end,
  folder_id=coalesce(p_folder,folder_id), first_removed_at=case when p_outcome in ('trashed','trash_removed','absent') then coalesce(first_removed_at,now()) else first_removed_at end,
  last_checked_at=now(),error_code=case when p_outcome in ('trashed','trash_removed','absent') then null else p_outcome end,
  next_attempt_at=now()+case when p_outcome='trashed' then interval '0 seconds' when p_outcome in ('trashed','trash_removed','absent') then interval '1 day' else interval '1 hour' end,lease_id=null,lease_until=null where id=j.id;
 insert into public.mailbox_retention_receipts(job_id,outcome) values(j.id,p_outcome);
 return true;
end $$;
create function public.set_mailbox_retention(p_actor uuid,p_enabled boolean,p_job uuid default null) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not private.mailbox_owner(p_actor) then raise exception 'Owner access required'; end if;
 if p_job is null then update public.mailbox_retention_settings set enabled=p_enabled,updated_by=p_actor,updated_at=now() where singleton;
 else update public.mailbox_retention_jobs set paused=not p_enabled where id=p_job;
  if not found then raise exception 'Mailbox item not found'; end if;
 end if;
 insert into public.mailbox_retention_receipts(job_id,outcome,actor_id) values(p_job,case when p_enabled then 'enabled' else 'paused' end,p_actor);
 return true;
end $$;
create function public.preview_mailbox_retention() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',(select enabled from public.mailbox_retention_settings where singleton),
 'jobs',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,source_table,source_id,category,message_id,closed_at,due_at,maximum_due_at,state,paused,first_removed_at,last_checked_at,error_code,private.mailbox_job_blocker(j) as blocker
  from public.mailbox_retention_jobs j order by due_at,id limit 100) q),'[]'),
 'jobCount',(select count(*) from public.mailbox_retention_jobs),
 'receipts',coalesce((select jsonb_agg(q) from (select id,job_id,created_at,outcome from public.mailbox_retention_receipts order by created_at desc limit 30)q),'[]'));
$$;

revoke all on function private.invalidate_mailbox_retention() from public,anon,authenticated,service_role;
revoke all on function private.mailbox_owner(uuid),private.mailbox_job_blocker(public.mailbox_retention_jobs),public.mailbox_case_context(text,uuid),
 public.enroll_mailbox_retention(uuid,text,uuid,text,jsonb,timestamptz,text,text),public.claim_mailbox_retention(text),public.check_mailbox_retention_lease(uuid,uuid),
 public.finish_mailbox_retention(uuid,uuid,text,text),public.set_mailbox_retention(uuid,boolean,uuid),public.preview_mailbox_retention() from public,anon,authenticated;
grant execute on function private.mailbox_owner(uuid),private.mailbox_job_blocker(public.mailbox_retention_jobs),public.mailbox_case_context(text,uuid),
 public.enroll_mailbox_retention(uuid,text,uuid,text,jsonb,timestamptz,text,text),public.claim_mailbox_retention(text),public.check_mailbox_retention_lease(uuid,uuid),
 public.finish_mailbox_retention(uuid,uuid,text,text),public.set_mailbox_retention(uuid,boolean,uuid),public.preview_mailbox_retention() to service_role;
notify pgrst,'reload schema';
commit;
