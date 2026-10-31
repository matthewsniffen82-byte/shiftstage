begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Phase one deliberately excludes delivery deduplication and case/business evidence.
create table public.diagnostic_retention_settings (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default true,
 policy_id uuid references public.compliance_records(id),
 policy_revision integer,
 updated_at timestamptz not null default now()
);
insert into public.diagnostic_retention_settings(singleton,policy_id,policy_revision)
select true,id,revision from public.compliance_records
where kind='retention' and title='Security logs' and status='verified'
order by created_at,id limit 1;
insert into public.diagnostic_retention_settings(singleton) values(true) on conflict do nothing;

create table public.diagnostic_retention_exceptions (
 hold_id uuid not null references public.compliance_records(id),
 source text not null check(source in ('account_recovery_events','request_rate_limit_buckets')),
 record_key jsonb not null check(jsonb_typeof(record_key)='array' and octet_length(record_key::text)<500),
 created_at timestamptz not null default now(),
 primary key(hold_id,source,record_key)
);
create index diagnostic_retention_exception_lookup on public.diagnostic_retention_exceptions(source,record_key);
create table public.diagnostic_retention_hold_reviews (
 hold_id uuid primary key references public.compliance_records(id),
 revision integer not null,
 reviewed_at timestamptz not null default now(),
 note text not null check(length(btrim(note)) between 10 and 500)
);
create table public.diagnostic_retention_runs (
 id uuid primary key default gen_random_uuid(),
 started_at timestamptz not null default now(),
 finished_at timestamptz not null default clock_timestamp(),
 status text not null check(status in ('completed','blocked','failed')),
 reason text,
 removed_recovery integer not null default 0,
 removed_counters integer not null default 0,
 error_code text check(error_code is null or error_code ~ '^[A-Z0-9]{5}$'),
 retry_after timestamptz
);
create index diagnostic_retention_runs_time on public.diagnostic_retention_runs(started_at desc);
create index account_recovery_retention_time on public.account_recovery_events(created_at,id);

alter table public.diagnostic_retention_settings enable row level security;
alter table public.diagnostic_retention_exceptions enable row level security;
alter table public.diagnostic_retention_hold_reviews enable row level security;
alter table public.diagnostic_retention_runs enable row level security;
create policy diagnostic_retention_settings_service on public.diagnostic_retention_settings to service_role using(true) with check(true);
create policy diagnostic_retention_exceptions_service on public.diagnostic_retention_exceptions to service_role using(true) with check(true);
create policy diagnostic_retention_hold_reviews_service on public.diagnostic_retention_hold_reviews to service_role using(true) with check(true);
create policy diagnostic_retention_runs_service on public.diagnostic_retention_runs to service_role using(true) with check(true);
revoke all on public.diagnostic_retention_settings,public.diagnostic_retention_exceptions,
 public.diagnostic_retention_hold_reviews,public.diagnostic_retention_runs from public,anon,authenticated;
grant select,insert,update,delete on public.diagnostic_retention_settings,public.diagnostic_retention_exceptions,
 public.diagnostic_retention_hold_reviews,public.diagnostic_retention_runs to service_role;
grant select,delete on public.account_recovery_events,public.request_rate_limit_buckets to service_role;
-- SELECT FOR UPDATE in the worker also requires UPDATE permission.
grant update on public.account_recovery_events to service_role;

create function private.diagnostic_retention_held(p_source text,p_key jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.diagnostic_retention_exceptions e
 join public.compliance_records h on h.id=e.hold_id
 where e.source=p_source and e.record_key=p_key and h.status<>'completed');
$$;

create function private.diagnostic_retention_blocker() returns text
language sql stable security invoker set search_path='' as $$
 select case
 when not coalesce((select enabled from public.diagnostic_retention_settings where singleton),false) then 'paused'
 when not exists(select 1 from public.diagnostic_retention_settings s join public.compliance_records p on p.id=s.policy_id
  where s.singleton and p.kind='retention' and p.status='verified' and p.revision=s.policy_revision) then 'policy_review_required'
 when exists(select 1 from public.compliance_records h left join public.diagnostic_retention_hold_reviews r on r.hold_id=h.id
  where h.kind='hold' and h.status<>'completed' and (r.hold_id is null or r.revision<>h.revision)) then 'hold_scope_review_required'
 else null end;
$$;

create function public.preview_diagnostic_retention() returns jsonb
language sql stable security invoker set search_path='' set timezone='UTC' set statement_timeout='15s' as $$
 select jsonb_build_object('asOf',now(),'cutoff',now()-interval '90 days',
  'blocker',private.diagnostic_retention_blocker(),'batchLimit',500,
  'sources',jsonb_build_array(
   (select jsonb_build_object('source','account_recovery_events','due',count(*),
     'held',count(*) filter(where private.diagnostic_retention_held('account_recovery_events',jsonb_build_array(id))))
    from public.account_recovery_events where created_at<=now()-interval '90 days'),
   (select jsonb_build_object('source','request_rate_limit_buckets','due',count(*),
     'held',count(*) filter(where private.diagnostic_retention_held('request_rate_limit_buckets',jsonb_build_array(namespace,key_type,key_hash))))
    from public.request_rate_limit_buckets where expires_at<=now())
  ),
  'holds',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'revision',h.revision,'status',h.status,
    'scopeReviewed',coalesce(r.revision=h.revision,false),'mappedRecords',(select count(*) from public.diagnostic_retention_exceptions e where e.hold_id=h.id)) order by h.created_at)
    from public.compliance_records h left join public.diagnostic_retention_hold_reviews r on r.hold_id=h.id
    where h.kind='hold' and h.status<>'completed'),'[]'::jsonb));
$$;

-- Serialize exception edits with cleanup. Hold release uses the existing register and retains original clocks.
create function public.manage_diagnostic_retention(p_actor uuid,p_action text,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare h public.compliance_records; k jsonb; src text; found_row boolean; enabled_value boolean;
begin
 if not private.compliance_owner(p_actor) then raise exception 'Owner access required'; end if;
 perform pg_advisory_xact_lock(71031,90);
 if p_action='enabled' then
  if jsonb_typeof(p_values->'enabled') is distinct from 'boolean' then raise exception 'Choose enabled or paused'; end if;
  enabled_value:=(p_values->>'enabled')::boolean;
  update public.diagnostic_retention_settings set enabled=enabled_value,updated_at=now() where singleton;
  insert into public.compliance_events(actor_id,action) values(p_actor,case when enabled_value then 'diagnostic_cleanup_enabled' else 'diagnostic_cleanup_paused' end);
 else
  select * into h from public.compliance_records where id=(p_values->>'holdId')::uuid and kind='hold' for update;
  if not found or h.status<>'verified' or h.revision is distinct from (p_values->>'revision')::integer then raise exception 'Refresh and select a verified active hold'; end if;
  if p_action='review_hold' then
   if length(btrim(coalesce(p_values->>'note',''))) not between 10 and 500 then raise exception 'Record the scope review (10-500 characters)'; end if;
   insert into public.diagnostic_retention_hold_reviews(hold_id,revision,note) values(h.id,h.revision,btrim(p_values->>'note'))
   on conflict(hold_id) do update set revision=excluded.revision,reviewed_at=now(),note=excluded.note;
  elsif p_action='protect' then
   src:=p_values->>'source'; k:=p_values->'recordKey';
   if jsonb_typeof(k) is distinct from 'array' or octet_length(k::text)>500 then raise exception 'Invalid diagnostic reference'; end if;
   if src='account_recovery_events' and jsonb_array_length(k)=1 then
    k:=jsonb_build_array((k->>0)::uuid);
    select exists(select 1 from public.account_recovery_events where id=(k->>0)::uuid) into found_row;
   elsif src='request_rate_limit_buckets' and jsonb_array_length(k)=3 then
    k:=jsonb_build_array(k->>0,k->>1,(k->>2)::uuid);
    select exists(select 1 from public.request_rate_limit_buckets where namespace=k->>0 and key_type=k->>1 and key_hash=(k->>2)::uuid) into found_row;
   else raise exception 'Invalid diagnostic source or reference'; end if;
   if not found_row then raise exception 'Diagnostic record not found; refresh before adding an exception'; end if;
   insert into public.diagnostic_retention_exceptions(hold_id,source,record_key) values(h.id,src,k) on conflict do nothing;
   delete from public.diagnostic_retention_hold_reviews where hold_id=h.id;
  else raise exception 'Unknown diagnostic operation'; end if;
  insert into public.compliance_events(record_id,actor_id,action,revision) values(h.id,p_actor,'diagnostic_'||p_action,h.revision);
 end if;
 return public.preview_diagnostic_retention();
end;
$$;

create function public.run_diagnostic_retention() returns jsonb
language plpgsql security invoker set search_path='' set timezone='UTC' set statement_timeout='25s' set lock_timeout='2s' as $$
declare reason text; recovery_count integer:=0; counter_count integer:=0; receipt public.diagnostic_retention_runs; failure text;
begin
 if not pg_try_advisory_xact_lock(71031,90) then return jsonb_build_object('status','busy'); end if;
 -- Lock current policy/holds against edits until this bounded transaction ends.
 perform 1 from public.compliance_records where kind in ('retention','hold') order by id for share;
 reason:=private.diagnostic_retention_blocker();
 if reason is not null then
  insert into public.diagnostic_retention_runs(status,reason,retry_after) values('blocked',reason,now()+interval '1 hour') returning * into receipt;
 else
  begin
   with candidates as (
    select r.id from public.account_recovery_events r where r.created_at<=now()-interval '90 days'
    and not private.diagnostic_retention_held('account_recovery_events',jsonb_build_array(r.id))
    order by r.created_at,r.id limit 500 for update skip locked
   ), removed as (delete from public.account_recovery_events r using candidates c where r.id=c.id returning 1)
   select count(*) into recovery_count from removed;
   with candidates as (
    select r.namespace,r.key_type,r.key_hash from public.request_rate_limit_buckets r where r.expires_at<=now()
    and not private.diagnostic_retention_held('request_rate_limit_buckets',jsonb_build_array(r.namespace,r.key_type,r.key_hash))
    order by r.expires_at,r.namespace,r.key_type,r.key_hash limit 500 for update skip locked
   ), removed as (delete from public.request_rate_limit_buckets r using candidates c
     where r.namespace=c.namespace and r.key_type=c.key_type and r.key_hash=c.key_hash returning 1)
   select count(*) into counter_count from removed;
   -- Released mappings no longer serve a purpose; receipts never copy their subject references.
   delete from public.diagnostic_retention_exceptions e using public.compliance_records h where h.id=e.hold_id and h.status='completed';
   delete from public.diagnostic_retention_hold_reviews r using public.compliance_records h where h.id=r.hold_id and h.status='completed';
   insert into public.diagnostic_retention_runs(status,removed_recovery,removed_counters)
    values('completed',recovery_count,counter_count) returning * into receipt;
  exception when others then
   get stacked diagnostics failure=returned_sqlstate;
   insert into public.diagnostic_retention_runs(status,error_code,retry_after)
    values('failed',failure,now()+interval '1 hour') returning * into receipt;
  end;
 end if;
 -- These are aggregate operational receipts, retained for the same 90-day diagnostics window.
 delete from public.diagnostic_retention_runs where started_at<now()-interval '90 days';
 return to_jsonb(receipt);
exception when others then
 get stacked diagnostics failure=returned_sqlstate;
 insert into public.diagnostic_retention_runs(status,error_code,retry_after)
  values('failed',failure,now()+interval '1 hour') returning * into receipt;
 return to_jsonb(receipt);
end;
$$;

-- A newly entered hold must not race a running cleanup transaction.
create function private.serialize_diagnostic_retention_review() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(new.kind,old.kind) in ('hold','retention') then perform pg_advisory_xact_lock(71031,90); end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger diagnostic_retention_review_lock before insert or update or delete on public.compliance_records
for each row execute function private.serialize_diagnostic_retention_review();
revoke all on function private.serialize_diagnostic_retention_review() from public,anon,authenticated;
grant execute on function private.serialize_diagnostic_retention_review() to service_role;

revoke all on function private.diagnostic_retention_held(text,jsonb),private.diagnostic_retention_blocker(),
 public.preview_diagnostic_retention(),public.manage_diagnostic_retention(uuid,text,jsonb),public.run_diagnostic_retention() from public,anon,authenticated;
grant execute on function private.diagnostic_retention_held(text,jsonb),private.diagnostic_retention_blocker(),
 public.preview_diagnostic_retention(),public.manage_diagnostic_retention(uuid,text,jsonb),public.run_diagnostic_retention() to service_role;
notify pgrst,'reload schema';
commit;
