begin;

create table if not exists public.nats_affiliate_accounts (
  dancer_id uuid primary key references public.dancer_profiles(id) on delete restrict,
  login_id bigint not null unique check (login_id > 0),
  username text,
  status text not null default 'requested'
    check (status in ('requested', 'active', 'disabled')),
  requested_at timestamptz not null default now(),
  activated_at timestamptz,
  disabled_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  verification_note text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nats_affiliate_accounts_activation_check check (
    (status = 'active' and activated_at is not null and verified_by is not null)
    or status <> 'active'
  )
);

create table if not exists public.nats_commission_exports (
  id uuid primary key default gen_random_uuid(),
  commission_event_id uuid not null unique references public.commission_events(id) on delete restrict,
  dancer_id uuid not null references public.dancer_profiles(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'waiting_for_affiliate'
    check (status in ('waiting_for_affiliate', 'pending', 'processing', 'exported', 'failed', 'reconciliation_required', 'canceled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processing_started_at timestamptz,
  exported_at timestamptz,
  failed_at timestamptz,
  reconciled_at timestamptz,
  nats_result text,
  last_error text,
  response_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nats_commission_exports_status_created_idx
  on public.nats_commission_exports(status, created_at);
create index if not exists nats_commission_exports_dancer_created_idx
  on public.nats_commission_exports(dancer_id, created_at desc);

create or replace function public.enqueue_nats_commission_export()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_account_active boolean;
begin
  if new.status <> 'available'
    or new.is_test
    or new.held_at is not null
    or new.review_flag is not null
    or new.amount_cents <= 0
    or lower(new.currency) <> 'usd'
  then
    return new;
  end if;

  select exists (
    select 1 from public.nats_affiliate_accounts account
    where account.dancer_id = new.dancer_id and account.status = 'active'
  ) into v_account_active;

  insert into public.nats_commission_exports (
    commission_event_id, dancer_id, amount_cents, currency, status
  ) values (
    new.id,
    new.dancer_id,
    new.amount_cents,
    lower(new.currency),
    case when v_account_active then 'pending' else 'waiting_for_affiliate' end
  ) on conflict (commission_event_id) do nothing;
  return new;
end;
$$;

drop trigger if exists commission_events_enqueue_nats_export on public.commission_events;
create trigger commission_events_enqueue_nats_export
  after insert or update of status, held_at, review_flag on public.commission_events
  for each row execute function public.enqueue_nats_commission_export();

insert into public.nats_commission_exports (
  commission_event_id, dancer_id, amount_cents, currency, status
)
select earning.id, earning.dancer_id, earning.amount_cents, lower(earning.currency),
  case when account.status = 'active' then 'pending' else 'waiting_for_affiliate' end
from public.commission_events earning
left join public.nats_affiliate_accounts account on account.dancer_id = earning.dancer_id
where earning.status = 'available'
  and earning.is_test = false
  and earning.held_at is null
  and earning.review_flag is null
  and earning.amount_cents > 0
  and lower(earning.currency) = 'usd'
on conflict (commission_event_id) do nothing;

create or replace function public.activate_waiting_nats_exports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := clock_timestamp();
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.nats_commission_exports export
    set status = 'pending', updated_at = clock_timestamp(), last_error = null, failed_at = null
    where export.dancer_id = new.dancer_id
      and export.status = 'waiting_for_affiliate'
      and exists (
        select 1 from public.commission_events earning
        where earning.id = export.commission_event_id
          and earning.status = 'available'
          and earning.is_test = false
          and earning.held_at is null
          and earning.review_flag is null
      );
  elsif new.status = 'disabled' and old.status is distinct from 'disabled' then
    new.disabled_at := coalesce(new.disabled_at, clock_timestamp());
  end if;
  return new;
end;
$$;

drop trigger if exists nats_affiliate_accounts_activate_exports on public.nats_affiliate_accounts;
create trigger nats_affiliate_accounts_activate_exports
  before update on public.nats_affiliate_accounts
  for each row execute function public.activate_waiting_nats_exports();

create or replace function public.claim_nats_commission_exports(p_limit integer default 100)
returns table (
  export_id uuid,
  commission_event_id uuid,
  dancer_id uuid,
  login_id bigint,
  amount_cents bigint,
  currency text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'NATS export limit must be between 1 and 500.';
  end if;

  -- NATS manual invoices do not accept an idempotency key. A worker can die
  -- after NATS accepts an invoice but before MyDancr records success, so an
  -- expired processing lease must be reconciled by an administrator and must
  -- never be dispatched automatically a second time.
  update public.nats_commission_exports
  set status = 'reconciliation_required',
      failed_at = clock_timestamp(),
      last_error = 'The NATS export worker stopped with an unknown outcome. Verify the affiliate invoice in NATS before retrying.',
      updated_at = clock_timestamp()
  where status = 'processing'
    and processing_started_at < clock_timestamp() - interval '20 minutes';

  return query
  with candidates as (
    select export.id
    from public.nats_commission_exports export
    join public.nats_affiliate_accounts account
      on account.dancer_id = export.dancer_id and account.status = 'active'
    join public.commission_events earning
      on earning.id = export.commission_event_id
    where export.status = 'pending'
      and earning.status = 'available'
      and earning.is_test = false
      and earning.held_at is null
      and earning.review_flag is null
    order by export.created_at, export.id
    for update of export skip locked
    limit p_limit
  ), claimed as (
    update public.nats_commission_exports export
    set status = 'processing',
        processing_started_at = clock_timestamp(),
        attempt_count = export.attempt_count + 1,
        last_error = null,
        updated_at = clock_timestamp()
    where export.id in (select candidates.id from candidates)
    returning export.*
  )
  select claimed.id, claimed.commission_event_id, claimed.dancer_id,
    account.login_id, claimed.amount_cents, claimed.currency, claimed.attempt_count
  from claimed
  join public.nats_affiliate_accounts account on account.dancer_id = claimed.dancer_id;
end;
$$;

create or replace function public.complete_nats_commission_export(
  p_export_id uuid,
  p_nats_result text,
  p_response_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_commission_event_id uuid;
begin
  update public.nats_commission_exports
  set status = 'exported',
      exported_at = clock_timestamp(),
      nats_result = left(nullif(trim(coalesce(p_nats_result, '')), ''), 500),
      response_metadata = coalesce(p_response_metadata, '{}'::jsonb),
      updated_at = clock_timestamp()
  where id = p_export_id and status = 'processing'
  returning commission_event_id into v_commission_event_id;
  if v_commission_event_id is not null then
    insert into public.financial_audit_events (
      actor_type, action, target_type, target_id, after_state, metadata
    ) values (
      'provider', 'nats_commission_exported', 'earning', v_commission_event_id::text,
      jsonb_build_object('status', 'exported'),
      jsonb_build_object('commission_platform', 'nats')
    );
  end if;
  return v_commission_event_id is not null;
end;
$$;

create or replace function public.fail_nats_commission_export(
  p_export_id uuid,
  p_status text,
  p_error text,
  p_response_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_updated integer;
begin
  if p_status not in ('failed', 'reconciliation_required')
    or char_length(trim(coalesce(p_error, ''))) < 3
  then
    raise exception using errcode = '22023', message = 'A valid NATS export failure is required.';
  end if;
  update public.nats_commission_exports
  set status = p_status,
      failed_at = clock_timestamp(),
      last_error = left(trim(p_error), 500),
      response_metadata = coalesce(p_response_metadata, '{}'::jsonb),
      updated_at = clock_timestamp()
  where id = p_export_id and status = 'processing';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.flag_reversed_nats_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'reversed' and new.status = 'reversed' then
    update public.nats_commission_exports
    set status = case when status = 'exported' then 'reconciliation_required' else 'canceled' end,
        last_error = case when status = 'exported'
          then 'The source earning was reversed after export. Reconcile the matching manual invoice in NATS.'
          else 'The source earning was reversed before NATS export.' end,
        failed_at = case when status = 'exported' then clock_timestamp() else failed_at end,
        updated_at = clock_timestamp()
    where commission_event_id = new.id
      and status in ('waiting_for_affiliate', 'pending', 'failed', 'exported');
  end if;
  return new;
end;
$$;

drop trigger if exists commission_events_reconcile_nats_reversal on public.commission_events;
create trigger commission_events_reconcile_nats_reversal
  after update of status on public.commission_events
  for each row execute function public.flag_reversed_nats_commission();

drop trigger if exists nats_affiliate_accounts_no_delete on public.nats_affiliate_accounts;
create trigger nats_affiliate_accounts_no_delete
  before delete on public.nats_affiliate_accounts
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists nats_commission_exports_no_delete on public.nats_commission_exports;
create trigger nats_commission_exports_no_delete
  before delete on public.nats_commission_exports
  for each row execute function public.prohibit_financial_record_delete();

alter table public.nats_affiliate_accounts enable row level security;
alter table public.nats_commission_exports enable row level security;

drop policy if exists "Admins read NATS affiliate accounts" on public.nats_affiliate_accounts;
create policy "Admins read NATS affiliate accounts" on public.nats_affiliate_accounts
  for select using (public.is_admin());
drop policy if exists "Dancers read own NATS affiliate account" on public.nats_affiliate_accounts;
create policy "Dancers read own NATS affiliate account" on public.nats_affiliate_accounts
  for select using (
    exists (
      select 1 from public.dancer_profiles dancer
      where dancer.id = dancer_id and dancer.user_id = auth.uid()
    )
  );
drop policy if exists "Admins read NATS commission exports" on public.nats_commission_exports;
create policy "Admins read NATS commission exports" on public.nats_commission_exports
  for select using (public.is_admin());
drop policy if exists "Dancers read own NATS commission exports" on public.nats_commission_exports;
create policy "Dancers read own NATS commission exports" on public.nats_commission_exports
  for select using (
    exists (
      select 1 from public.dancer_profiles dancer
      where dancer.id = dancer_id and dancer.user_id = auth.uid()
    )
  );

revoke all on function public.claim_nats_commission_exports(integer) from public, anon, authenticated;
revoke all on function public.complete_nats_commission_export(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_nats_commission_export(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_nats_commission_exports(integer) to service_role;
grant execute on function public.complete_nats_commission_export(uuid, text, jsonb) to service_role;
grant execute on function public.fail_nats_commission_export(uuid, text, text, jsonb) to service_role;

comment on table public.nats_affiliate_accounts is
  'Verified mapping between a MyDancr dancer and the dancer affiliate login in the licensed NATS installation.';
comment on table public.nats_commission_exports is
  'Durable, non-deletable outbox for exact MyDancr NFC commission amounts exported to NATS manual invoices.';

commit;
