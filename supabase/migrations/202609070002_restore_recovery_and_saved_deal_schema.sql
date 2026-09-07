begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Targeted additive repair for two objects absent in the audited live catalog.
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
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
  v_ip_count integer;
  v_subject_count integer;
  v_allowed boolean;
begin
  if p_event_type is null or p_role is null or p_window_seconds is null or p_ip_limit is null or p_subject_limit is null
     or p_event_type not in ('password_reset', 'email_lookup')
     or p_role not in ('customer', 'dancer', 'venue', 'admin')
     or coalesce(length(p_request_ip_hash), 0) <> 64
     or coalesce(length(p_subject_hash), 0) <> 64
     or p_window_seconds < 60
     or p_window_seconds > 86400
     or p_ip_limit < 1
     or p_subject_limit < 1 then
    raise exception using errcode = '22023', message = 'Invalid account recovery rate limit input.';
  end if;

  -- Serialize each independently limited dimension, in a stable lock order.
  perform pg_advisory_xact_lock(least(
    hashtextextended(p_event_type || ':ip:' || p_request_ip_hash, 0),
    hashtextextended(p_event_type || ':subject:' || p_subject_hash, 0)));
  perform pg_advisory_xact_lock(greatest(
    hashtextextended(p_event_type || ':ip:' || p_request_ip_hash, 0),
    hashtextextended(p_event_type || ':subject:' || p_subject_hash, 0)));
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

  -- Retention is an explicit operator task; this function never deletes history.
  return v_allowed;
end;
$$;

revoke all on table public.account_recovery_events from anon, authenticated;
revoke all on function public.record_account_recovery_event(text, text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.record_account_recovery_event(text, text, text, text, integer, integer, integer) to service_role;

comment on table public.account_recovery_events is
  'Hashed security telemetry for account recovery throttling. Never stores submitted account emails or IP addresses.';



create table if not exists public.customer_deal_saves (
  customer_id uuid not null references public.app_users(id) on delete cascade,
  club_deal_id uuid not null references public.club_deals(id) on delete cascade,
  source_type text not null default 'club_page' check (source_type in ('club_page', 'dancer_profile')),
  dancer_id uuid references public.dancer_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (customer_id, club_deal_id)
);

create index if not exists customer_deal_saves_deal_idx
  on public.customer_deal_saves (club_deal_id, created_at desc);

alter table public.customer_deal_saves enable row level security;

revoke all on table public.customer_deal_saves from anon;
revoke all on table public.customer_deal_saves from authenticated;
grant select, insert, delete on table public.customer_deal_saves to authenticated;

drop policy if exists "customers read own saved club deals" on public.customer_deal_saves;
create policy "customers read own saved club deals"
on public.customer_deal_saves
for select
to authenticated
using (customer_id = auth.uid());

drop policy if exists "customers save own club deals" on public.customer_deal_saves;
create policy "customers save own club deals"
on public.customer_deal_saves
for insert
to authenticated
with check (
  customer_id = auth.uid()
  and exists (
    select 1
    from public.app_users as account
    where account.id = auth.uid()
      and account.role = 'customer'
      and account.account_state = 'active'
  )
  and exists (
    select 1
    from public.club_deals as deal
    join public.venues as venue on venue.id = deal.venue_id
    where deal.id = club_deal_id
      and deal.is_active = true
      and venue.is_active = true
  )
  and (dancer_id is null or exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = customer_deal_saves.dancer_id
      and dancer.status = 'approved' and dancer.verification_status = 'approved'
      and dancer.venue_approved_at is not null and dancer.is_public = true and dancer.disabled_at is null
  ))
);

drop policy if exists "customers remove own saved club deals" on public.customer_deal_saves;
create policy "customers remove own saved club deals"
on public.customer_deal_saves
for delete
to authenticated
using (customer_id = auth.uid());

comment on table public.customer_deal_saves is
  'Private customer bookmarks for Club Deals. Saving never reserves, selects, or redeems an offer.';



grant all on public.account_recovery_events, public.customer_deal_saves to service_role;
notify pgrst, 'reload schema';
commit;
