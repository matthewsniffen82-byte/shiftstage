-- Provider-neutral dancer earnings and payout accounting.
-- Existing QR commission rows remain authoritative; this migration evolves that
-- ledger instead of introducing a competing source of truth.

create table if not exists public.payout_settings (
  id text primary key default 'default' check (id = 'default'),
  payouts_enabled boolean not null default false,
  payment_provider text not null default 'stripe'
    check (payment_provider in ('stripe', 'bitsafe', 'adyen', 'other')),
  earnings_hold_days integer not null default 7 check (earnings_hold_days between 0 and 90),
  minimum_payout_cents integer not null default 2000 check (minimum_payout_cents between 1 and 10000000),
  payout_mode text not null default 'manual_cashout'
    check (payout_mode in ('manual_cashout', 'scheduled', 'both')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.payout_settings (id) values ('default') on conflict (id) do nothing;

-- Payout accounts contain provider identifiers and eligibility state only.
-- Bank, routing, card, and tax-identification values stay with the provider.
alter table public.dancer_payout_accounts
  alter column stripe_account_id drop not null,
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists payment_provider text not null default 'stripe'
    check (payment_provider in ('stripe', 'bitsafe', 'adyen', 'other')),
  add column if not exists provider_account_id text,
  add column if not exists onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started', 'pending', 'complete', 'restricted', 'disabled')),
  add column if not exists payout_eligibility text not null default 'ineligible'
    check (payout_eligibility in ('ineligible', 'pending', 'eligible', 'restricted')),
  add column if not exists verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'restricted')),
  add column if not exists provider_status jsonb not null default '{}'::jsonb;

alter table public.dancer_payout_accounts
  drop constraint if exists dancer_payout_accounts_pkey,
  add constraint dancer_payout_accounts_pkey primary key (id),
  add constraint dancer_payout_accounts_dancer_provider_key unique (dancer_id, payment_provider);

update public.dancer_payout_accounts
set provider_account_id = coalesce(provider_account_id, stripe_account_id),
    onboarding_status = case
      when onboarding_complete then 'complete'
      when details_submitted then 'pending'
      else 'not_started'
    end,
    payout_eligibility = case when payouts_enabled then 'eligible' else 'ineligible' end,
    verification_status = case
      when onboarding_complete then 'verified'
      when details_submitted then 'pending'
      else 'unverified'
    end;

create unique index if not exists dancer_payout_accounts_provider_account_uidx
  on public.dancer_payout_accounts(payment_provider, provider_account_id)
  where provider_account_id is not null;

-- Convert the existing commission-event ledger to the controlled earnings state
-- machine. Legacy names are migrated in place so existing financial history and
-- QR attribution remain intact.
drop trigger if exists commission_events_make_mydancr_funded on public.commission_events;

do $$
declare constraint_row record;
begin
  for constraint_row in
    select constraint_name
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'commission_events'
      and constraint_type = 'CHECK'
  loop
    if pg_get_constraintdef(
      (select oid from pg_constraint where conname = constraint_row.constraint_name
       and conrelid = 'public.commission_events'::regclass limit 1)
    ) ilike '%status%'
    then
      execute format('alter table public.commission_events drop constraint %I', constraint_row.constraint_name);
    end if;
  end loop;
end $$;

update public.commission_events set status = case status
  when 'pending_club_payment' then 'pending'
  when 'payable' then 'available'
  when 'rejected' then 'reversed'
  when 'voided' then 'reversed'
  else status
end;

alter table public.commission_events
  alter column status set default 'pending',
  add constraint commission_events_earning_status_check
    check (status in ('pending', 'available', 'payout_processing', 'paid', 'reversed', 'failed')),
  add column if not exists earning_type text not null default 'club_deal_redemption'
    check (earning_type in ('club_deal_redemption', 'referral', 'bottle_service', 'promotion', 'manual_adjustment', 'other')),
  add column if not exists gross_transaction_amount_cents bigint,
  add column if not exists payment_provider text
    check (payment_provider is null or payment_provider in ('stripe', 'bitsafe', 'adyen', 'other')),
  add column if not exists pending_until timestamptz,
  add column if not exists available_at timestamptz,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversal_reason text,
  add column if not exists held_at timestamptz,
  add column if not exists hold_reason text,
  add column if not exists review_flag text,
  add column if not exists recovery_required boolean not null default false,
  add column if not exists is_test boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add constraint commission_events_gross_transaction_check
    check (gross_transaction_amount_cents is null or gross_transaction_amount_cents >= 0);

update public.commission_events earning
set pending_until = coalesce(
      earning.pending_until,
      earning.created_at + make_interval(days => (select earnings_hold_days from public.payout_settings where id = 'default'))
    ),
    available_at = case when earning.status in ('available', 'payout_processing', 'paid')
      then coalesce(earning.available_at, earning.payable_at, earning.created_at)
      else earning.available_at
    end,
    reversed_at = case when earning.status = 'reversed'
      then coalesce(earning.reversed_at, earning.rejected_at, earning.voided_at, earning.created_at)
      else earning.reversed_at
    end,
    reversal_reason = case when earning.status = 'reversed'
      then coalesce(earning.reversal_reason, 'Legacy rejected or voided commission')
      else earning.reversal_reason
    end,
    metadata = coalesce(earning.metadata, '{}'::jsonb) || jsonb_build_object(
      'ledger_source', 'commission_events',
      'commission_funder', 'mydancr'
    );

alter table public.commission_events
  add constraint commission_events_reversal_fields_check
    check ((status <> 'reversed') or (reversed_at is not null and char_length(trim(coalesce(reversal_reason, ''))) >= 3));

-- Provider-neutral payout records retain the current table name for compatibility.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select constraint_name
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'dancer_payout_batches'
      and constraint_type = 'CHECK'
  loop
    if pg_get_constraintdef(
      (select oid from pg_constraint where conname = constraint_row.constraint_name
       and conrelid = 'public.dancer_payout_batches'::regclass limit 1)
    ) ilike '%status%'
    then
      execute format('alter table public.dancer_payout_batches drop constraint %I', constraint_row.constraint_name);
    end if;
  end loop;
end $$;

update public.dancer_payout_batches set status = case status
  when 'pending' then 'requested'
  when 'reversed' then 'failed'
  else status
end;

alter table public.dancer_payout_batches
  alter column status set default 'requested',
  add constraint dancer_payout_batches_status_check
    check (status in ('requested', 'processing', 'paid', 'failed', 'canceled')),
  add column if not exists payment_provider text not null default 'stripe'
    check (payment_provider in ('stripe', 'bitsafe', 'adyen', 'other')),
  add column if not exists provider_reference_id text,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists processing_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists request_key text,
  add column if not exists is_test boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.dancer_payout_batches
set provider_reference_id = coalesce(provider_reference_id, stripe_transfer_id, external_reference),
    requested_at = coalesce(requested_at, created_at),
    processing_at = case when status in ('processing', 'paid') then coalesce(processing_at, created_at) else processing_at end,
    failed_at = case when status = 'failed' then coalesce(failed_at, updated_at) else failed_at end;

update public.commission_events earning
set status = 'payout_processing', payment_provider = batch.payment_provider
from public.dancer_payout_items item
join public.dancer_payout_batches batch on batch.id = item.payout_batch_id
where earning.id = item.commission_event_id
  and earning.status = 'available'
  and batch.status in ('requested', 'processing');

-- Preserve every legacy batch while ensuring only one active reservation can
-- survive per dancer and currency before the concurrency constraint is added.
with duplicates as (
  select id from (
    select id, row_number() over (partition by dancer_id, currency order by created_at desc, id desc) as position
    from public.dancer_payout_batches where status in ('requested', 'processing')
  ) ranked where position > 1
)
update public.commission_events earning
set status = 'available', payout_batch_id = null, payment_provider = null
where earning.payout_batch_id in (select id from duplicates) and earning.status = 'payout_processing';

with duplicates as (
  select id from (
    select id, row_number() over (partition by dancer_id, currency order by created_at desc, id desc) as position
    from public.dancer_payout_batches where status in ('requested', 'processing')
  ) ranked where position > 1
)
update public.dancer_payout_batches batch
set status = 'failed', failed_at = now(), failure_message = 'Legacy duplicate active batch released during payout-ledger migration', updated_at = now()
where batch.id in (select id from duplicates);

create unique index if not exists dancer_payout_batches_request_key_uidx
  on public.dancer_payout_batches(request_key) where request_key is not null;
create unique index if not exists dancer_payout_batches_one_active_uidx
  on public.dancer_payout_batches(dancer_id, currency)
  where status in ('requested', 'processing');

create table if not exists public.dancer_earning_status_history (
  id bigint generated always as identity primary key,
  earning_id uuid not null references public.commission_events(id) on delete restrict,
  from_status text,
  to_status text not null check (to_status in ('pending', 'available', 'payout_processing', 'paid', 'reversed', 'failed')),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'system' check (actor_type in ('system', 'admin', 'dancer', 'provider')),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Evolve the existing Stripe webhook idempotency table in place so historical
-- delivery records survive the move to provider-neutral payout processing.
do $$
begin
  if to_regclass('public.payment_provider_webhook_events') is null
    and to_regclass('public.stripe_finance_webhook_events') is not null
  then
    alter table public.stripe_finance_webhook_events rename to payment_provider_webhook_events;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'payment_provider_webhook_events' and column_name = 'stripe_event_id')
    and not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'payment_provider_webhook_events' and column_name = 'provider_event_id')
  then
    alter table public.payment_provider_webhook_events rename column stripe_event_id to provider_event_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'payment_provider_webhook_events' and column_name = 'audit')
    and not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'payment_provider_webhook_events' and column_name = 'metadata')
  then
    alter table public.payment_provider_webhook_events rename column audit to metadata;
  end if;
end $$;

alter table public.payment_provider_webhook_events
  drop constraint if exists stripe_finance_webhook_events_pkey,
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists payment_provider text not null default 'stripe'
    check (payment_provider in ('stripe', 'bitsafe', 'adyen', 'other')),
  add column if not exists processing_status text not null default 'processing'
    check (processing_status in ('processing', 'processed', 'failed')),
  add column if not exists failure_reason text,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists processing_started_at timestamptz not null default now(),
  add column if not exists attempt_count integer not null default 1 check (attempt_count > 0);

alter table public.payment_provider_webhook_events
  alter column processed_at drop not null,
  alter column processed_at drop default;

update public.payment_provider_webhook_events
set payment_provider = coalesce(payment_provider, 'stripe'),
    processing_status = 'processed',
    received_at = coalesce(received_at, processed_at, now()),
    processing_started_at = coalesce(processing_started_at, processed_at, now()),
    attempt_count = greatest(coalesce(attempt_count, 1), 1),
    metadata = coalesce(metadata, '{}'::jsonb);

alter table public.payment_provider_webhook_events
  add constraint payment_provider_webhook_events_pkey primary key (id),
  add constraint payment_provider_webhook_events_provider_event_key unique (payment_provider, provider_event_id);

create table if not exists public.financial_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('system', 'admin', 'dancer', 'provider')),
  action text not null,
  target_type text not null check (target_type in ('earning', 'payout', 'payout_account', 'settings', 'webhook')),
  target_id text not null,
  reason text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.dancer_earning_status_history (earning_id, from_status, to_status, actor_type, reason, created_at)
select earning.id, null, earning.status, 'system', 'Existing commission imported into the earnings state machine', earning.created_at
from public.commission_events earning
where not exists (
  select 1 from public.dancer_earning_status_history history where history.earning_id = earning.id
);

create index if not exists commission_events_dancer_status_available_idx
  on public.commission_events(dancer_id, status, available_at desc, created_at desc);
create index if not exists commission_events_pending_release_idx
  on public.commission_events(pending_until)
  where status = 'pending' and held_at is null and review_flag is null;
create index if not exists commission_events_venue_created_idx
  on public.commission_events(venue_id, created_at desc);
create index if not exists dancer_earning_history_earning_idx
  on public.dancer_earning_status_history(earning_id, created_at desc);
create index if not exists provider_webhooks_status_idx
  on public.payment_provider_webhook_events(payment_provider, processing_status, received_at);
create index if not exists financial_audit_target_idx
  on public.financial_audit_events(target_type, target_id, created_at desc);

create or replace function public.claim_payment_provider_webhook(
  p_payment_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_object_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_event_id uuid;
begin
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other')
    or nullif(trim(coalesce(p_provider_event_id, '')), '') is null
    or nullif(trim(coalesce(p_event_type, '')), '') is null
  then
    raise exception using errcode = '22023', message = 'A valid provider webhook event is required.';
  end if;

  insert into public.payment_provider_webhook_events (
    payment_provider, provider_event_id, event_type, object_id
  ) values (
    p_payment_provider, trim(p_provider_event_id), trim(p_event_type), nullif(trim(coalesce(p_object_id, '')), '')
  )
  on conflict (payment_provider, provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is not null then return true; end if;

  -- A failed delivery may retry immediately. A processing delivery is leased
  -- for ten minutes so concurrent duplicates cannot run, while a process crash
  -- cannot strand the provider event forever.
  update public.payment_provider_webhook_events
  set processing_status = 'processing', failure_reason = null, processed_at = null,
      processing_started_at = clock_timestamp(), attempt_count = attempt_count + 1
  where payment_provider = p_payment_provider
    and provider_event_id = trim(p_provider_event_id)
    and (
      processing_status = 'failed'
      or (processing_status = 'processing' and processing_started_at <= clock_timestamp() - interval '10 minutes')
    )
  returning id into v_event_id;
  return v_event_id is not null;
end;
$$;

create or replace function public.prepare_dancer_earning()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_hold_days integer;
begin
  if tg_op = 'INSERT' then
    select earnings_hold_days into v_hold_days from public.payout_settings where id = 'default';
    new.status := case new.status
      when 'pending_club_payment' then 'pending'
      when 'payable' then 'pending'
      when 'rejected' then 'reversed'
      when 'voided' then 'reversed'
      else new.status
    end;
    new.pending_until := coalesce(new.pending_until, clock_timestamp() + make_interval(days => coalesce(v_hold_days, 7)));
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'commission_funder', 'mydancr',
      'venue_payment_dependency', false
    );
    if new.status = 'reversed' then
      new.reversed_at := coalesce(new.reversed_at, clock_timestamp());
      new.reversal_reason := coalesce(nullif(trim(new.reversal_reason), ''), 'Earning invalidated during creation');
    end if;
    return new;
  end if;

  new.status := case new.status
    when 'pending_club_payment' then 'pending'
    when 'payable' then 'pending'
    when 'rejected' then 'reversed'
    when 'voided' then 'reversed'
    else new.status
  end;
  if new.status = 'reversed' and old.status <> 'reversed' then
    new.reversed_at := coalesce(new.reversed_at, clock_timestamp());
    new.reversal_reason := coalesce(nullif(trim(new.reversal_reason), ''), 'Earning invalidated by the originating workflow');
  end if;

  if (new.qr_redemption_id, new.venue_id, new.club_deal_id, new.dancer_id, new.amount_cents,
      new.gross_commission_cents, new.dancer_share_bps, new.platform_amount_cents, new.currency,
      new.earning_type, new.created_at, new.is_test)
     is distinct from
     (old.qr_redemption_id, old.venue_id, old.club_deal_id, old.dancer_id, old.amount_cents,
      old.gross_commission_cents, old.dancer_share_bps, old.platform_amount_cents, old.currency,
      old.earning_type, old.created_at, old.is_test)
  then
    raise exception using errcode = '22023', message = 'Core earning fields are immutable.';
  end if;

  if old.status = 'paid' and new.status <> 'paid' then
    raise exception using errcode = '22023', message = 'Paid earnings cannot be reversed or silently debited.';
  end if;

  if old.status <> new.status and not (
    (old.status = 'pending' and new.status in ('available', 'reversed', 'failed')) or
    (old.status = 'available' and new.status in ('payout_processing', 'reversed', 'failed')) or
    (old.status = 'payout_processing' and new.status in ('paid', 'available', 'failed')) or
    (old.status = 'failed' and new.status in ('pending', 'available', 'reversed'))
  ) then
    raise exception using errcode = '22023', message = 'Invalid earning status transition.';
  end if;

  if new.status = 'available' and old.status <> 'available' then
    new.available_at := coalesce(new.available_at, clock_timestamp());
  end if;
  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_at := coalesce(new.paid_at, clock_timestamp());
  end if;
  if new.status = 'reversed' and old.status <> 'reversed' then
    new.reversed_at := coalesce(new.reversed_at, clock_timestamp());
    if char_length(trim(coalesce(new.reversal_reason, ''))) < 3 then
      raise exception using errcode = '22023', message = 'A reversal reason is required.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.record_dancer_earning_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text := 'system';
begin
  if auth.uid() is not null then
    if exists (
      select 1
      from public.app_users
      where id = auth.uid()
        and role = 'admin'
        and account_state = 'active'
    ) then
      v_actor_type := 'admin';
    elsif exists (
      select 1
      from public.dancer_profiles
      where user_id = auth.uid()
    ) then
      v_actor_type := 'dancer';
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.dancer_earning_status_history (
      earning_id, from_status, to_status, actor_user_id, actor_type, reason, metadata
    ) values (
      new.id,
      null,
      new.status,
      auth.uid(),
      v_actor_type,
      coalesce(new.reversal_reason, new.hold_reason),
      jsonb_build_object('payout_id', new.payout_batch_id, 'provider', new.payment_provider)
    );
  elsif old.status is distinct from new.status then
    insert into public.dancer_earning_status_history (
      earning_id, from_status, to_status, actor_user_id, actor_type, reason, metadata
    ) values (
      new.id,
      old.status,
      new.status,
      auth.uid(),
      v_actor_type,
      coalesce(new.reversal_reason, new.hold_reason),
      jsonb_build_object('payout_id', new.payout_batch_id, 'provider', new.payment_provider)
    );
  end if;
  return new;
end;
$$;

create or replace function public.prohibit_financial_record_delete()
returns trigger language plpgsql as $$
begin
  raise exception using errcode = '22023', message = 'Financial records cannot be deleted.';
end;
$$;

drop trigger if exists commission_events_prepare_earning on public.commission_events;
create trigger commission_events_prepare_earning
  before insert or update on public.commission_events
  for each row execute function public.prepare_dancer_earning();
drop trigger if exists commission_events_status_history on public.commission_events;
create trigger commission_events_status_history
  after insert or update of status on public.commission_events
  for each row execute function public.record_dancer_earning_status_history();
drop trigger if exists commission_events_no_delete on public.commission_events;
create trigger commission_events_no_delete
  before delete on public.commission_events
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists dancer_payout_batches_no_delete on public.dancer_payout_batches;
create trigger dancer_payout_batches_no_delete
  before delete on public.dancer_payout_batches
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists dancer_payout_items_no_delete on public.dancer_payout_items;
create trigger dancer_payout_items_no_delete
  before delete on public.dancer_payout_items
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists dancer_earning_history_no_delete on public.dancer_earning_status_history;
create trigger dancer_earning_history_no_delete
  before delete on public.dancer_earning_status_history
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists provider_webhooks_no_delete on public.payment_provider_webhook_events;
create trigger provider_webhooks_no_delete
  before delete on public.payment_provider_webhook_events
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists financial_audit_no_delete on public.financial_audit_events;
create trigger financial_audit_no_delete
  before delete on public.financial_audit_events
  for each row execute function public.prohibit_financial_record_delete();

create or replace function public.release_pending_dancer_earnings(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  with eligible as (
    select id from public.commission_events
    where status = 'pending'
      and pending_until <= clock_timestamp()
      and held_at is null
      and review_flag is null
    order by pending_until, id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  )
  update public.commission_events earning
  set status = 'available', available_at = clock_timestamp()
  from eligible where earning.id = eligible.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_dancer_earnings_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pending_cents', coalesce(sum(earning.amount_cents) filter (where earning.status = 'pending'), 0),
    'available_cents', coalesce(sum(earning.amount_cents) filter (
      where earning.status = 'available' and earning.held_at is null and earning.review_flag is null
    ), 0),
    'processing_cents', coalesce(sum(earning.amount_cents) filter (where earning.status = 'payout_processing'), 0),
    'paid_cents', coalesce(sum(earning.amount_cents) filter (where earning.status = 'paid'), 0),
    'lifetime_cents', coalesce(sum(earning.amount_cents) filter (
      where earning.status in ('available', 'payout_processing', 'paid')
    ), 0)
  )
  from public.dancer_profiles dancer
  left join public.commission_events earning on earning.dancer_id = dancer.id
  where dancer.user_id = p_user_id;
$$;

create or replace function public.get_admin_dancer_financial_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pending_cents', coalesce((select sum(amount_cents) from public.commission_events where status = 'pending'), 0),
    'available_cents', coalesce((select sum(amount_cents) from public.commission_events
      where status = 'available' and held_at is null and review_flag is null), 0),
    'processing_cents', coalesce((select sum(amount_cents) from public.commission_events where status = 'payout_processing'), 0),
    'paid_cents', coalesce((select sum(amount_cents) from public.dancer_payout_batches where status = 'paid'), 0),
    'reversed_cents', coalesce((select sum(amount_cents) from public.commission_events where status = 'reversed'), 0),
    'failed_payout_count', coalesce((select count(*) from public.dancer_payout_batches where status = 'failed'), 0),
    'completed_payout_count', coalesce((select count(*) from public.dancer_payout_batches where status = 'paid'), 0)
  );
$$;

create or replace function public.request_dancer_payout(
  p_user_id uuid,
  p_request_key text,
  p_payment_provider text,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dancer_id uuid;
  v_account public.dancer_payout_accounts%rowtype;
  v_settings public.payout_settings%rowtype;
  v_payout_id uuid;
  v_amount bigint;
  v_count integer;
  v_earning_ids uuid[];
  v_duplicate jsonb;
begin
  if char_length(trim(coalesce(p_request_key, ''))) < 12 then
    raise exception using errcode = '22023', message = 'A valid idempotency key is required.';
  end if;
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other') then
    raise exception using errcode = '22023', message = 'Unsupported payout provider.';
  end if;

  -- Lock the dancer row before inspecting idempotency or active batches. This
  -- serializes simultaneous cash-out requests even before a payout row exists.
  select id into v_dancer_id from public.dancer_profiles where user_id = p_user_id for update;
  if v_dancer_id is null then
    raise exception using errcode = '42501', message = 'Dancer account required.';
  end if;
  select * into v_settings from public.payout_settings where id = 'default' for share;
  if v_settings.payout_mode not in ('manual_cashout', 'both') then
    raise exception using errcode = '22023', message = 'Manual cash out is not enabled.';
  end if;

  select jsonb_build_object('id', id, 'status', status, 'amount_cents', amount_cents,
    'currency', currency, 'is_test', is_test, 'duplicate', true)
    into v_duplicate
  from public.dancer_payout_batches
  where request_key = trim(p_request_key) and dancer_id = v_dancer_id;
  if v_duplicate is not null then return v_duplicate; end if;

  if not p_is_test then
    select * into v_account from public.dancer_payout_accounts
    where dancer_id = v_dancer_id and payment_provider = p_payment_provider;
    if not found or v_account.onboarding_status <> 'complete'
      or v_account.payout_eligibility <> 'eligible'
      or v_account.verification_status <> 'verified'
    then
      raise exception using errcode = '22023', message = 'Payout setup and verification must be completed first.';
    end if;
  end if;

  perform 1 from public.dancer_payout_batches
  where dancer_id = v_dancer_id and currency = 'usd' and status in ('requested', 'processing')
  for update;
  if found then
    raise exception using errcode = '23505', message = 'A payout request is already active.';
  end if;

  with locked_earnings as (
    select id, amount_cents
    from public.commission_events
    where dancer_id = v_dancer_id and status = 'available' and payout_batch_id is null
      and held_at is null and review_flag is null and currency = 'usd'
    order by created_at, id
    for update
  )
  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint, array_agg(id order by id)
    into v_count, v_amount, v_earning_ids
  from locked_earnings;

  if v_count = 0 or v_amount < v_settings.minimum_payout_cents then
    raise exception using errcode = '22023', message = 'Available earnings do not meet the minimum cash-out amount.';
  end if;

  insert into public.dancer_payout_batches (
    dancer_id, status, currency, amount_cents, payment_provider, request_key, is_test,
    requested_at, metadata
  ) values (
    v_dancer_id, 'requested', 'usd', v_amount::integer, p_payment_provider,
    trim(p_request_key), p_is_test, clock_timestamp(),
    jsonb_build_object('requested_by_user_id', p_user_id, 'source', 'manual_cashout')
  ) returning id into v_payout_id;

  insert into public.dancer_payout_items (payout_batch_id, commission_event_id, amount_cents)
  select v_payout_id, id, amount_cents from public.commission_events
  where id = any(v_earning_ids);

  update public.commission_events
  set status = 'payout_processing', payout_batch_id = v_payout_id,
      payment_provider = p_payment_provider
  where id in (
    select commission_event_id from public.dancer_payout_items where payout_batch_id = v_payout_id
  );

  insert into public.financial_audit_events (
    actor_user_id, actor_type, action, target_type, target_id, after_state, metadata
  ) values (
    p_user_id, 'dancer', 'request_cash_out', 'payout', v_payout_id::text,
    jsonb_build_object('status', 'requested', 'amount_cents', v_amount, 'currency', 'usd'),
    jsonb_build_object('is_test', p_is_test, 'request_key', trim(p_request_key))
  );

  return jsonb_build_object('id', v_payout_id, 'status', 'requested',
    'amount_cents', v_amount, 'currency', 'usd', 'is_test', p_is_test);
exception when unique_violation then
  select jsonb_build_object('id', id, 'status', status, 'amount_cents', amount_cents,
    'currency', currency, 'is_test', is_test, 'duplicate', true)
    into v_duplicate from public.dancer_payout_batches where request_key = trim(p_request_key);
  if v_duplicate is not null then return v_duplicate; end if;
  raise;
end;
$$;

create or replace function public.mark_dancer_payout_processing(
  p_payout_id uuid,
  p_provider_reference_id text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_payout public.dancer_payout_batches%rowtype;
begin
  if char_length(trim(coalesce(p_provider_reference_id, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Provider reference is required.';
  end if;
  select * into v_payout from public.dancer_payout_batches where id = p_payout_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status = 'paid' and v_payout.provider_reference_id = trim(p_provider_reference_id) then
    return jsonb_build_object('id', p_payout_id, 'status', 'paid', 'duplicate', true);
  end if;
  if v_payout.status not in ('requested', 'processing') then
    raise exception using errcode = '22023', message = 'Payout cannot enter processing from its current status.';
  end if;
  update public.dancer_payout_batches set status = 'processing', processing_at = coalesce(processing_at, now()),
    provider_reference_id = trim(p_provider_reference_id),
    stripe_transfer_id = case when payment_provider = 'stripe' then trim(p_provider_reference_id) else stripe_transfer_id end,
    external_reference = trim(p_provider_reference_id), failure_message = null,
    metadata = metadata - 'dispatch_review_required' - 'dispatch_last_error', updated_at = now()
  where id = p_payout_id;
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, before_state, after_state)
  values ('system', 'payout_processing', 'payout', p_payout_id::text,
    jsonb_build_object('status', v_payout.status),
    jsonb_build_object('status', 'processing', 'provider_reference_id', trim(p_provider_reference_id)));
  return jsonb_build_object('id', p_payout_id, 'status', 'processing');
end;
$$;

create or replace function public.flag_dancer_payout_dispatch_review(
  p_payout_id uuid,
  p_failure_message text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_payout public.dancer_payout_batches%rowtype;
begin
  select * into v_payout from public.dancer_payout_batches where id = p_payout_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status <> 'processing' then
    return jsonb_build_object('id', p_payout_id, 'status', v_payout.status, 'unchanged', true);
  end if;
  update public.dancer_payout_batches
  set failure_message = left('Provider dispatch needs reconciliation: ' || coalesce(p_failure_message, 'Unknown provider response'), 500),
      metadata = metadata || jsonb_build_object(
        'dispatch_review_required', true,
        'dispatch_last_error', left(coalesce(p_failure_message, 'Unknown provider response'), 500)
      ),
      updated_at = now()
  where id = p_payout_id;
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, reason, after_state)
  values ('system', 'payout_dispatch_review', 'payout', p_payout_id::text,
    left(coalesce(p_failure_message, 'Unknown provider response'), 500),
    jsonb_build_object('status', 'processing', 'reservation_released', false));
  return jsonb_build_object('id', p_payout_id, 'status', 'processing', 'review_required', true);
end;
$$;

create or replace function public.complete_dancer_payout_batch(
  p_batch_id uuid,
  p_transfer_id text,
  p_paid_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_payout public.dancer_payout_batches%rowtype;
begin
  if char_length(trim(coalesce(p_transfer_id, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A valid provider payout reference is required.';
  end if;
  select * into v_payout from public.dancer_payout_batches where id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status <> 'processing' then
    raise exception using errcode = '22023', message = 'Only a processing payout can be marked paid.';
  end if;
  update public.dancer_payout_batches set status = 'paid', provider_reference_id = trim(p_transfer_id),
    external_reference = trim(p_transfer_id), paid_at = p_paid_at, failure_message = null, updated_at = now()
  where id = p_batch_id;
  update public.commission_events set status = 'paid', paid_at = p_paid_at
  where payout_batch_id = p_batch_id and status = 'payout_processing';
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, after_state)
  values ('provider', 'payout_paid', 'payout', p_batch_id::text,
    jsonb_build_object('status', 'paid', 'provider_reference_id', trim(p_transfer_id), 'paid_at', p_paid_at));
  return jsonb_build_object('id', p_batch_id, 'status', 'paid', 'provider_reference_id', trim(p_transfer_id));
end;
$$;

create or replace function public.release_dancer_payout_batch(
  p_batch_id uuid,
  p_status text,
  p_failure_message text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_payout public.dancer_payout_batches%rowtype; v_final_status text;
begin
  v_final_status := case when p_status in ('canceled') then 'canceled' else 'failed' end;
  select * into v_payout from public.dancer_payout_batches where id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status not in ('requested', 'processing') then
    raise exception using errcode = '22023', message = 'Payout cannot be released from its current status.';
  end if;
  update public.commission_events set status = 'available', payout_batch_id = null, payment_provider = null,
    metadata = metadata || jsonb_build_object('released_payout_id', p_batch_id,
      'release_reason', left(coalesce(p_failure_message, ''), 500))
  where payout_batch_id = p_batch_id and status = 'payout_processing';
  update public.dancer_payout_batches set status = v_final_status,
    failed_at = case when v_final_status = 'failed' then now() else failed_at end,
    canceled_at = case when v_final_status = 'canceled' then now() else canceled_at end,
    failure_message = left(coalesce(p_failure_message, 'Payout was not completed.'), 500), updated_at = now()
  where id = p_batch_id;
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, after_state, reason)
  values ('system', 'release_payout_reservation', 'payout', p_batch_id::text,
    jsonb_build_object('status', v_final_status), left(coalesce(p_failure_message, ''), 500));
  return jsonb_build_object('id', p_batch_id, 'status', v_final_status);
end;
$$;

drop function if exists public.create_dancer_payout_batch(uuid, text, uuid[]);
create or replace function public.create_dancer_payout_batch(
  p_dancer_id uuid,
  p_currency text,
  p_commission_event_ids uuid[],
  p_payment_provider text default 'stripe'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count integer;
  v_amount bigint;
  v_settings public.payout_settings%rowtype;
  v_account public.dancer_payout_accounts%rowtype;
begin
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other') then
    raise exception using errcode = '22023', message = 'Unsupported payout provider.';
  end if;
  if lower(p_currency) <> 'usd' then
    raise exception using errcode = '22023', message = 'Only USD payouts are currently supported.';
  end if;
  select * into v_settings from public.payout_settings where id = 'default' for share;
  if v_settings.payout_mode not in ('scheduled', 'both') then
    raise exception using errcode = '22023', message = 'Scheduled payouts are not enabled.';
  end if;
  select * into v_account from public.dancer_payout_accounts
  where dancer_id = p_dancer_id and payment_provider = p_payment_provider;
  if not found or v_account.onboarding_status <> 'complete'
    or v_account.payout_eligibility <> 'eligible'
    or v_account.verification_status <> 'verified'
  then
    raise exception using errcode = '22023', message = 'Payout setup and verification must be completed first.';
  end if;
  with locked_earnings as (
    select id, amount_cents
    from public.commission_events
    where id = any(p_commission_event_ids) and dancer_id = p_dancer_id
      and status = 'available' and payout_batch_id is null and currency = lower(p_currency)
      and held_at is null and review_flag is null
    order by created_at, id
    for update
  )
  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint into v_count, v_amount
  from locked_earnings;
  if v_count <> coalesce(array_length(p_commission_event_ids, 1), 0)
    or v_amount < v_settings.minimum_payout_cents
  then
    raise exception using errcode = '22023', message = 'Earnings are no longer available.';
  end if;
  insert into public.dancer_payout_batches (dancer_id, status, currency, amount_cents, payment_provider, requested_at)
  values (p_dancer_id, 'requested', lower(p_currency), v_amount::integer, p_payment_provider, now()) returning id into v_id;
  insert into public.dancer_payout_items (payout_batch_id, commission_event_id, amount_cents)
  select v_id, id, amount_cents from public.commission_events where id = any(p_commission_event_ids);
  update public.commission_events set status = 'payout_processing', payout_batch_id = v_id
  where id = any(p_commission_event_ids) and status = 'available'
    and payout_batch_id is null and held_at is null and review_flag is null;
  return v_id;
end;
$$;

create or replace function public.admin_manage_dancer_earning(
  p_admin_user_id uuid,
  p_earning_id uuid,
  p_action text,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before public.commission_events%rowtype; v_after public.commission_events%rowtype;
begin
  if not exists (select 1 from public.app_users where id = p_admin_user_id and role = 'admin' and account_state = 'active') then
    raise exception using errcode = '42501', message = 'Active admin access required.';
  end if;
  if p_action not in ('hold', 'release', 'reverse') then
    raise exception using errcode = '22023', message = 'Unsupported earning action.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A reason is required.';
  end if;
  select * into v_before from public.commission_events where id = p_earning_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Earning not found.'; end if;
  if p_action = 'hold' then
    if v_before.status not in ('pending', 'available') then raise exception using errcode = '22023', message = 'This earning cannot be held.'; end if;
    update public.commission_events set held_at = now(), hold_reason = trim(p_reason) where id = p_earning_id returning * into v_after;
  elsif p_action = 'release' then
    if v_before.status not in ('pending', 'available', 'failed') then raise exception using errcode = '22023', message = 'This earning cannot be released.'; end if;
    update public.commission_events set held_at = null, hold_reason = null, review_flag = null,
      status = case when pending_until <= now() then 'available' else 'pending' end
    where id = p_earning_id returning * into v_after;
  else
    if v_before.status not in ('pending', 'available', 'failed') then
      raise exception using errcode = '22023', message = 'Paid or processing earnings require an approved recovery process.';
    end if;
    update public.commission_events set status = 'reversed', reversed_at = now(), reversal_reason = trim(p_reason),
      held_at = null, hold_reason = null where id = p_earning_id returning * into v_after;
  end if;
  insert into public.financial_audit_events (actor_user_id, actor_type, action, target_type, target_id, reason, before_state, after_state)
  values (p_admin_user_id, 'admin', p_action || '_earning', 'earning', p_earning_id::text, trim(p_reason), to_jsonb(v_before), to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

create or replace function public.admin_update_payout_settings(
  p_admin_user_id uuid,
  p_payouts_enabled boolean,
  p_payment_provider text,
  p_earnings_hold_days integer,
  p_minimum_payout_cents integer,
  p_payout_mode text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before public.payout_settings%rowtype; v_after public.payout_settings%rowtype;
begin
  if not exists (select 1 from public.app_users where id = p_admin_user_id and role = 'admin' and account_state = 'active') then
    raise exception using errcode = '42501', message = 'Active admin access required.';
  end if;
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other') or p_payout_mode not in ('manual_cashout', 'scheduled', 'both')
    or p_earnings_hold_days not between 0 and 90 or p_minimum_payout_cents not between 1 and 10000000
  then
    raise exception using errcode = '22023', message = 'Invalid payout settings.';
  end if;
  select * into v_before from public.payout_settings where id = 'default' for update;
  update public.payout_settings set payouts_enabled = p_payouts_enabled,
    payment_provider = p_payment_provider, earnings_hold_days = p_earnings_hold_days,
    minimum_payout_cents = p_minimum_payout_cents, payout_mode = p_payout_mode,
    updated_by = p_admin_user_id, updated_at = now()
  where id = 'default' returning * into v_after;
  insert into public.financial_audit_events (actor_user_id, actor_type, action, target_type, target_id, before_state, after_state)
  values (p_admin_user_id, 'admin', 'update_payout_settings', 'settings', 'default', to_jsonb(v_before), to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

create or replace function public.admin_retry_dancer_payout(
  p_admin_user_id uuid,
  p_failed_payout_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old public.dancer_payout_batches%rowtype;
  v_new_id uuid;
  v_count integer;
  v_amount bigint;
begin
  if not exists (select 1 from public.app_users where id = p_admin_user_id and role = 'admin' and account_state = 'active') then
    raise exception using errcode = '42501', message = 'Active admin access required.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A retry reason is required.';
  end if;
  select * into v_old from public.dancer_payout_batches where id = p_failed_payout_id for update;
  if not found or v_old.status <> 'failed' then
    raise exception using errcode = '22023', message = 'Only a failed payout can be retried.';
  end if;
  perform 1 from public.dancer_payout_batches
    where dancer_id = v_old.dancer_id and currency = v_old.currency and status in ('requested', 'processing') for update;
  if found then raise exception using errcode = '23505', message = 'A payout request is already active.'; end if;
  with locked_earnings as (
    select earning.id, earning.amount_cents
    from public.dancer_payout_items old_item
    join public.commission_events earning on earning.id = old_item.commission_event_id
    where old_item.payout_batch_id = p_failed_payout_id
      and earning.status = 'available' and earning.payout_batch_id is null
      and earning.held_at is null and earning.review_flag is null
    order by earning.created_at, earning.id for update of earning
  )
  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint into v_count, v_amount from locked_earnings;
  if v_count = 0 or v_amount <> v_old.amount_cents then
    raise exception using errcode = '22023', message = 'The original earnings are not all eligible for a safe retry.';
  end if;
  insert into public.dancer_payout_batches (dancer_id, status, currency, amount_cents, payment_provider, request_key, requested_at, metadata)
  values (v_old.dancer_id, 'requested', v_old.currency, v_old.amount_cents, v_old.payment_provider,
    'retry:' || p_failed_payout_id::text || ':' || gen_random_uuid()::text, now(),
    jsonb_build_object('retry_of', p_failed_payout_id, 'retry_reason', trim(p_reason))) returning id into v_new_id;
  insert into public.dancer_payout_items (payout_batch_id, commission_event_id, amount_cents)
  select v_new_id, earning.id, earning.amount_cents
  from public.dancer_payout_items old_item join public.commission_events earning on earning.id = old_item.commission_event_id
  where old_item.payout_batch_id = p_failed_payout_id and earning.status = 'available' and earning.payout_batch_id is null;
  update public.commission_events set status = 'payout_processing', payout_batch_id = v_new_id,
    payment_provider = v_old.payment_provider
  where id in (select commission_event_id from public.dancer_payout_items where payout_batch_id = v_new_id);
  insert into public.financial_audit_events (actor_user_id, actor_type, action, target_type, target_id, reason, after_state)
  values (p_admin_user_id, 'admin', 'retry_failed_payout', 'payout', v_new_id::text, trim(p_reason),
    jsonb_build_object('status', 'requested', 'retry_of', p_failed_payout_id, 'amount_cents', v_old.amount_cents));
  return jsonb_build_object('id', v_new_id, 'status', 'requested', 'retry_of', p_failed_payout_id);
end;
$$;

-- Disable the legacy direct-paid shortcut; payouts must reserve earnings first.
create or replace function public.settle_dancer_commission_event(p_commission_event_id uuid, p_external_reference text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  raise exception using errcode = '22023', message = 'Use the dancer payout workflow; earnings cannot jump directly to paid.';
end;
$$;

alter table public.payout_settings enable row level security;
alter table public.dancer_earning_status_history enable row level security;
alter table public.payment_provider_webhook_events enable row level security;
alter table public.financial_audit_events enable row level security;

drop policy if exists "Admins manage payout settings" on public.payout_settings;
drop policy if exists "Admins read payout settings" on public.payout_settings;
create policy "Admins read payout settings" on public.payout_settings for select using (public.is_admin());

drop policy if exists "Admins read earning history" on public.dancer_earning_status_history;
create policy "Admins read earning history" on public.dancer_earning_status_history for select using (public.is_admin());
drop policy if exists "Dancers read own earning history" on public.dancer_earning_status_history;
create policy "Dancers read own earning history" on public.dancer_earning_status_history for select using (
  exists (select 1 from public.commission_events earning join public.dancer_profiles dancer on dancer.id = earning.dancer_id
    where earning.id = earning_id and dancer.user_id = auth.uid())
);

drop policy if exists "Admins read provider webhooks" on public.payment_provider_webhook_events;
drop policy if exists "Admins read Stripe finance events" on public.payment_provider_webhook_events;
create policy "Admins read provider webhooks" on public.payment_provider_webhook_events for select using (public.is_admin());
drop policy if exists "Admins read financial audit" on public.financial_audit_events;
create policy "Admins read financial audit" on public.financial_audit_events for select using (public.is_admin());

drop policy if exists "Venue owners read own commission events" on public.commission_events;
drop policy if exists "Dancers view own commission events" on public.commission_events;
drop policy if exists "Dancers read own commission events" on public.commission_events;
drop policy if exists "Admins manage commission events" on public.commission_events;
drop policy if exists "Admins read commission events" on public.commission_events;
create policy "Admins read commission events" on public.commission_events for select using (public.is_admin());
create policy "Dancers read own earnings" on public.commission_events for select using (
  exists (select 1 from public.dancer_profiles dancer where dancer.id = dancer_id and dancer.user_id = auth.uid())
);

-- Financial writes are intentionally server-only. Admins can inspect these
-- records directly under RLS, but every mutation must use an audited server
-- endpoint/RPC rather than a broad table policy.
drop policy if exists "Admins manage dancer payout accounts" on public.dancer_payout_accounts;
drop policy if exists "Admins read dancer payout accounts" on public.dancer_payout_accounts;
create policy "Admins read dancer payout accounts" on public.dancer_payout_accounts for select using (public.is_admin());
drop policy if exists "Admins manage dancer payout batches" on public.dancer_payout_batches;
drop policy if exists "Admins read dancer payout batches" on public.dancer_payout_batches;
create policy "Admins read dancer payout batches" on public.dancer_payout_batches for select using (public.is_admin());
drop policy if exists "Admins manage dancer payout items" on public.dancer_payout_items;
drop policy if exists "Admins read dancer payout items" on public.dancer_payout_items;
create policy "Admins read dancer payout items" on public.dancer_payout_items for select using (public.is_admin());

revoke all on function public.release_pending_dancer_earnings(integer) from public, anon, authenticated;
revoke all on function public.claim_payment_provider_webhook(text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_dancer_earnings_summary(uuid) from public, anon, authenticated;
revoke all on function public.get_admin_dancer_financial_summary() from public, anon, authenticated;
revoke all on function public.request_dancer_payout(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.mark_dancer_payout_processing(uuid, text) from public, anon, authenticated;
revoke all on function public.flag_dancer_payout_dispatch_review(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_dancer_payout_batch(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_dancer_payout_batch(uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_dancer_payout_batch(uuid, text, uuid[], text) from public, anon, authenticated;
revoke all on function public.admin_manage_dancer_earning(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_payout_settings(uuid, boolean, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.admin_retry_dancer_payout(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.settle_dancer_commission_event(uuid, text) from public, anon, authenticated;

grant execute on function public.release_pending_dancer_earnings(integer) to service_role;
grant execute on function public.claim_payment_provider_webhook(text, text, text, text) to service_role;
grant execute on function public.get_dancer_earnings_summary(uuid) to service_role;
grant execute on function public.get_admin_dancer_financial_summary() to service_role;
grant execute on function public.request_dancer_payout(uuid, text, text, boolean) to service_role;
grant execute on function public.mark_dancer_payout_processing(uuid, text) to service_role;
grant execute on function public.flag_dancer_payout_dispatch_review(uuid, text) to service_role;
grant execute on function public.complete_dancer_payout_batch(uuid, text, timestamptz) to service_role;
grant execute on function public.release_dancer_payout_batch(uuid, text, text) to service_role;
grant execute on function public.create_dancer_payout_batch(uuid, text, uuid[], text) to service_role;
grant execute on function public.admin_manage_dancer_earning(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_update_payout_settings(uuid, boolean, text, integer, integer, text) to service_role;
grant execute on function public.admin_retry_dancer_payout(uuid, uuid, text) to service_role;

comment on table public.commission_events is 'Immutable-source dancer earnings ledger; balances are derived from controlled status rows.';
comment on table public.dancer_payout_accounts is 'Provider references and eligibility only; no bank, card, routing, or full tax credentials.';
comment on table public.payment_provider_webhook_events is 'Idempotency and audit records for signature-verified provider webhooks.';
