-- Audited venue-sales commissions and NATS settlement for MyDancr agents.
-- Clubs remain receivables only. Dancers and agents are the only NATS payees.

begin;

create table if not exists public.sales_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.app_users(id) on delete restrict,
  sponsor_agent_id uuid references public.sales_agents(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'terminated')),
  commission_depth_limit smallint not null default 3
    check (commission_depth_limit in (3, 5)),
  created_by_admin_user_id uuid not null references public.app_users(id) on delete restrict,
  updated_by_admin_user_id uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sponsor_agent_id is null or sponsor_agent_id <> id)
);

alter table public.financial_audit_events
  drop constraint if exists financial_audit_events_actor_type_check;
alter table public.financial_audit_events
  add constraint financial_audit_events_actor_type_check
  check (actor_type in ('system', 'admin', 'dancer', 'agent', 'provider'));

create unique index if not exists sales_agents_single_active_founder_idx
  on public.sales_agents ((commission_depth_limit))
  where commission_depth_limit = 5 and status = 'active';
create index if not exists sales_agents_sponsor_idx
  on public.sales_agents(sponsor_agent_id) where sponsor_agent_id is not null;

create or replace function public.validate_sales_agent_hierarchy()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_cycle boolean := false;
begin
  if new.sponsor_agent_id is not null then
    if new.sponsor_agent_id = new.id then
      raise exception using errcode = '22023', message = 'An agent cannot sponsor their own account.';
    end if;
    if not exists (
      select 1 from public.sales_agents sponsor
      where sponsor.id = new.sponsor_agent_id and sponsor.status = 'active'
    ) then
      raise exception using errcode = '22023', message = 'The selected sponsor must be an active sales agent.';
    end if;
    with recursive sponsors as (
      select agent.id, agent.sponsor_agent_id
      from public.sales_agents agent where agent.id = new.sponsor_agent_id
      union
      select parent.id, parent.sponsor_agent_id
      from public.sales_agents parent join sponsors on parent.id = sponsors.sponsor_agent_id
    )
    select exists(select 1 from sponsors where id = new.id) into v_cycle;
    if v_cycle then
      raise exception using errcode = '22023', message = 'This sponsor would create an invalid circular agent hierarchy.';
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists validate_sales_agent_hierarchy_trigger on public.sales_agents;
create trigger validate_sales_agent_hierarchy_trigger
  before insert or update of sponsor_agent_id, status, commission_depth_limit
  on public.sales_agents for each row execute function public.validate_sales_agent_hierarchy();

create table if not exists public.venue_sales_attributions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  signing_agent_id uuid not null references public.sales_agents(id) on delete restrict,
  sponsor_level_1_agent_id uuid references public.sales_agents(id) on delete restrict,
  sponsor_level_2_agent_id uuid references public.sales_agents(id) on delete restrict,
  sponsor_level_3_agent_id uuid references public.sales_agents(id) on delete restrict,
  sponsor_level_4_agent_id uuid references public.sales_agents(id) on delete restrict,
  sponsor_level_5_agent_id uuid references public.sales_agents(id) on delete restrict,
  agreement_reference text not null check (char_length(trim(agreement_reference)) between 3 and 180),
  effective_from timestamptz not null default now(),
  superseded_at timestamptz,
  created_by_admin_user_id uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (superseded_at is null or superseded_at > effective_from)
);

create unique index if not exists venue_sales_attributions_one_active_idx
  on public.venue_sales_attributions(venue_id) where superseded_at is null;
create index if not exists venue_sales_attributions_signer_idx
  on public.venue_sales_attributions(signing_agent_id, effective_from desc);

alter table public.deal_revenue_events
  add column if not exists agent_commission_cents integer not null default 0
    check (agent_commission_cents >= 0),
  add column if not exists venue_sales_attribution_id uuid
    references public.venue_sales_attributions(id) on delete set null;

do $$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.deal_revenue_events'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) ilike '%dancer_commission_cents%'
      and pg_get_constraintdef(constraint_row.oid) ilike '%platform_commission_cents%'
      and pg_get_constraintdef(constraint_row.oid) not ilike '%agent_commission_cents%'
  loop
    execute format('alter table public.deal_revenue_events drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;

alter table public.deal_revenue_events
  drop constraint if exists deal_revenue_events_commission_balance_check;
alter table public.deal_revenue_events
  add constraint deal_revenue_events_commission_balance_check check (
    dancer_commission_cents + agent_commission_cents + platform_commission_cents
      = gross_commission_cents
  );

create table if not exists public.agent_commission_events (
  id uuid primary key default gen_random_uuid(),
  deal_revenue_event_id uuid not null references public.deal_revenue_events(id) on delete restrict,
  qr_redemption_id uuid not null references public.qr_redemptions(id) on delete restrict,
  venue_id uuid not null references public.venues(id) on delete restrict,
  venue_sales_attribution_id uuid not null references public.venue_sales_attributions(id) on delete restrict,
  recipient_agent_id uuid not null references public.sales_agents(id) on delete restrict,
  signing_agent_id uuid not null references public.sales_agents(id) on delete restrict,
  sponsor_level smallint not null check (sponsor_level between 0 and 5),
  share_bps integer not null check (share_bps in (100, 150, 200, 250, 300, 1500)),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'pending_venue_payment'
    check (status in ('pending_venue_payment', 'payable', 'paid', 'voided')),
  commission_month date not null,
  venue_payment_received_at timestamptz,
  payable_at timestamptz,
  paid_at timestamptz,
  payout_reference text,
  voided_at timestamptz,
  audit jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (deal_revenue_event_id, sponsor_level),
  check (
    (sponsor_level = 0 and share_bps = 1500 and recipient_agent_id = signing_agent_id)
    or (sponsor_level = 1 and share_bps = 300)
    or (sponsor_level = 2 and share_bps = 250)
    or (sponsor_level = 3 and share_bps = 200)
    or (sponsor_level = 4 and share_bps = 150)
    or (sponsor_level = 5 and share_bps = 100)
  )
);

create index if not exists agent_commission_events_recipient_status_idx
  on public.agent_commission_events(recipient_agent_id, status, created_at desc);
create index if not exists agent_commission_events_venue_idx
  on public.agent_commission_events(venue_id, created_at desc);

create table if not exists public.nats_agent_affiliate_accounts (
  agent_id uuid primary key references public.sales_agents(id) on delete restrict,
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
  constraint nats_agent_affiliate_accounts_activation_check check (
    (status = 'active' and activated_at is not null and verified_by is not null)
    or status <> 'active'
  )
);

create or replace function public.enforce_unique_nats_affiliate_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('nats-login'), hashtext(new.login_id::text));
  if tg_table_name = 'nats_agent_affiliate_accounts' and exists (
    select 1 from public.nats_affiliate_accounts dancer where dancer.login_id = new.login_id
  ) then
    raise exception using errcode = '23505', message = 'That NATS affiliate login is already linked to a dancer.';
  end if;
  if tg_table_name = 'nats_affiliate_accounts' and exists (
    select 1 from public.nats_agent_affiliate_accounts agent where agent.login_id = new.login_id
  ) then
    raise exception using errcode = '23505', message = 'That NATS affiliate login is already linked to an agent.';
  end if;
  return new;
end;
$$;

drop trigger if exists nats_agent_affiliate_login_unique on public.nats_agent_affiliate_accounts;
create trigger nats_agent_affiliate_login_unique
  before insert or update of login_id on public.nats_agent_affiliate_accounts
  for each row execute function public.enforce_unique_nats_affiliate_login();
drop trigger if exists nats_dancer_affiliate_login_unique on public.nats_affiliate_accounts;
create trigger nats_dancer_affiliate_login_unique
  before insert or update of login_id on public.nats_affiliate_accounts
  for each row execute function public.enforce_unique_nats_affiliate_login();

create table if not exists public.nats_agent_commission_exports (
  id uuid primary key default gen_random_uuid(),
  agent_commission_event_id uuid not null unique references public.agent_commission_events(id) on delete restrict,
  agent_id uuid not null references public.sales_agents(id) on delete restrict,
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

create index if not exists nats_agent_commission_exports_status_created_idx
  on public.nats_agent_commission_exports(status, created_at);
create index if not exists nats_agent_commission_exports_agent_created_idx
  on public.nats_agent_commission_exports(agent_id, created_at desc);

create or replace function public.agent_allocations_for_venue(
  p_venue_id uuid, p_gross_cents integer, p_at timestamptz default now()
)
returns table (
  venue_sales_attribution_id uuid, signing_agent_id uuid, recipient_agent_id uuid,
  sponsor_level smallint, share_bps integer, amount_cents integer
)
language sql stable security definer set search_path = public, pg_temp as $$
  with attribution as (
    select * from public.venue_sales_attributions attribution
    where attribution.venue_id = p_venue_id
      and attribution.effective_from <= p_at
      and (attribution.superseded_at is null or attribution.superseded_at > p_at)
    order by attribution.effective_from desc limit 1
  ), candidates as (
    select attribution.id, attribution.signing_agent_id, levels.recipient_agent_id,
      levels.sponsor_level, levels.share_bps
    from attribution cross join lateral (
      values
        (attribution.signing_agent_id, 0::smallint, 1500),
        (attribution.sponsor_level_1_agent_id, 1::smallint, 300),
        (attribution.sponsor_level_2_agent_id, 2::smallint, 250),
        (attribution.sponsor_level_3_agent_id, 3::smallint, 200),
        (attribution.sponsor_level_4_agent_id, 4::smallint, 150),
        (attribution.sponsor_level_5_agent_id, 5::smallint, 100)
    ) levels(recipient_agent_id, sponsor_level, share_bps)
    where levels.recipient_agent_id is not null
  )
  select candidates.id, candidates.signing_agent_id, candidates.recipient_agent_id,
    candidates.sponsor_level, candidates.share_bps,
    round(greatest(p_gross_cents, 0) * candidates.share_bps / 10000.0)::integer
  from candidates
  join public.sales_agents recipient on recipient.id = candidates.recipient_agent_id
  where recipient.status = 'active'
    and (candidates.sponsor_level <= 3 or recipient.commission_depth_limit = 5)
    and round(greatest(p_gross_cents, 0) * candidates.share_bps / 10000.0)::integer > 0;
$$;

revoke all on function public.agent_allocations_for_venue(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.agent_allocations_for_venue(uuid, integer, timestamptz) to service_role;

create or replace function public.set_admin_sales_agent(
  p_admin_id uuid, p_user_id uuid, p_sponsor_agent_id uuid,
  p_commission_depth_limit smallint, p_status text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_agent_id uuid; v_account public.app_users%rowtype;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_id and account.role = 'admin' and account.account_state = 'active'
  ) then raise exception using errcode = '42501', message = 'Admin access required.'; end if;
  select * into v_account from public.app_users where id = p_user_id for update;
  if not found or v_account.account_state <> 'active' then
    raise exception using errcode = '22023', message = 'Select an active account for this sales agent.';
  end if;
  if p_commission_depth_limit not in (3, 5) then
    raise exception using errcode = '22023', message = 'Agent depth must be three or five levels.';
  end if;
  if p_status not in ('active', 'suspended', 'terminated') then
    raise exception using errcode = '22023', message = 'Agent status is invalid.';
  end if;
  insert into public.sales_agents (
    user_id, sponsor_agent_id, status, commission_depth_limit,
    created_by_admin_user_id, updated_by_admin_user_id
  ) values (
    p_user_id, p_sponsor_agent_id, p_status, p_commission_depth_limit,
    p_admin_id, p_admin_id
  ) on conflict (user_id) do update set
    sponsor_agent_id = excluded.sponsor_agent_id,
    status = excluded.status,
    commission_depth_limit = excluded.commission_depth_limit,
    updated_by_admin_user_id = p_admin_id,
    updated_at = clock_timestamp()
  returning id into v_agent_id;
  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_id, 'sales_agent', v_agent_id, 'set_sales_agent',
    coalesce(v_account.display_name, v_account.email, p_user_id::text) || ': ' || p_status);
  return v_agent_id;
end;
$$;

revoke all on function public.set_admin_sales_agent(uuid, uuid, uuid, smallint, text) from public, anon, authenticated;
grant execute on function public.set_admin_sales_agent(uuid, uuid, uuid, smallint, text) to service_role;

create or replace function public.assign_admin_venue_sales_agent(
  p_admin_id uuid, p_venue_id uuid, p_signing_agent_id uuid,
  p_agreement_reference text, p_effective_from timestamptz default now()
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attribution_id uuid; v_signer public.sales_agents%rowtype;
  v_level_1 uuid; v_level_2 uuid; v_level_3 uuid; v_level_4 uuid; v_level_5 uuid;
  v_existing_effective_from timestamptz;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_id and account.role = 'admin' and account.account_state = 'active'
  ) then raise exception using errcode = '42501', message = 'Admin access required.'; end if;
  if not exists (select 1 from public.venues where id = p_venue_id and is_active = true) then
    raise exception using errcode = '22023', message = 'Select an active venue.';
  end if;
  select * into v_signer from public.sales_agents where id = p_signing_agent_id for update;
  if not found or v_signer.status <> 'active' then
    raise exception using errcode = '22023', message = 'Select an active signing agent.';
  end if;
  if char_length(trim(coalesce(p_agreement_reference, ''))) not between 3 and 180 then
    raise exception using errcode = '22023', message = 'A signed venue agreement reference is required.';
  end if;
  if p_effective_from is null then
    raise exception using errcode = '22023', message = 'An attribution effective time is required.';
  end if;
  select attribution.effective_from into v_existing_effective_from
  from public.venue_sales_attributions attribution
  where attribution.venue_id = p_venue_id and attribution.superseded_at is null
  for update;
  if v_existing_effective_from is not null and p_effective_from <= v_existing_effective_from then
    raise exception using errcode = '22023',
      message = 'The replacement attribution must begin after the current attribution.';
  end if;
  v_level_1 := v_signer.sponsor_agent_id;
  select sponsor_agent_id into v_level_2 from public.sales_agents where id = v_level_1;
  select sponsor_agent_id into v_level_3 from public.sales_agents where id = v_level_2;
  select sponsor_agent_id into v_level_4 from public.sales_agents where id = v_level_3;
  select sponsor_agent_id into v_level_5 from public.sales_agents where id = v_level_4;
  update public.venue_sales_attributions set superseded_at = p_effective_from
  where venue_id = p_venue_id and superseded_at is null;
  insert into public.venue_sales_attributions (
    venue_id, signing_agent_id, sponsor_level_1_agent_id, sponsor_level_2_agent_id,
    sponsor_level_3_agent_id, sponsor_level_4_agent_id, sponsor_level_5_agent_id,
    agreement_reference, effective_from, created_by_admin_user_id
  ) values (
    p_venue_id, p_signing_agent_id, v_level_1, v_level_2, v_level_3, v_level_4, v_level_5,
    trim(p_agreement_reference), p_effective_from, p_admin_id
  ) returning id into v_attribution_id;
  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_id, 'venue_sales_attribution', v_attribution_id,
    'assign_venue_signing_agent', trim(p_agreement_reference));
  return v_attribution_id;
end;
$$;

revoke all on function public.assign_admin_venue_sales_agent(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.assign_admin_venue_sales_agent(uuid, uuid, uuid, text, timestamptz) to service_role;

create or replace function public.enqueue_nats_agent_commission_export()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_account_active boolean;
begin
  if new.status <> 'payable' or new.amount_cents <= 0 or lower(new.currency) <> 'usd' then
    return new;
  end if;
  select exists (
    select 1 from public.nats_agent_affiliate_accounts account
    where account.agent_id = new.recipient_agent_id and account.status = 'active'
  ) into v_account_active;
  insert into public.nats_agent_commission_exports (
    agent_commission_event_id, agent_id, amount_cents, currency, status
  ) values (
    new.id, new.recipient_agent_id, new.amount_cents, lower(new.currency),
    case when v_account_active then 'pending' else 'waiting_for_affiliate' end
  ) on conflict (agent_commission_event_id) do nothing;
  return new;
end;
$$;

drop trigger if exists agent_commission_events_enqueue_nats_export on public.agent_commission_events;
create trigger agent_commission_events_enqueue_nats_export
  after insert or update of status on public.agent_commission_events
  for each row execute function public.enqueue_nats_agent_commission_export();

insert into public.nats_agent_commission_exports (
  agent_commission_event_id, agent_id, amount_cents, currency, status
)
select earning.id, earning.recipient_agent_id, earning.amount_cents, lower(earning.currency),
  case when account.status = 'active' then 'pending' else 'waiting_for_affiliate' end
from public.agent_commission_events earning
left join public.nats_agent_affiliate_accounts account
  on account.agent_id = earning.recipient_agent_id
where earning.status = 'payable'
  and earning.amount_cents > 0
  and lower(earning.currency) = 'usd'
on conflict (agent_commission_event_id) do nothing;

create or replace function public.activate_waiting_nats_agent_exports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := clock_timestamp();
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.nats_agent_commission_exports export
    set status = 'pending', updated_at = clock_timestamp(), last_error = null, failed_at = null
    where export.agent_id = new.agent_id
      and export.status = 'waiting_for_affiliate'
      and exists (
        select 1 from public.agent_commission_events earning
        where earning.id = export.agent_commission_event_id and earning.status = 'payable'
      );
  elsif new.status = 'disabled' and old.status is distinct from 'disabled' then
    new.disabled_at := coalesce(new.disabled_at, clock_timestamp());
  end if;
  return new;
end;
$$;

drop trigger if exists nats_agent_affiliate_accounts_activate_exports on public.nats_agent_affiliate_accounts;
create trigger nats_agent_affiliate_accounts_activate_exports
  before update on public.nats_agent_affiliate_accounts
  for each row execute function public.activate_waiting_nats_agent_exports();

create or replace function public.claim_nats_agent_commission_exports(p_limit integer default 100)
returns table (
  export_id uuid,
  agent_commission_event_id uuid,
  agent_id uuid,
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
    raise exception using errcode = '22023', message = 'NATS agent export limit must be between 1 and 500.';
  end if;
  update public.nats_agent_commission_exports
  set status = 'reconciliation_required', failed_at = clock_timestamp(),
      last_error = 'The NATS export worker stopped with an unknown outcome. Verify the affiliate invoice in NATS before retrying.',
      updated_at = clock_timestamp()
  where status = 'processing'
    and processing_started_at < clock_timestamp() - interval '20 minutes';

  return query
  with candidates as (
    select export.id
    from public.nats_agent_commission_exports export
    join public.nats_agent_affiliate_accounts account
      on account.agent_id = export.agent_id and account.status = 'active'
    join public.agent_commission_events earning
      on earning.id = export.agent_commission_event_id
    where export.status = 'pending' and earning.status = 'payable'
    order by export.created_at, export.id
    for update of export skip locked
    limit p_limit
  ), claimed as (
    update public.nats_agent_commission_exports export
    set status = 'processing', processing_started_at = clock_timestamp(),
        attempt_count = export.attempt_count + 1, last_error = null,
        updated_at = clock_timestamp()
    where export.id in (select candidates.id from candidates)
    returning export.*
  )
  select claimed.id, claimed.agent_commission_event_id, claimed.agent_id,
    account.login_id, claimed.amount_cents, claimed.currency, claimed.attempt_count
  from claimed
  join public.nats_agent_affiliate_accounts account on account.agent_id = claimed.agent_id;
end;
$$;

create or replace function public.complete_nats_agent_commission_export(
  p_export_id uuid, p_nats_result text, p_response_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_event_id uuid;
begin
  update public.nats_agent_commission_exports
  set status = 'exported', exported_at = clock_timestamp(),
      nats_result = left(nullif(trim(coalesce(p_nats_result, '')), ''), 500),
      response_metadata = coalesce(p_response_metadata, '{}'::jsonb),
      updated_at = clock_timestamp()
  where id = p_export_id and status = 'processing'
  returning agent_commission_event_id into v_event_id;
  if v_event_id is not null then
    update public.agent_commission_events
    set status = 'paid', paid_at = clock_timestamp(),
        payout_reference = 'NATS:' || p_export_id::text,
        audit = audit || jsonb_build_object('nats_export_id', p_export_id)
    where id = v_event_id and status = 'payable';
    insert into public.financial_audit_events (
      actor_type, action, target_type, target_id, after_state, metadata
    ) values (
      'provider', 'nats_agent_commission_exported', 'agent_earning', v_event_id::text,
      jsonb_build_object('status', 'paid'),
      jsonb_build_object('commission_platform', 'nats', 'export_id', p_export_id)
    );
  end if;
  return v_event_id is not null;
end;
$$;

create or replace function public.fail_nats_agent_commission_export(
  p_export_id uuid, p_status text, p_error text,
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
    or char_length(trim(coalesce(p_error, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A valid NATS agent export failure is required.';
  end if;
  update public.nats_agent_commission_exports
  set status = p_status, failed_at = clock_timestamp(), last_error = left(trim(p_error), 500),
      response_metadata = coalesce(p_response_metadata, '{}'::jsonb), updated_at = clock_timestamp()
  where id = p_export_id and status = 'processing';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.flag_voided_nats_agent_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'voided' and new.status = 'voided' then
    update public.nats_agent_commission_exports
    set status = case when status = 'exported' then 'reconciliation_required' else 'canceled' end,
        last_error = case when status = 'exported'
          then 'The source agent earning was voided after export. Reconcile the matching manual invoice in NATS.'
          else 'The source agent earning was voided before NATS export.' end,
        failed_at = case when status = 'exported' then clock_timestamp() else failed_at end,
        updated_at = clock_timestamp()
    where agent_commission_event_id = new.id
      and status in ('waiting_for_affiliate', 'pending', 'failed', 'exported');
  end if;
  return new;
end;
$$;

drop trigger if exists agent_commission_events_reconcile_nats_void on public.agent_commission_events;
create trigger agent_commission_events_reconcile_nats_void
  after update of status on public.agent_commission_events
  for each row execute function public.flag_voided_nats_agent_commission();

drop trigger if exists agent_commission_events_no_delete on public.agent_commission_events;
create trigger agent_commission_events_no_delete
  before delete on public.agent_commission_events
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists nats_agent_affiliate_accounts_no_delete on public.nats_agent_affiliate_accounts;
create trigger nats_agent_affiliate_accounts_no_delete
  before delete on public.nats_agent_affiliate_accounts
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists nats_agent_commission_exports_no_delete on public.nats_agent_commission_exports;
create trigger nats_agent_commission_exports_no_delete
  before delete on public.nats_agent_commission_exports
  for each row execute function public.prohibit_financial_record_delete();

revoke all on function public.claim_nats_agent_commission_exports(integer) from public, anon, authenticated;
revoke all on function public.complete_nats_agent_commission_export(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_nats_agent_commission_export(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_nats_agent_commission_exports(integer) to service_role;
grant execute on function public.complete_nats_agent_commission_export(uuid, text, jsonb) to service_role;
grant execute on function public.fail_nats_agent_commission_export(uuid, text, text, jsonb) to service_role;

create or replace function public.confirm_deal_redemption_from_nfc(
  p_token text,
  p_tag_id uuid,
  p_session_id uuid,
  p_audit jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_redemption public.qr_redemptions;
  v_deal public.club_deals;
  v_venue public.venues;
  v_tag public.nfc_tags;
  v_referral_term public.venue_referral_fee_terms;
  v_month date;
  v_success_number integer;
  v_share_bps integer := 0;
  v_gross_cents integer := 0;
  v_dancer_cents integer := 0;
  v_agent_cents integer := 0;
  v_platform_cents integer := 0;
  v_revenue_id uuid;
  v_attribution_id uuid;
  v_policy_version constant text := 'dancer-profile-monthly-30-40-50+sales-agent-v1';
begin
  select * into v_tag from public.nfc_tags where id = p_tag_id for update;
  if not found or v_tag.status <> 'active' or v_tag.tag_type <> 'cashier' then
    raise exception using errcode = '42501', message = 'This cashier NFC tag is inactive.';
  end if;

  select redemption.* into v_redemption
  from public.qr_redemptions redemption
  where redemption.redemption_token = p_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Club Deal redemption not found.';
  end if;

  select * into v_deal from public.club_deals where id = v_redemption.club_deal_id;
  select venue.* into v_venue
  from public.venues venue
  join public.app_users account on account.id = venue.owner_user_id
  where venue.id = v_tag.venue_id and venue.is_active = true
    and account.role = 'venue' and account.account_state = 'active';
  if not found or v_redemption.venue_id <> v_tag.venue_id then
    raise exception using errcode = '42501', message = 'This Club Deal belongs to a different venue.';
  end if;
  if not v_deal.is_active or v_deal.venue_id <> v_tag.venue_id then
    raise exception using errcode = '22023', message = 'This Club Deal is no longer active.';
  end if;
  if v_redemption.status = 'redeemed' then
    raise exception using errcode = '23505', message = 'This Club Deal was already redeemed.';
  end if;
  if v_redemption.status in ('voided', 'expired') or v_redemption.expires_at <= v_now then
    update public.qr_redemptions set status = 'expired'
    where id = v_redemption.id and status = 'generated';
    raise exception using errcode = '22023', message = 'This Club Deal is no longer valid.';
  end if;

  select term.* into v_referral_term
  from public.venue_referral_fee_terms term
  where term.venue_id = v_redemption.venue_id
    and term.superseded_at is null
    and term.effective_from <= v_now
    and (term.effective_until is null or term.effective_until > v_now)
  order by term.effective_from desc limit 1;
  if not found then
    raise exception using errcode = '22023', message = 'This venue does not have an active MyDancr referral fee agreement.';
  end if;

  if v_redemption.source_type = 'dancer_profile'
    and (v_redemption.dancer_id is null or v_redemption.shift_id is null) then
    raise exception using errcode = '22023', message = 'Dancer attribution is incomplete for this Club Deal.';
  end if;
  if exists (
    select 1 from public.qr_redemptions previous
    where previous.id <> v_redemption.id
      and previous.club_deal_id = v_redemption.club_deal_id
      and previous.venue_id = v_redemption.venue_id
      and previous.status = 'redeemed'
      and previous.redeemed_at >= v_now - interval '24 hours'
      and (
        (v_redemption.customer_id is not null and previous.customer_id = v_redemption.customer_id)
        or (v_redemption.customer_id is null and v_redemption.session_id is not null
          and previous.session_id = v_redemption.session_id)
      )
  ) then
    raise exception using errcode = '23505', message = 'This Club Deal has already been used in the last 24 hours.';
  end if;

  v_month := date_trunc('month', timezone(coalesce(nullif(v_venue.timezone, ''), 'UTC'), v_now))::date;
  v_gross_cents := v_referral_term.fee_cents;
  if v_redemption.source_type = 'dancer_profile' then
    perform pg_advisory_xact_lock(hashtext(v_redemption.dancer_id::text), hashtext(v_month::text));
    select count(*)::integer + 1 into v_success_number
    from public.deal_revenue_events revenue
    where revenue.dancer_id = v_redemption.dancer_id
      and revenue.commission_month = v_month
      and revenue.status not in ('refunded', 'voided');
    v_share_bps := case
      when v_success_number >= 25 then 5000
      when v_success_number >= 10 then 4000
      else 3000
    end;
    v_dancer_cents := round(v_gross_cents * v_share_bps / 10000.0)::integer;
  else
    v_success_number := null;
  end if;

  select coalesce(sum(allocation.amount_cents), 0)::integer into v_agent_cents
  from public.agent_allocations_for_venue(v_redemption.venue_id, v_gross_cents, v_now) allocation;
  select attribution.id into v_attribution_id
  from public.venue_sales_attributions attribution
  where attribution.venue_id = v_redemption.venue_id
    and attribution.effective_from <= v_now
    and (attribution.superseded_at is null or attribution.superseded_at > v_now)
  order by attribution.effective_from desc limit 1;

  v_platform_cents := v_gross_cents - v_dancer_cents - v_agent_cents;
  if v_platform_cents < 0 then
    raise exception using errcode = '22023', message = 'Commission allocations exceed the venue referral fee.';
  end if;

  update public.qr_redemptions set
    status = 'redeemed', redeemed_at = v_now, confirmed_at = v_now,
    first_scanned_at = coalesce(first_scanned_at, v_now), nfc_tag_id = v_tag.id,
    audit = coalesce(audit, '{}'::jsonb)
      || jsonb_build_object('nfc_confirmed', p_audit, 'nfc_tag_id', v_tag.id)
  where id = v_redemption.id;

  insert into public.qr_redemption_events (qr_redemption_id, event_type, session_id, audit)
  values (v_redemption.id, 'venue_confirmed', p_session_id::text,
    p_audit || jsonb_build_object('method', 'nfc', 'tagId', v_tag.id));

  insert into public.deal_revenue_events (
    qr_redemption_id, venue_id, club_deal_id, dancer_id, source_type, currency,
    gross_commission_cents, dancer_share_bps, dancer_commission_cents,
    agent_commission_cents, platform_commission_cents, venue_sales_attribution_id,
    successful_redemption_number, commission_month, policy_version, audit, confirmed_at
  ) values (
    v_redemption.id, v_redemption.venue_id, v_redemption.club_deal_id,
    v_redemption.dancer_id, v_redemption.source_type, v_referral_term.currency,
    v_gross_cents, v_share_bps, v_dancer_cents,
    v_agent_cents, v_platform_cents, v_attribution_id,
    v_success_number, v_month, v_policy_version,
    jsonb_build_object(
      'source', 'cashier_nfc_tap', 'nfc_tag_id', v_tag.id,
      'shift_id', v_redemption.shift_id,
      'referral_fee_term_id', v_referral_term.id,
      'agreement_reference', v_referral_term.agreement_reference,
      'sales_agent_policy', 'direct-15_l1-3_l2-2.5_l3-2_l4-1.5_l5-1'
    ), v_now
  ) returning id into v_revenue_id;

  insert into public.agent_commission_events (
    deal_revenue_event_id, qr_redemption_id, venue_id, venue_sales_attribution_id,
    recipient_agent_id, signing_agent_id, sponsor_level, share_bps,
    amount_cents, currency, commission_month, audit
  )
  select v_revenue_id, v_redemption.id, v_redemption.venue_id,
    allocation.venue_sales_attribution_id, allocation.recipient_agent_id,
    allocation.signing_agent_id, allocation.sponsor_level, allocation.share_bps,
    allocation.amount_cents, lower(v_referral_term.currency), v_month,
    jsonb_build_object('source', 'verified_cashier_nfc', 'nfc_tag_id', v_tag.id)
  from public.agent_allocations_for_venue(v_redemption.venue_id, v_gross_cents, v_now) allocation;

  if v_redemption.source_type = 'dancer_profile' then
    insert into public.commission_events (
      qr_redemption_id, venue_id, club_deal_id, dancer_id, status, amount_cents,
      payout_type, gross_commission_cents, dancer_share_bps, platform_amount_cents,
      successful_redemption_number, commission_month, currency, policy_version, audit
    ) values (
      v_redemption.id, v_redemption.venue_id, v_redemption.club_deal_id,
      v_redemption.dancer_id, 'pending_club_payment', v_dancer_cents, 'flat',
      v_gross_cents, v_share_bps, v_platform_cents, v_success_number, v_month,
      lower(v_referral_term.currency), v_policy_version,
      jsonb_build_object(
        'source', 'deal_revenue_event', 'deal_revenue_event_id', v_revenue_id,
        'nfc_tag_id', v_tag.id, 'referral_fee_term_id', v_referral_term.id,
        'agent_commission_cents', v_agent_cents
      )
    );
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_tag.venue_id, v_tag.tag_type, 'deal_redeemed', v_redemption.customer_id,
    p_session_id, p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object('redemptionId', v_redemption.id,
      'dealId', v_deal.id, 'revenueEventId', v_revenue_id)
  );
  update public.nfc_tags
  set last_tapped_at = v_now, tap_count = tap_count + 1, updated_at = v_now
  where id = v_tag.id;

  return jsonb_build_object(
    'redemptionId', v_redemption.id, 'revenueEventId', v_revenue_id,
    'dealTitle', v_deal.deal_title, 'venueName', v_venue.name,
    'sourceType', v_redemption.source_type,
    'grossCommissionCents', v_gross_cents,
    'dancerShareBps', v_share_bps,
    'dancerCommissionCents', v_dancer_cents,
    'agentCommissionCents', v_agent_cents,
    'platformCommissionCents', v_platform_cents,
    'successfulRedemptionNumber', v_success_number,
    'referralFeeTermId', v_referral_term.id, 'status', 'redeemed'
  );
end;
$$;

comment on function public.confirm_deal_redemption_from_nfc(text, uuid, uuid, jsonb) is
  'Atomically confirms cashier NFC revenue and snapshots dancer, sales-agent, and MyDancr allocations without making club accounts payout recipients.';

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
  if p_action <> 'venue_payment_received' then
    raise exception using errcode = '22023', message = 'Payee settlements are recorded from their independent commission ledgers.';
  end if;
  if length(trim(coalesce(p_external_reference, ''))) < 3
    or length(trim(p_external_reference)) > 180 then
    raise exception using errcode = '22023', message = 'A valid venue payment reference is required.';
  end if;
  select revenue.* into v_event
  from public.deal_revenue_events revenue
  where revenue.id = p_revenue_event_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Venue receivable not found.';
  end if;
  if v_event.status <> 'pending_venue_payment' then
    raise exception using errcode = '22023', message = 'Venue payment cannot be recorded from the current status.';
  end if;

  update public.deal_revenue_events
  set status = 'settled', venue_payment_reference = trim(p_external_reference),
      venue_payment_received_at = v_now,
      audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
        'venue_receivable_settled_by', auth.uid(), 'dancer_payout_dependency', false,
        'agent_payout_dependency_released', true
      )
  where id = v_event.id;
  update public.agent_commission_events
  set status = 'payable', venue_payment_received_at = v_now, payable_at = v_now,
      audit = audit || jsonb_build_object('venue_payment_reference', trim(p_external_reference))
  where deal_revenue_event_id = v_event.id and status = 'pending_venue_payment';

  return jsonb_build_object('id', v_event.id, 'status', 'settled',
    'venue_payment_reference', trim(p_external_reference),
    'venue_payment_received_at', v_now);
end;
$$;

revoke all on function public.settle_deal_revenue_event(uuid, text, text) from public, anon;
grant execute on function public.settle_deal_revenue_event(uuid, text, text) to authenticated;

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
  select invoice.* into v_invoice from public.club_invoices invoice
  where invoice.id = p_invoice_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Club invoice not found.';
  end if;
  if v_invoice.status in ('void', 'uncollectible') then
    raise exception using errcode = '22023', message = 'This invoice cannot accept payment.';
  end if;

  v_paid := least(v_invoice.amount_due_cents,
    greatest(v_invoice.amount_paid_cents, p_total_paid_cents));
  update public.club_invoices
  set amount_paid_cents = v_paid,
      status = case when v_paid >= amount_due_cents then 'paid' else 'open' end,
      external_payment_reference = trim(p_payment_reference),
      paid_at = case when v_paid >= amount_due_cents then p_paid_at else paid_at end,
      stripe_invoice_id = coalesce(p_stripe_invoice_id, stripe_invoice_id),
      hosted_invoice_url = coalesce(p_hosted_invoice_url, hosted_invoice_url),
      invoice_pdf_url = coalesce(p_invoice_pdf_url, invoice_pdf_url),
      last_error = null, updated_at = now()
  where id = p_invoice_id;

  if v_paid >= v_invoice.amount_due_cents then
    update public.deal_revenue_events revenue
    set status = 'settled', venue_payment_reference = trim(p_payment_reference),
        venue_payment_received_at = p_paid_at,
        audit = coalesce(revenue.audit, '{}'::jsonb) || jsonb_build_object(
          'club_invoice_id', p_invoice_id, 'dancer_payout_dependency', false,
          'agent_payout_dependency_released', true
        )
    where revenue.club_invoice_id = p_invoice_id
      and revenue.status = 'pending_venue_payment';

    update public.agent_commission_events commission
    set status = 'payable', venue_payment_received_at = p_paid_at, payable_at = p_paid_at,
        audit = commission.audit || jsonb_build_object(
          'club_invoice_id', p_invoice_id,
          'venue_payment_reference', trim(p_payment_reference)
        )
    where commission.deal_revenue_event_id in (
      select revenue.id from public.deal_revenue_events revenue
      where revenue.club_invoice_id = p_invoice_id
    ) and commission.status = 'pending_venue_payment';
  end if;
  return jsonb_build_object('id', p_invoice_id, 'amount_paid_cents', v_paid,
    'status', case when v_paid >= v_invoice.amount_due_cents then 'paid' else 'open' end);
end;
$$;

create or replace function public.void_agent_commissions_with_revenue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('refunded', 'voided') and old.status not in ('refunded', 'voided') then
    update public.agent_commission_events
    set status = 'voided', voided_at = clock_timestamp(),
        audit = audit || jsonb_build_object('source_revenue_status', new.status)
    where deal_revenue_event_id = new.id and status <> 'voided';
  end if;
  return new;
end;
$$;

drop trigger if exists deal_revenue_events_void_agent_commissions on public.deal_revenue_events;
create trigger deal_revenue_events_void_agent_commissions
  after update of status on public.deal_revenue_events
  for each row execute function public.void_agent_commissions_with_revenue();

alter table public.sales_agents enable row level security;
alter table public.venue_sales_attributions enable row level security;
alter table public.agent_commission_events enable row level security;
alter table public.nats_agent_affiliate_accounts enable row level security;
alter table public.nats_agent_commission_exports enable row level security;

drop policy if exists "Admins manage sales agents" on public.sales_agents;
create policy "Admins manage sales agents" on public.sales_agents
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Agents read own sales record" on public.sales_agents;
create policy "Agents read own sales record" on public.sales_agents
  for select using (user_id = auth.uid());

drop policy if exists "Admins manage venue sales attribution" on public.venue_sales_attributions;
create policy "Admins manage venue sales attribution" on public.venue_sales_attributions
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Agents read attributed venues" on public.venue_sales_attributions;
create policy "Agents read attributed venues" on public.venue_sales_attributions
  for select using (
    exists (
      select 1 from public.sales_agents agent
      where agent.user_id = auth.uid() and agent.id in (
        venue_sales_attributions.signing_agent_id,
        venue_sales_attributions.sponsor_level_1_agent_id,
        venue_sales_attributions.sponsor_level_2_agent_id,
        venue_sales_attributions.sponsor_level_3_agent_id,
        venue_sales_attributions.sponsor_level_4_agent_id,
        venue_sales_attributions.sponsor_level_5_agent_id
      )
    )
  );

drop policy if exists "Admins manage agent commissions" on public.agent_commission_events;
create policy "Admins manage agent commissions" on public.agent_commission_events
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Agents read own commissions" on public.agent_commission_events;
create policy "Agents read own commissions" on public.agent_commission_events
  for select using (
    exists (
      select 1 from public.sales_agents agent
      where agent.id = agent_commission_events.recipient_agent_id
        and agent.user_id = auth.uid()
    )
  );

drop policy if exists "Admins read NATS agent affiliate accounts" on public.nats_agent_affiliate_accounts;
create policy "Admins read NATS agent affiliate accounts" on public.nats_agent_affiliate_accounts
  for select using (public.is_admin());
drop policy if exists "Agents read own NATS affiliate account" on public.nats_agent_affiliate_accounts;
create policy "Agents read own NATS affiliate account" on public.nats_agent_affiliate_accounts
  for select using (
    exists (
      select 1 from public.sales_agents agent
      where agent.id = nats_agent_affiliate_accounts.agent_id
        and agent.user_id = auth.uid()
    )
  );

drop policy if exists "Admins read NATS agent commission exports" on public.nats_agent_commission_exports;
create policy "Admins read NATS agent commission exports" on public.nats_agent_commission_exports
  for select using (public.is_admin());
drop policy if exists "Agents read own NATS commission exports" on public.nats_agent_commission_exports;
create policy "Agents read own NATS commission exports" on public.nats_agent_commission_exports
  for select using (
    exists (
      select 1 from public.sales_agents agent
      where agent.id = nats_agent_commission_exports.agent_id
        and agent.user_id = auth.uid()
    )
  );

drop trigger if exists sales_agents_no_delete on public.sales_agents;
create trigger sales_agents_no_delete before delete on public.sales_agents
  for each row execute function public.prohibit_financial_record_delete();
drop trigger if exists venue_sales_attributions_no_delete on public.venue_sales_attributions;
create trigger venue_sales_attributions_no_delete before delete on public.venue_sales_attributions
  for each row execute function public.prohibit_financial_record_delete();

comment on table public.sales_agents is
  'Admin-designated venue sales representatives. No payment or recruitment activity creates commission.';
comment on table public.venue_sales_attributions is
  'Immutable agreement snapshots of a venue signing agent and the eligible sponsor chain.';
comment on table public.agent_commission_events is
  'Agent earnings created only by verified cashier NFC revenue and payable only after MyDancr collects from the club.';
comment on table public.nats_agent_affiliate_accounts is
  'Verified mapping between a MyDancr sales agent and the agent affiliate login in the licensed NATS installation. No tax-document contents are stored here.';
comment on table public.nats_agent_commission_exports is
  'Durable, non-deletable outbox for exact agent NFC commission amounts exported to NATS manual invoices.';

commit;
