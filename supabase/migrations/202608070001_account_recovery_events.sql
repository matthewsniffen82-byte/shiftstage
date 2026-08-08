create table if not exists public.account_recovery_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  account_role text not null,
  request_ip_hash text not null,
  subject_hash text not null,
  outcome text not null,
  created_at timestamptz not null default now(),
  constraint account_recovery_events_type_check check (event_type in ('password_reset', 'email_lookup')),
  constraint account_recovery_events_role_check check (account_role in ('customer', 'dancer', 'venue', 'admin')),
  constraint account_recovery_events_outcome_check check (outcome in ('accepted', 'rate_limited'))
);

create index if not exists account_recovery_events_ip_window_idx
  on public.account_recovery_events(event_type, request_ip_hash, created_at desc);
create index if not exists account_recovery_events_subject_window_idx
  on public.account_recovery_events(event_type, subject_hash, created_at desc);

alter table public.account_recovery_events enable row level security;

create or replace function public.record_account_recovery_event(
  p_event_type text,
  p_role text,
  p_request_ip_hash text,
  p_subject_hash text,
  p_window_seconds integer,
  p_ip_limit integer,
  p_subject_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_ip_count integer;
  v_subject_count integer;
  v_allowed boolean;
begin
  if p_event_type not in ('password_reset', 'email_lookup')
     or p_role not in ('customer', 'dancer', 'venue', 'admin')
     or coalesce(length(p_request_ip_hash), 0) <> 64
     or coalesce(length(p_subject_hash), 0) <> 64
     or p_window_seconds < 60
     or p_window_seconds > 86400
     or p_ip_limit < 1
     or p_subject_limit < 1 then
    raise exception using errcode = '22023', message = 'Invalid account recovery rate limit input.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_event_type || ':' || p_request_ip_hash || ':' || p_subject_hash, 0));
  v_since := now() - make_interval(secs => p_window_seconds);

  select count(*) into v_ip_count
  from public.account_recovery_events
  where event_type = p_event_type
    and request_ip_hash = p_request_ip_hash
    and created_at >= v_since;

  select count(*) into v_subject_count
  from public.account_recovery_events
  where event_type = p_event_type
    and subject_hash = p_subject_hash
    and created_at >= v_since;

  v_allowed := v_ip_count < p_ip_limit and v_subject_count < p_subject_limit;

  insert into public.account_recovery_events(event_type, account_role, request_ip_hash, subject_hash, outcome)
  values (p_event_type, p_role, p_request_ip_hash, p_subject_hash, case when v_allowed then 'accepted' else 'rate_limited' end);

  delete from public.account_recovery_events where created_at < now() - interval '30 days';
  return v_allowed;
end;
$$;

revoke all on table public.account_recovery_events from anon, authenticated;
revoke all on function public.record_account_recovery_event(text, text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.record_account_recovery_event(text, text, text, text, integer, integer, integer) to service_role;

comment on table public.account_recovery_events is
  'Hashed, short-lived security telemetry for account recovery throttling. Never stores submitted account emails or IP addresses.';
