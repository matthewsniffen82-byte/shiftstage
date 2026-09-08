begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Freeze enrollment and accounting during the one-time, audited no-back-pay
-- correction. Never replay historical migrations or change media/profile data.
lock table public.nats_affiliate_accounts, public.deal_revenue_events,
  public.commission_events, public.nats_commission_exports in share row exclusive mode;

alter table public.deal_revenue_events
  add column dancer_commission_eligible boolean not null default false,
  add column dancer_nats_activated_at timestamptz;

-- Preserve commissions demonstrably earned during an existing enrollment.
-- Ambiguous/dispatched money below requires reconciliation, never a clawback.
update public.deal_revenue_events revenue
set dancer_commission_eligible = true, dancer_nats_activated_at = account.activated_at
from public.nats_affiliate_accounts account
where revenue.source_type = 'dancer_profile'
  and account.dancer_id = revenue.dancer_id
  and account.activated_at <= revenue.confirmed_at
  and (account.disabled_at is null or account.disabled_at > revenue.confirmed_at)
  and account.status in ('active', 'disabled');

do $$
begin
  if exists (
    select 1 from public.deal_revenue_events revenue
    join public.commission_events earning on earning.qr_redemption_id = revenue.qr_redemption_id
    left join public.nats_commission_exports export on export.commission_event_id = earning.id
    where revenue.source_type = 'dancer_profile' and not revenue.dancer_commission_eligible
      and (earning.status in ('paid', 'payout_processing') or earning.paid_at is not null
        or earning.payout_batch_id is not null
        or export.status in ('processing', 'exported', 'reconciliation_required')
        or export.attempt_count > 0)
  ) then
    raise exception 'Pre-enrollment commissions have payout activity. Reconcile them before applying this migration.';
  end if;
end;
$$;

-- Keep the original earning amount/history; reverse only unpaid, unexported
-- pre-enrollment Club Deal earnings. No financial record is deleted.
update public.commission_events earning
set status = 'reversed', reversed_at = clock_timestamp(),
    reversal_reason = 'Club Deal redeemed before verified NATS enrollment; no retroactive dancer commission.',
    metadata = coalesce(earning.metadata, '{}'::jsonb)
      || jsonb_build_object('nats_enrollment_correction', '202609080001')
from public.deal_revenue_events revenue
where earning.qr_redemption_id = revenue.qr_redemption_id
  and revenue.source_type = 'dancer_profile'
  and not revenue.dancer_commission_eligible
  and earning.status in ('pending', 'available', 'failed');

update public.nats_commission_exports export
set status = 'canceled', updated_at = clock_timestamp(),
    last_error = 'Club Deal redeemed before verified NATS enrollment; no back pay.'
from public.commission_events earning
join public.deal_revenue_events revenue on revenue.qr_redemption_id = earning.qr_redemption_id
where export.commission_event_id = earning.id
  and revenue.source_type = 'dancer_profile'
  and not revenue.dancer_commission_eligible
  and export.status in ('waiting_for_affiliate', 'pending', 'failed');

-- Retain the dancer as the attribution source even when their commission is 0.
-- The old constraint required every dancer-attributed event to pay the dancer.
alter table public.deal_revenue_events drop constraint deal_revenue_events_check1;

insert into public.financial_audit_events (
  actor_type, action, target_type, target_id, reason, before_state, after_state, metadata
)
select 'system', 'pre_enrollment_dancer_share_retained', 'earning', earning.id::text,
  'No dancer commission before verified NATS enrollment; no back pay.',
  jsonb_build_object('dancer_commission_cents', revenue.dancer_commission_cents,
    'platform_commission_cents', revenue.platform_commission_cents),
  jsonb_build_object('dancer_commission_cents', 0,
    'platform_commission_cents', revenue.platform_commission_cents + revenue.dancer_commission_cents),
  jsonb_build_object('migration', '202609080001', 'revenue_event_id', revenue.id)
from public.deal_revenue_events revenue
join public.commission_events earning on earning.qr_redemption_id = revenue.qr_redemption_id
where revenue.source_type = 'dancer_profile'
  and not revenue.dancer_commission_eligible and revenue.dancer_commission_cents > 0;

update public.deal_revenue_events
set platform_commission_cents = platform_commission_cents + dancer_commission_cents,
    dancer_commission_cents = 0, dancer_share_bps = 0, successful_redemption_number = null,
    status = case when status = 'payable' then 'settled' else status end,
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
      'nats_enrollment_correction', '202609080001',
      'pre_enrollment_dancer_commission_cents', dancer_commission_cents,
      'dancer_commission_reason', 'not_enrolled_in_nats'
    )
where source_type = 'dancer_profile' and not dancer_commission_eligible;

alter table public.deal_revenue_events
  add constraint deal_revenue_events_dancer_enrollment_check check (
    (source_type = 'club_page' and dancer_id is null
      and not dancer_commission_eligible and dancer_nats_activated_at is null
      and dancer_share_bps = 0 and dancer_commission_cents = 0)
    or
    (source_type = 'dancer_profile' and dancer_id is not null and (
      (dancer_commission_eligible and dancer_nats_activated_at is not null
        and dancer_nats_activated_at <= confirmed_at and dancer_share_bps > 0)
      or
      (not dancer_commission_eligible and dancer_nats_activated_at is null
        and dancer_share_bps = 0 and dancer_commission_cents = 0
        and successful_redemption_number is null)
    ))
  );

comment on column public.deal_revenue_events.dancer_commission_eligible is
  'Immutable eligibility at cashier NFC redemption. Later NATS enrollment cannot create back pay.';
comment on column public.deal_revenue_events.dancer_nats_activated_at is
  'Database-verified active NATS enrollment timestamp captured at redemption, not at selection or export.';

create or replace function public.preserve_dancer_commission_eligibility()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.dancer_commission_eligible, new.dancer_nats_activated_at, new.confirmed_at)
    is distinct from
    (old.dancer_commission_eligible, old.dancer_nats_activated_at, old.confirmed_at)
  then
    raise exception using errcode = '22023', message = 'Redemption commission eligibility is immutable.';
  end if;
  return new;
end;
$$;
create trigger deal_revenue_events_preserve_dancer_eligibility
  before update on public.deal_revenue_events
  for each row execute function public.preserve_dancer_commission_eligibility();

-- A shared lock serializes activation/disable with a cashier redemption, even
-- when no affiliate row exists yet. The database owns the enrollment time.
create or replace function public.activate_waiting_nats_exports()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.dancer_id::text), hashtext('nats-dancer-enrollment'));
  new.updated_at := clock_timestamp();
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.activated_at := clock_timestamp();
    new.disabled_at := null;
    -- Other, non-Club-Deal earning types keep their existing settlement behavior.
    update public.nats_commission_exports export
    set status = 'pending', updated_at = clock_timestamp(), last_error = null, failed_at = null
    where export.dancer_id = new.dancer_id and export.status = 'waiting_for_affiliate'
      and exists (
        select 1 from public.commission_events earning
        where earning.id = export.commission_event_id and earning.qr_redemption_id is null
          and earning.status = 'available' and not earning.is_test
          and earning.held_at is null and earning.review_flag is null
      );
  elsif tg_op = 'UPDATE' then
    new.activated_at := old.activated_at;
    if new.status = 'disabled' and old.status is distinct from 'disabled' then
      new.disabled_at := clock_timestamp();
    end if;
  else
    new.activated_at := null;
  end if;
  return new;
end;
$$;
drop trigger nats_affiliate_accounts_activate_exports on public.nats_affiliate_accounts;
create trigger nats_affiliate_accounts_activate_exports
  before insert or update on public.nats_affiliate_accounts
  for each row execute function public.activate_waiting_nats_exports();

create or replace function public.is_nats_eligible_club_deal_earning(p_earning_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.commission_events earning
    join public.deal_revenue_events revenue on revenue.qr_redemption_id = earning.qr_redemption_id
    where earning.id = p_earning_id
      and revenue.dancer_id = earning.dancer_id
      and revenue.dancer_commission_eligible
      and revenue.dancer_nats_activated_at <= revenue.confirmed_at
      and revenue.dancer_commission_cents = earning.amount_cents
      and revenue.status not in ('refunded', 'voided')
  );
$$;

create or replace function public.require_enrolled_club_deal_earning()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.qr_redemption_id is not null and not exists (
    select 1 from public.deal_revenue_events revenue
    where revenue.qr_redemption_id = new.qr_redemption_id
      and revenue.dancer_id = new.dancer_id and revenue.dancer_commission_eligible
      and revenue.dancer_nats_activated_at <= revenue.confirmed_at
      and revenue.dancer_commission_cents = new.amount_cents
      and revenue.status not in ('refunded', 'voided')
  ) then
    raise exception using errcode = '22023', message = 'Club Deal commission requires NATS eligibility at redemption.';
  end if;
  return new;
end;
$$;
create trigger commission_events_require_nats_enrollment
  before insert on public.commission_events
  for each row execute function public.require_enrolled_club_deal_earning();

create or replace function public.enqueue_nats_commission_export()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_account_active boolean;
begin
  if new.status <> 'available' or new.is_test or new.held_at is not null
    or new.review_flag is not null or new.amount_cents <= 0 or lower(new.currency) <> 'usd'
  then return new; end if;

  if new.qr_redemption_id is not null
    and not public.is_nats_eligible_club_deal_earning(new.id)
  then return new; end if;

  select exists (
    select 1 from public.nats_affiliate_accounts account
    where account.dancer_id = new.dancer_id and account.status = 'active'
  ) into v_account_active;

  insert into public.nats_commission_exports (
    commission_event_id, dancer_id, amount_cents, currency, status
  ) values (
    new.id, new.dancer_id, new.amount_cents, lower(new.currency),
    case when new.qr_redemption_id is not null or v_account_active
      then 'pending' else 'waiting_for_affiliate' end
  ) on conflict (commission_event_id) do nothing;
  return new;
end;
$$;

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
  v_nats_activated_at timestamptz;
  v_policy_version constant text := 'nats-enrolled-dancer-30-40-50+sales-agent-v2';
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

  if v_redemption.source_type = 'dancer_profile' then
    perform pg_advisory_xact_lock(hashtext(v_redemption.dancer_id::text), hashtext('nats-dancer-enrollment'));
    v_now := clock_timestamp();
    select account.activated_at into v_nats_activated_at
    from public.nats_affiliate_accounts account
    where account.dancer_id = v_redemption.dancer_id
      and account.status = 'active' and account.activated_at <= v_now;
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
  if v_nats_activated_at is not null then
    perform pg_advisory_xact_lock(hashtext(v_redemption.dancer_id::text), hashtext(v_month::text));
    select count(*)::integer + 1 into v_success_number
    from public.deal_revenue_events revenue
    where revenue.dancer_id = v_redemption.dancer_id
      and revenue.commission_month = v_month
      and revenue.dancer_commission_eligible
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
    successful_redemption_number, commission_month, policy_version, audit, confirmed_at,
    dancer_commission_eligible, dancer_nats_activated_at
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
      'sales_agent_policy', 'direct-15_l1-3_l2-2.5_l3-2_l4-1.5_l5-1',
      'dancer_commission_reason', case when v_nats_activated_at is not null
        then 'enrolled_at_redemption' else 'not_enrolled_in_nats' end
    ), v_now, v_nats_activated_at is not null, v_nats_activated_at
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

  if v_nats_activated_at is not null and v_dancer_cents > 0 then
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
    'dancerCommissionEligible', v_nats_activated_at is not null,
    'dancerShareBps', v_share_bps,
    'dancerCommissionCents', v_dancer_cents,
    'agentCommissionCents', v_agent_cents,
    'platformCommissionCents', v_platform_cents,
    'successfulRedemptionNumber', v_success_number,
    'referralFeeTermId', v_referral_term.id, 'status', 'redeemed'
  );
end;
$$;

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
set search_path = public, pg_temp
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
      and (earning.qr_redemption_id is null
        or public.is_nats_eligible_club_deal_earning(earning.id))
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

revoke all on function public.preserve_dancer_commission_eligibility() from public, anon, authenticated;
revoke all on function public.require_enrolled_club_deal_earning() from public, anon, authenticated;
revoke all on function public.is_nats_eligible_club_deal_earning(uuid) from public, anon, authenticated;
grant execute on function public.is_nats_eligible_club_deal_earning(uuid) to service_role;

-- CREATE OR REPLACE retains existing ACLs; explicitly reaffirm service-only RPCs.
revoke all on function public.confirm_deal_redemption_from_nfc(text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_deal_redemption_from_nfc(text, uuid, uuid, jsonb) to service_role;
revoke all on function public.claim_nats_commission_exports(integer) from public, anon, authenticated;
grant execute on function public.claim_nats_commission_exports(integer) to service_role;

commit;
