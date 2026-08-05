-- Production QR receivables, club invoicing, payout batching, and Stripe reconciliation.

create table if not exists public.club_finance_accounts (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  stripe_customer_id text unique,
  billing_email text,
  collection_method text not null default 'send_invoice'
    check (collection_method in ('send_invoice', 'charge_automatically')),
  payment_terms_days integer not null default 15 check (payment_terms_days between 1 and 90),
  automatic_billing_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_invoices (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  sequence integer not null default 1 check (sequence > 0),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'paid', 'overdue', 'void', 'uncollectible', 'failed')),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  amount_due_cents integer not null default 0 check (amount_due_cents >= 0),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  due_at timestamptz not null,
  stripe_customer_id text,
  stripe_invoice_id text unique,
  hosted_invoice_url text,
  invoice_pdf_url text,
  external_payment_reference text,
  paid_at timestamptz,
  last_reminder_at timestamptz,
  reminder_count integer not null default 0 check (reminder_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, period_start, period_end, sequence),
  check (period_end >= period_start),
  check (amount_paid_cents <= amount_due_cents)
);

create table if not exists public.club_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.club_invoices(id) on delete cascade,
  revenue_event_id uuid not null references public.deal_revenue_events(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (invoice_id, revenue_event_id)
);

alter table public.deal_revenue_events
  add column if not exists club_invoice_id uuid references public.club_invoices(id) on delete set null;

create table if not exists public.club_invoice_reminders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.club_invoices(id) on delete cascade,
  reminder_key text not null,
  delivery_provider text not null default 'stripe',
  provider_reference text,
  sent_at timestamptz not null default now(),
  audit jsonb not null default '{}'::jsonb,
  unique (invoice_id, reminder_key)
);

create table if not exists public.dancer_payout_accounts (
  dancer_id uuid primary key references public.dancer_profiles(id) on delete cascade,
  stripe_account_id text not null unique,
  country text not null default 'US',
  default_currency text not null default 'usd' check (default_currency ~ '^[a-z]{3}$'),
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  onboarding_complete boolean not null default false,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dancer_payout_batches (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed', 'reversed')),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  amount_cents integer not null check (amount_cents > 0),
  period_start date,
  period_end date,
  stripe_transfer_id text unique,
  external_reference text,
  failure_message text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dancer_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_batch_id uuid not null references public.dancer_payout_batches(id) on delete cascade,
  commission_event_id uuid not null references public.commission_events(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (payout_batch_id, commission_event_id)
);

alter table public.commission_events
  add column if not exists payout_batch_id uuid references public.dancer_payout_batches(id) on delete set null;

create table if not exists public.stripe_finance_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  object_id text,
  processed_at timestamptz not null default now(),
  audit jsonb not null default '{}'::jsonb
);

create index if not exists club_invoices_venue_status_due_idx
  on public.club_invoices(venue_id, status, due_at desc);
create index if not exists club_invoices_status_due_idx
  on public.club_invoices(status, due_at);
create index if not exists club_invoice_items_revenue_idx
  on public.club_invoice_items(revenue_event_id);
create index if not exists deal_revenue_events_invoice_idx
  on public.deal_revenue_events(club_invoice_id, status);
create index if not exists dancer_payout_batches_dancer_status_idx
  on public.dancer_payout_batches(dancer_id, status, created_at desc);
create index if not exists dancer_payout_items_commission_idx
  on public.dancer_payout_items(commission_event_id);
create index if not exists commission_events_payout_batch_idx
  on public.commission_events(payout_batch_id, status);

alter table public.club_finance_accounts enable row level security;
alter table public.club_invoices enable row level security;
alter table public.club_invoice_items enable row level security;
alter table public.club_invoice_reminders enable row level security;
alter table public.dancer_payout_accounts enable row level security;
alter table public.dancer_payout_batches enable row level security;
alter table public.dancer_payout_items enable row level security;
alter table public.stripe_finance_webhook_events enable row level security;

drop policy if exists "Admins manage club finance accounts" on public.club_finance_accounts;
create policy "Admins manage club finance accounts" on public.club_finance_accounts
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Venue owners read own finance account" on public.club_finance_accounts;
create policy "Venue owners read own finance account" on public.club_finance_accounts
  for select using (
    exists (
      select 1 from public.venues venue
      where venue.id = venue_id and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage club invoices" on public.club_invoices;
create policy "Admins manage club invoices" on public.club_invoices
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Venue owners read own invoices" on public.club_invoices;
create policy "Venue owners read own invoices" on public.club_invoices
  for select using (
    exists (
      select 1 from public.venues venue
      where venue.id = venue_id and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage club invoice items" on public.club_invoice_items;
create policy "Admins manage club invoice items" on public.club_invoice_items
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Venue owners read own invoice items" on public.club_invoice_items;
create policy "Venue owners read own invoice items" on public.club_invoice_items
  for select using (
    exists (
      select 1
      from public.club_invoices invoice
      join public.venues venue on venue.id = invoice.venue_id
      where invoice.id = invoice_id and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage club invoice reminders" on public.club_invoice_reminders;
create policy "Admins manage club invoice reminders" on public.club_invoice_reminders
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Venue owners read own invoice reminders" on public.club_invoice_reminders;
create policy "Venue owners read own invoice reminders" on public.club_invoice_reminders
  for select using (
    exists (
      select 1
      from public.club_invoices invoice
      join public.venues venue on venue.id = invoice.venue_id
      where invoice.id = invoice_id and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage dancer payout accounts" on public.dancer_payout_accounts;
create policy "Admins manage dancer payout accounts" on public.dancer_payout_accounts
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Dancers read own payout account" on public.dancer_payout_accounts;
create policy "Dancers read own payout account" on public.dancer_payout_accounts
  for select using (
    exists (
      select 1 from public.dancer_profiles dancer
      where dancer.id = dancer_id and dancer.user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage dancer payout batches" on public.dancer_payout_batches;
create policy "Admins manage dancer payout batches" on public.dancer_payout_batches
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Dancers read own payout batches" on public.dancer_payout_batches;
create policy "Dancers read own payout batches" on public.dancer_payout_batches
  for select using (
    exists (
      select 1 from public.dancer_profiles dancer
      where dancer.id = dancer_id and dancer.user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage dancer payout items" on public.dancer_payout_items;
create policy "Admins manage dancer payout items" on public.dancer_payout_items
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Dancers read own payout items" on public.dancer_payout_items;
create policy "Dancers read own payout items" on public.dancer_payout_items
  for select using (
    exists (
      select 1
      from public.dancer_payout_batches batch
      join public.dancer_profiles dancer on dancer.id = batch.dancer_id
      where batch.id = payout_batch_id and dancer.user_id = auth.uid()
    )
  );

drop policy if exists "Admins read Stripe finance events" on public.stripe_finance_webhook_events;
create policy "Admins read Stripe finance events" on public.stripe_finance_webhook_events
  for select using (public.is_admin());

create or replace function public.create_club_invoice_draft(
  p_venue_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_at timestamptz,
  p_revenue_event_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_sequence integer;
  v_expected integer := coalesce(array_length(p_revenue_event_ids, 1), 0);
  v_amount integer;
begin
  if v_expected = 0 then
    raise exception using errcode = '22023', message = 'At least one revenue event is required.';
  end if;

  select count(*)::integer, coalesce(sum(revenue.gross_commission_cents), 0)::integer
    into v_sequence, v_amount
  from public.deal_revenue_events revenue
  where revenue.id = any(p_revenue_event_ids)
    and revenue.venue_id = p_venue_id
    and revenue.status = 'pending_venue_payment'
    and revenue.club_invoice_id is null;

  if v_sequence <> v_expected or v_amount <= 0 then
    raise exception using errcode = '22023', message = 'Revenue events are no longer invoiceable.';
  end if;

  select coalesce(max(invoice.sequence), 0) + 1
    into v_sequence
  from public.club_invoices invoice
  where invoice.venue_id = p_venue_id
    and invoice.period_start = p_period_start
    and invoice.period_end = p_period_end;

  insert into public.club_invoices (
    venue_id, period_start, period_end, sequence, amount_due_cents, due_at
  ) values (
    p_venue_id, p_period_start, p_period_end, v_sequence, v_amount, p_due_at
  ) returning id into v_invoice_id;

  insert into public.club_invoice_items (invoice_id, revenue_event_id, amount_cents)
  select v_invoice_id, revenue.id, revenue.gross_commission_cents
  from public.deal_revenue_events revenue
  where revenue.id = any(p_revenue_event_ids);

  update public.deal_revenue_events
  set club_invoice_id = v_invoice_id
  where id = any(p_revenue_event_ids);

  return v_invoice_id;
end;
$$;

create or replace function public.apply_club_invoice_payment(
  p_invoice_id uuid,
  p_total_paid_cents integer,
  p_payment_reference text,
  p_paid_at timestamptz default now(),
  p_stripe_invoice_id text default null,
  p_hosted_invoice_url text default null,
  p_invoice_pdf_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.club_invoices%rowtype;
  v_paid integer;
begin
  if length(trim(coalesce(p_payment_reference, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A valid payment reference is required.';
  end if;

  select invoice.* into v_invoice
  from public.club_invoices invoice
  where invoice.id = p_invoice_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Club invoice not found.';
  end if;
  if v_invoice.status in ('void', 'uncollectible') then
    raise exception using errcode = '22023', message = 'This invoice cannot accept payment.';
  end if;

  v_paid := least(v_invoice.amount_due_cents, greatest(v_invoice.amount_paid_cents, p_total_paid_cents));
  update public.club_invoices
  set amount_paid_cents = v_paid,
      status = case when v_paid >= amount_due_cents then 'paid' else 'open' end,
      external_payment_reference = trim(p_payment_reference),
      paid_at = case when v_paid >= amount_due_cents then p_paid_at else paid_at end,
      stripe_invoice_id = coalesce(p_stripe_invoice_id, stripe_invoice_id),
      hosted_invoice_url = coalesce(p_hosted_invoice_url, hosted_invoice_url),
      invoice_pdf_url = coalesce(p_invoice_pdf_url, invoice_pdf_url),
      last_error = null,
      updated_at = now()
  where id = p_invoice_id;

  if v_paid >= v_invoice.amount_due_cents then
    update public.deal_revenue_events revenue
    set status = case when revenue.dancer_commission_cents > 0 then 'payable' else 'settled' end,
        venue_payment_reference = trim(p_payment_reference),
        venue_payment_received_at = p_paid_at
    where revenue.club_invoice_id = p_invoice_id
      and revenue.status = 'pending_venue_payment';

    update public.commission_events commission
    set status = 'payable',
        club_payment_received_at = p_paid_at,
        payable_at = p_paid_at,
        audit = commission.audit || jsonb_build_object(
          'club_invoice_id', p_invoice_id,
          'venue_payment_reference', trim(p_payment_reference)
        )
    where commission.qr_redemption_id in (
      select revenue.qr_redemption_id
      from public.deal_revenue_events revenue
      where revenue.club_invoice_id = p_invoice_id
    ) and commission.status = 'pending_club_payment';
  end if;

  return jsonb_build_object(
    'id', p_invoice_id,
    'amount_paid_cents', v_paid,
    'status', case when v_paid >= v_invoice.amount_due_cents then 'paid' else 'open' end
  );
end;
$$;

create or replace function public.create_dancer_payout_batch(
  p_dancer_id uuid,
  p_currency text,
  p_commission_event_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_expected integer := coalesce(array_length(p_commission_event_ids, 1), 0);
  v_count integer;
  v_amount integer;
  v_period_start date;
  v_period_end date;
begin
  if v_expected = 0 then
    raise exception using errcode = '22023', message = 'At least one payable commission is required.';
  end if;

  select count(*)::integer,
         coalesce(sum(commission.amount_cents), 0)::integer,
         min(commission.commission_month),
         max(commission.commission_month)
    into v_count, v_amount, v_period_start, v_period_end
  from public.commission_events commission
  where commission.id = any(p_commission_event_ids)
    and commission.dancer_id = p_dancer_id
    and commission.status = 'payable'
    and commission.payout_batch_id is null
    and commission.currency = lower(p_currency);

  if v_count <> v_expected or v_amount <= 0 then
    raise exception using errcode = '22023', message = 'Commission events are no longer payable.';
  end if;

  insert into public.dancer_payout_batches (
    dancer_id, status, currency, amount_cents, period_start, period_end
  ) values (
    p_dancer_id, 'processing', lower(p_currency), v_amount, v_period_start, v_period_end
  ) returning id into v_batch_id;

  insert into public.dancer_payout_items (payout_batch_id, commission_event_id, amount_cents)
  select v_batch_id, commission.id, commission.amount_cents
  from public.commission_events commission
  where commission.id = any(p_commission_event_ids);

  update public.commission_events
  set payout_batch_id = v_batch_id
  where id = any(p_commission_event_ids);

  return v_batch_id;
end;
$$;

create or replace function public.complete_dancer_payout_batch(
  p_batch_id uuid,
  p_transfer_id text,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.dancer_payout_batches%rowtype;
begin
  if length(trim(coalesce(p_transfer_id, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A valid Stripe transfer reference is required.';
  end if;

  select batch.* into v_batch
  from public.dancer_payout_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Payout batch not found.';
  end if;
  if v_batch.status not in ('pending', 'processing') then
    raise exception using errcode = '22023', message = 'Payout batch cannot be completed from the current status.';
  end if;

  update public.dancer_payout_batches
  set status = 'paid', stripe_transfer_id = trim(p_transfer_id),
      external_reference = trim(p_transfer_id), paid_at = p_paid_at,
      failure_message = null, updated_at = now()
  where id = p_batch_id;

  update public.commission_events commission
  set status = 'paid', paid_at = p_paid_at,
      audit = commission.audit || jsonb_build_object(
        'payout_batch_id', p_batch_id,
        'dancer_payout_reference', trim(p_transfer_id)
      )
  where commission.payout_batch_id = p_batch_id and commission.status = 'payable';

  update public.deal_revenue_events revenue
  set status = 'settled', dancer_payout_reference = trim(p_transfer_id), dancer_paid_at = p_paid_at
  where revenue.qr_redemption_id in (
    select commission.qr_redemption_id
    from public.commission_events commission
    where commission.payout_batch_id = p_batch_id
  ) and revenue.status = 'payable';

  return jsonb_build_object('id', p_batch_id, 'status', 'paid', 'stripe_transfer_id', trim(p_transfer_id));
end;
$$;

create or replace function public.release_dancer_payout_batch(
  p_batch_id uuid,
  p_status text,
  p_failure_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.dancer_payout_batches%rowtype;
begin
  if p_status not in ('failed', 'reversed') then
    raise exception using errcode = '22023', message = 'Invalid payout release status.';
  end if;

  select batch.* into v_batch
  from public.dancer_payout_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Payout batch not found.';
  end if;

  update public.commission_events
  set payout_batch_id = null,
      status = 'payable',
      paid_at = null,
      audit = audit || jsonb_build_object(
        'released_payout_batch_id', p_batch_id,
        'release_status', p_status,
        'release_reason', left(coalesce(p_failure_message, ''), 500)
      )
  where payout_batch_id = p_batch_id;

  update public.deal_revenue_events revenue
  set status = 'payable', dancer_payout_reference = null, dancer_paid_at = null
  where revenue.qr_redemption_id in (
    select item_commission.qr_redemption_id
    from public.dancer_payout_items item
    join public.commission_events item_commission on item_commission.id = item.commission_event_id
    where item.payout_batch_id = p_batch_id
  ) and revenue.dancer_commission_cents > 0;

  update public.dancer_payout_batches
  set status = p_status,
      failure_message = left(coalesce(p_failure_message, 'Payout could not be completed.'), 500),
      updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object('id', p_batch_id, 'status', p_status);
end;
$$;

revoke all on function public.create_club_invoice_draft(uuid, date, date, timestamptz, uuid[]) from public, anon, authenticated;
revoke all on function public.apply_club_invoice_payment(uuid, integer, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.create_dancer_payout_batch(uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.complete_dancer_payout_batch(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_dancer_payout_batch(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_club_invoice_draft(uuid, date, date, timestamptz, uuid[]) to service_role;
grant execute on function public.apply_club_invoice_payment(uuid, integer, text, timestamptz, text, text, text) to service_role;
grant execute on function public.create_dancer_payout_batch(uuid, text, uuid[]) to service_role;
grant execute on function public.complete_dancer_payout_batch(uuid, text, timestamptz) to service_role;
grant execute on function public.release_dancer_payout_batch(uuid, text, text) to service_role;

grant select on public.club_finance_accounts, public.club_invoices, public.club_invoice_items,
  public.club_invoice_reminders, public.dancer_payout_accounts, public.dancer_payout_batches,
  public.dancer_payout_items, public.stripe_finance_webhook_events to authenticated;
grant all on public.club_finance_accounts, public.club_invoices, public.club_invoice_items,
  public.club_invoice_reminders, public.dancer_payout_accounts, public.dancer_payout_batches,
  public.dancer_payout_items, public.stripe_finance_webhook_events to service_role;
