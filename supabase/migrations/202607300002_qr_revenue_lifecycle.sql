-- Production QR attribution, venue-authorized redemption, and tiered commission ledger.

alter table public.club_deals
  add column if not exists currency text not null default 'usd'
    check (currency ~ '^[a-z]{3}$');

alter table public.qr_redemptions
  add column if not exists shift_id uuid references public.shifts(id) on delete set null,
  add column if not exists attribution_locked_at timestamptz,
  add column if not exists saved_at timestamptz,
  add column if not exists shared_at timestamptz,
  add column if not exists first_scanned_at timestamptz,
  add column if not exists confirmed_at timestamptz;

create index if not exists qr_redemptions_shift_idx
  on public.qr_redemptions(shift_id)
  where shift_id is not null;

create table if not exists public.qr_redemption_events (
  id uuid primary key default gen_random_uuid(),
  qr_redemption_id uuid not null references public.qr_redemptions(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'issued',
      'saved',
      'shared',
      'scanner_opened',
      'venue_confirmed',
      'expired',
      'voided'
    )
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  session_id text,
  ip_address text,
  user_agent text,
  audit jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists qr_redemption_events_redemption_time_idx
  on public.qr_redemption_events(qr_redemption_id, occurred_at desc);

create index if not exists qr_redemption_events_type_time_idx
  on public.qr_redemption_events(event_type, occurred_at desc);

create table if not exists public.deal_revenue_events (
  id uuid primary key default gen_random_uuid(),
  qr_redemption_id uuid not null unique references public.qr_redemptions(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  club_deal_id uuid not null references public.club_deals(id) on delete cascade,
  dancer_id uuid references public.dancer_profiles(id) on delete set null,
  source_type text not null check (source_type in ('club_page', 'dancer_profile')),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  gross_commission_cents integer not null check (gross_commission_cents >= 0),
  dancer_share_bps integer not null default 0 check (dancer_share_bps between 0 and 10000),
  dancer_commission_cents integer not null default 0 check (dancer_commission_cents >= 0),
  platform_commission_cents integer not null check (platform_commission_cents >= 0),
  successful_redemption_number integer check (successful_redemption_number > 0),
  commission_month date not null,
  policy_version text not null default 'monthly-tier-v1',
  status text not null default 'pending_venue_payment' check (
    status in ('pending_venue_payment', 'payable', 'settled', 'refunded', 'voided')
  ),
  venue_payment_reference text,
  venue_payment_received_at timestamptz,
  dancer_payout_reference text,
  dancer_paid_at timestamptz,
  refunded_at timestamptz,
  voided_at timestamptz,
  audit jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (dancer_commission_cents + platform_commission_cents = gross_commission_cents),
  check (
    (source_type = 'club_page' and dancer_id is null and dancer_share_bps = 0 and dancer_commission_cents = 0)
    or
    (source_type = 'dancer_profile' and dancer_id is not null and dancer_share_bps > 0)
  )
);

create index if not exists deal_revenue_events_venue_status_idx
  on public.deal_revenue_events(venue_id, status, confirmed_at desc);

create index if not exists deal_revenue_events_dancer_month_idx
  on public.deal_revenue_events(dancer_id, commission_month, confirmed_at)
  where dancer_id is not null;

create unique index if not exists deal_revenue_events_dancer_success_number_idx
  on public.deal_revenue_events(dancer_id, commission_month, successful_redemption_number)
  where dancer_id is not null and status not in ('refunded', 'voided');

alter table public.commission_events
  add column if not exists gross_commission_cents integer not null default 0
    check (gross_commission_cents >= 0),
  add column if not exists dancer_share_bps integer not null default 0
    check (dancer_share_bps between 0 and 10000),
  add column if not exists platform_amount_cents integer not null default 0
    check (platform_amount_cents >= 0),
  add column if not exists successful_redemption_number integer,
  add column if not exists commission_month date,
  add column if not exists currency text not null default 'usd'
    check (currency ~ '^[a-z]{3}$'),
  add column if not exists policy_version text not null default 'monthly-tier-v1';

alter table public.qr_redemption_events enable row level security;
alter table public.deal_revenue_events enable row level security;

drop policy if exists "Admins manage QR redemption events" on public.qr_redemption_events;
create policy "Admins manage QR redemption events"
  on public.qr_redemption_events
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Venue owners read own QR redemption events" on public.qr_redemption_events;
create policy "Venue owners read own QR redemption events"
  on public.qr_redemption_events
  for select
  using (
    exists (
      select 1
      from public.qr_redemptions redemption
      join public.venues venue on venue.id = redemption.venue_id
      where redemption.id = qr_redemption_id
        and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Dancers read own QR redemption events" on public.qr_redemption_events;
create policy "Dancers read own QR redemption events"
  on public.qr_redemption_events
  for select
  using (
    exists (
      select 1
      from public.qr_redemptions redemption
      join public.dancer_profiles dancer on dancer.id = redemption.dancer_id
      where redemption.id = qr_redemption_id
        and dancer.user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage deal revenue events" on public.deal_revenue_events;
create policy "Admins manage deal revenue events"
  on public.deal_revenue_events
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Venue owners read own deal revenue events" on public.deal_revenue_events;
create policy "Venue owners read own deal revenue events"
  on public.deal_revenue_events
  for select
  using (
    exists (
      select 1
      from public.venues venue
      where venue.id = venue_id
        and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Dancers read own deal revenue events" on public.deal_revenue_events;
create policy "Dancers read own deal revenue events"
  on public.deal_revenue_events
  for select
  using (
    dancer_id in (
      select id from public.dancer_profiles where user_id = auth.uid()
    )
  );

drop policy if exists "Venue owners read own commission events" on public.commission_events;
create policy "Venue owners read own commission events"
  on public.commission_events
  for select
  using (
    exists (
      select 1
      from public.venues venue
      where venue.id = venue_id
        and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Venue owners read own QR redemptions" on public.qr_redemptions;
create policy "Venue owners read own QR redemptions"
  on public.qr_redemptions
  for select
  using (
    exists (
      select 1
      from public.venues venue
      where venue.id = venue_id
        and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Venue owners manage own club deals" on public.club_deals;
create policy "Venue owners manage own club deals"
  on public.club_deals
  for all
  using (
    exists (
      select 1
      from public.venues venue
      where venue.id = venue_id
        and venue.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.venues venue
      where venue.id = venue_id
        and venue.owner_user_id = auth.uid()
    )
  );

create or replace function public.log_qr_redemption_issued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.qr_redemption_events (
    qr_redemption_id,
    event_type,
    actor_user_id,
    session_id,
    ip_address,
    user_agent,
    audit
  )
  values (
    new.id,
    'issued',
    new.customer_id,
    new.session_id,
    new.ip_address,
    new.user_agent,
    jsonb_build_object(
      'source_type', new.source_type,
      'dancer_id', new.dancer_id,
      'shift_id', new.shift_id
    )
  );
  return new;
end;
$$;

drop trigger if exists qr_redemptions_log_issued on public.qr_redemptions;
create trigger qr_redemptions_log_issued
  after insert on public.qr_redemptions
  for each row
  execute function public.log_qr_redemption_issued();

create or replace function public.confirm_deal_redemption(
  p_token text,
  p_audit jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_redemption public.qr_redemptions%rowtype;
  v_deal public.club_deals%rowtype;
  v_venue public.venues%rowtype;
  v_month date;
  v_success_number integer;
  v_share_bps integer := 0;
  v_gross_cents integer := 0;
  v_dancer_cents integer := 0;
  v_platform_cents integer := 0;
  v_revenue_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Active venue account required.';
  end if;

  select redemption.*
    into v_redemption
  from public.qr_redemptions redemption
  where redemption.redemption_token = p_token
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'QR code not found.';
  end if;

  select deal.*
    into v_deal
  from public.club_deals deal
  where deal.id = v_redemption.club_deal_id;

  select venue.*
    into v_venue
  from public.venues venue
  join public.app_users account on account.id = venue.owner_user_id
  where venue.id = v_redemption.venue_id
    and venue.owner_user_id = v_user_id
    and venue.is_active = true
    and account.role = 'venue'
    and account.account_state = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'This venue account cannot redeem that QR code.';
  end if;

  if not v_deal.is_active then
    raise exception using errcode = '22023', message = 'This deal is no longer active.';
  end if;

  if v_deal.venue_id <> v_redemption.venue_id then
    raise exception using errcode = '22023', message = 'This deal does not belong to the redemption venue.';
  end if;

  if v_redemption.status = 'redeemed' then
    raise exception using errcode = '23505', message = 'This QR code was already redeemed.';
  end if;

  if v_redemption.status in ('voided', 'expired') then
    raise exception using errcode = '22023', message = 'This QR code is no longer valid.';
  end if;

  if v_redemption.expires_at <= v_now then
    update public.qr_redemptions
    set status = 'expired'
    where id = v_redemption.id;

    insert into public.qr_redemption_events (
      qr_redemption_id,
      event_type,
      actor_user_id,
      audit
    )
    values (v_redemption.id, 'expired', v_user_id, p_audit);

    return jsonb_build_object(
      'ok', false,
      'status', 400,
      'error', 'This QR code has expired.'
    );
  end if;

  if v_deal.payout_type <> 'flat' or v_deal.payout_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'This venue has not configured a referral commission.';
  end if;

  if v_redemption.source_type = 'dancer_profile'
    and (v_redemption.dancer_id is null or v_redemption.shift_id is null) then
    raise exception using errcode = '22023', message = 'Dancer attribution is incomplete for this QR code.';
  end if;

  v_month := date_trunc(
    'month',
    timezone(coalesce(nullif(v_venue.timezone, ''), 'UTC'), v_now)
  )::date;
  v_gross_cents := v_deal.payout_amount_cents;

  if v_redemption.source_type = 'dancer_profile' then
    -- Different QR tokens for one dancer may be confirmed concurrently. Serialize
    -- the monthly counter so tier boundaries and successful redemption numbers
    -- remain exact under load.
    perform pg_advisory_xact_lock(
      hashtext(v_redemption.dancer_id::text),
      hashtext(v_month::text)
    );

    select count(*)::integer + 1
      into v_success_number
    from public.deal_revenue_events revenue
    where revenue.dancer_id = v_redemption.dancer_id
      and revenue.commission_month = v_month
      and revenue.status not in ('refunded', 'voided');

    v_share_bps := case
      when v_success_number >= 75 then 5000
      when v_success_number >= 25 then 4000
      else 3000
    end;
    v_dancer_cents := round(v_gross_cents * v_share_bps / 10000.0)::integer;
  else
    v_success_number := null;
    v_share_bps := 0;
    v_dancer_cents := 0;
  end if;

  v_platform_cents := v_gross_cents - v_dancer_cents;

  update public.qr_redemptions
  set
    status = 'redeemed',
    redeemed_at = v_now,
    confirmed_at = v_now,
    redeemed_by_club_user = v_user_id,
    first_scanned_at = coalesce(first_scanned_at, v_now),
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object('venue_confirmed', p_audit)
  where id = v_redemption.id;

  insert into public.qr_redemption_events (
    qr_redemption_id,
    event_type,
    actor_user_id,
    audit
  )
  values (v_redemption.id, 'venue_confirmed', v_user_id, p_audit);

  insert into public.deal_revenue_events (
    qr_redemption_id,
    venue_id,
    club_deal_id,
    dancer_id,
    source_type,
    currency,
    gross_commission_cents,
    dancer_share_bps,
    dancer_commission_cents,
    platform_commission_cents,
    successful_redemption_number,
    commission_month,
    policy_version,
    audit,
    confirmed_at
  )
  values (
    v_redemption.id,
    v_redemption.venue_id,
    v_redemption.club_deal_id,
    v_redemption.dancer_id,
    v_redemption.source_type,
    v_deal.currency,
    v_gross_cents,
    v_share_bps,
    v_dancer_cents,
    v_platform_cents,
    v_success_number,
    v_month,
    'monthly-tier-v1',
    jsonb_build_object(
      'source', 'authenticated_venue_confirmation',
      'venue_user_id', v_user_id,
      'shift_id', v_redemption.shift_id
    ),
    v_now
  )
  returning id into v_revenue_id;

  if v_redemption.source_type = 'dancer_profile' then
    insert into public.commission_events (
      qr_redemption_id,
      venue_id,
      club_deal_id,
      dancer_id,
      status,
      amount_cents,
      payout_type,
      gross_commission_cents,
      dancer_share_bps,
      platform_amount_cents,
      successful_redemption_number,
      commission_month,
      currency,
      policy_version,
      audit
    )
    values (
      v_redemption.id,
      v_redemption.venue_id,
      v_redemption.club_deal_id,
      v_redemption.dancer_id,
      'pending_club_payment',
      v_dancer_cents,
      'flat',
      v_gross_cents,
      v_share_bps,
      v_platform_cents,
      v_success_number,
      v_month,
      v_deal.currency,
      'monthly-tier-v1',
      jsonb_build_object(
        'source', 'deal_revenue_event',
        'deal_revenue_event_id', v_revenue_id,
        'venue_user_id', v_user_id
      )
    );
  end if;

  return jsonb_build_object(
    'redemption_id', v_redemption.id,
    'revenue_event_id', v_revenue_id,
    'source_type', v_redemption.source_type,
    'gross_commission_cents', v_gross_cents,
    'dancer_share_bps', v_share_bps,
    'dancer_commission_cents', v_dancer_cents,
    'platform_commission_cents', v_platform_cents,
    'successful_redemption_number', v_success_number,
    'commission_month', v_month,
    'status', 'redeemed'
  );
end;
$$;

create or replace function public.settle_deal_revenue_event(
  p_revenue_event_id uuid,
  p_action text,
  p_external_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_event public.deal_revenue_events%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;

  if length(trim(coalesce(p_external_reference, ''))) < 3
    or length(trim(p_external_reference)) > 180 then
    raise exception using errcode = '22023', message = 'A valid external payment reference is required.';
  end if;

  select revenue.*
    into v_event
  from public.deal_revenue_events revenue
  where revenue.id = p_revenue_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Revenue event not found.';
  end if;

  if p_action = 'venue_payment_received' then
    if v_event.status <> 'pending_venue_payment' then
      raise exception using errcode = '22023', message = 'Venue payment cannot be recorded from the current status.';
    end if;

    update public.deal_revenue_events
    set
      status = case when dancer_commission_cents > 0 then 'payable' else 'settled' end,
      venue_payment_reference = trim(p_external_reference),
      venue_payment_received_at = v_now
    where id = v_event.id;

    update public.commission_events
    set
      status = 'payable',
      club_payment_received_at = v_now,
      payable_at = v_now,
      audit = audit || jsonb_build_object('venue_payment_reference', trim(p_external_reference))
    where qr_redemption_id = v_event.qr_redemption_id
      and status = 'pending_club_payment';
  elsif p_action = 'dancer_paid' then
    if v_event.status <> 'payable' or v_event.dancer_commission_cents <= 0 then
      raise exception using errcode = '22023', message = 'Dancer payout cannot be recorded from the current status.';
    end if;

    update public.deal_revenue_events
    set
      status = 'settled',
      dancer_payout_reference = trim(p_external_reference),
      dancer_paid_at = v_now
    where id = v_event.id;

    update public.commission_events
    set
      status = 'paid',
      paid_at = v_now,
      audit = audit || jsonb_build_object('dancer_payout_reference', trim(p_external_reference))
    where qr_redemption_id = v_event.qr_redemption_id
      and status = 'payable';
  else
    raise exception using errcode = '22023', message = 'Unsupported settlement action.';
  end if;

  return (
    select jsonb_build_object(
      'id', revenue.id,
      'status', revenue.status,
      'venue_payment_reference', revenue.venue_payment_reference,
      'dancer_payout_reference', revenue.dancer_payout_reference
    )
    from public.deal_revenue_events revenue
    where revenue.id = v_event.id
  );
end;
$$;

create or replace function public.void_generated_deal_redemption(
  p_redemption_id uuid,
  p_reason text default 'admin_marked_suspicious'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_redemption public.qr_redemptions%rowtype;
begin
  if v_user_id is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3
    or length(trim(p_reason)) > 180 then
    raise exception using errcode = '22023', message = 'A valid void reason is required.';
  end if;

  select redemption.*
    into v_redemption
  from public.qr_redemptions redemption
  where redemption.id = p_redemption_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Redemption not found.';
  end if;

  if v_redemption.status <> 'generated' then
    raise exception using
      errcode = '22023',
      message = 'Only an unused generated QR can be voided. Financial reversals require a separate refund record.';
  end if;

  update public.qr_redemptions
  set
    status = 'voided',
    suspicious = true,
    voided_at = v_now,
    voided_by_admin = v_user_id,
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
      'voided_by_admin', v_user_id,
      'void_reason', trim(p_reason)
    )
  where id = v_redemption.id;

  insert into public.qr_redemption_events (
    qr_redemption_id,
    event_type,
    actor_user_id,
    audit
  )
  values (
    v_redemption.id,
    'voided',
    v_user_id,
    jsonb_build_object('reason', trim(p_reason))
  );

  return jsonb_build_object(
    'id', v_redemption.id,
    'status', 'voided',
    'suspicious', true
  );
end;
$$;

revoke all on function public.confirm_deal_redemption(text, jsonb) from public;
grant execute on function public.confirm_deal_redemption(text, jsonb) to authenticated;

revoke all on function public.settle_deal_revenue_event(uuid, text, text) from public;
grant execute on function public.settle_deal_revenue_event(uuid, text, text) to authenticated;

revoke all on function public.void_generated_deal_redemption(uuid, text) from public;
grant execute on function public.void_generated_deal_redemption(uuid, text) to authenticated;

create or replace function public.create_venue_default_club_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.club_deals (
    venue_id,
    deal_title,
    deal_description,
    deal_terms,
    is_active,
    redemption_rules,
    payout_type,
    payout_amount_cents,
    currency
  )
  values (
    new.id,
    'Tonight''s venue offer',
    'Show your unique MyDancr QR to venue staff for the active offer.',
    'Offer is subject to venue availability and house rules.',
    false,
    jsonb_build_object(
      'one_per_guest', true,
      'authenticated_venue_confirmation_required', true,
      'attribution_policy', 'locked_at_issue',
      'commission_policy', 'monthly-tier-v1'
    ),
    'flat',
    0,
    'usd'
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists venues_create_default_club_deal on public.venues;
create trigger venues_create_default_club_deal
  after insert on public.venues
  for each row
  execute function public.create_venue_default_club_deal();

-- A zero-dollar seeded deal is not a valid revenue offer. Venue owners activate it
-- after agreeing to a real referral commission in their dashboard.
update public.club_deals
set
  is_active = false,
  payout_type = 'flat',
  updated_at = now()
where payout_amount_cents <= 0;
