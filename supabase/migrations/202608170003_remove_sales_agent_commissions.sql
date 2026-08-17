-- Remove the unused multi-level sales-agent commission program and restore the
-- previous verified-NFC revenue and venue-payment behavior. The original
-- migration remains in history because it was already applied to production.

begin;

do $$
begin
  if exists (select 1 from public.sales_agents limit 1)
    or exists (select 1 from public.venue_sales_attributions limit 1)
    or exists (select 1 from public.agent_commission_events limit 1)
    or exists (
      select 1
      from public.deal_revenue_events
      where agent_commission_cents <> 0 or venue_sales_attribution_id is not null
      limit 1
    ) then
    raise exception using
      errcode = '55000',
      message = 'Sales-agent data exists; archive and reconcile it before removing the program.';
  end if;
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
  v_platform_cents integer := 0;
  v_revenue_id uuid;
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
    update public.qr_redemptions set status = 'expired' where id = v_redemption.id and status = 'generated';
    raise exception using errcode = '22023', message = 'This Club Deal is no longer valid.';
  end if;

  select term.* into v_referral_term
  from public.venue_referral_fee_terms term
  where term.venue_id = v_redemption.venue_id
    and term.superseded_at is null
    and term.effective_from <= v_now
    and (term.effective_until is null or term.effective_until > v_now)
  order by term.effective_from desc
  limit 1;
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
        or (v_redemption.customer_id is null and v_redemption.session_id is not null and previous.session_id = v_redemption.session_id)
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
    v_share_bps := case when v_success_number >= 75 then 5000 when v_success_number >= 25 then 4000 else 3000 end;
    v_dancer_cents := round(v_gross_cents * v_share_bps / 10000.0)::integer;
  else
    v_success_number := null;
  end if;
  v_platform_cents := v_gross_cents - v_dancer_cents;

  update public.qr_redemptions set
    status = 'redeemed', redeemed_at = v_now, confirmed_at = v_now,
    first_scanned_at = coalesce(first_scanned_at, v_now), nfc_tag_id = v_tag.id,
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object('nfc_confirmed', p_audit, 'nfc_tag_id', v_tag.id)
  where id = v_redemption.id;

  insert into public.qr_redemption_events (qr_redemption_id, event_type, session_id, audit)
  values (v_redemption.id, 'venue_confirmed', p_session_id::text, p_audit || jsonb_build_object('method', 'nfc', 'tagId', v_tag.id));

  insert into public.deal_revenue_events (
    qr_redemption_id, venue_id, club_deal_id, dancer_id, source_type, currency,
    gross_commission_cents, dancer_share_bps, dancer_commission_cents,
    platform_commission_cents, successful_redemption_number, commission_month,
    policy_version, audit, confirmed_at
  ) values (
    v_redemption.id, v_redemption.venue_id, v_redemption.club_deal_id,
    v_redemption.dancer_id, v_redemption.source_type, v_referral_term.currency,
    v_gross_cents, v_share_bps, v_dancer_cents, v_platform_cents,
    v_success_number, v_month, 'monthly-tier-v1',
    jsonb_build_object(
      'source', 'cashier_nfc_tap',
      'nfc_tag_id', v_tag.id,
      'shift_id', v_redemption.shift_id,
      'referral_fee_term_id', v_referral_term.id,
      'agreement_reference', v_referral_term.agreement_reference
    ), v_now
  ) returning id into v_revenue_id;

  if v_redemption.source_type = 'dancer_profile' then
    insert into public.commission_events (
      qr_redemption_id, venue_id, club_deal_id, dancer_id, status, amount_cents,
      payout_type, gross_commission_cents, dancer_share_bps, platform_amount_cents,
      successful_redemption_number, commission_month, currency, policy_version, audit
    ) values (
      v_redemption.id, v_redemption.venue_id, v_redemption.club_deal_id,
      v_redemption.dancer_id, 'pending_club_payment', v_dancer_cents, 'flat',
      v_gross_cents, v_share_bps, v_platform_cents, v_success_number, v_month,
      v_referral_term.currency, 'monthly-tier-v1',
      jsonb_build_object(
        'source', 'deal_revenue_event',
        'deal_revenue_event_id', v_revenue_id,
        'nfc_tag_id', v_tag.id,
        'referral_fee_term_id', v_referral_term.id
      )
    );
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_tag.venue_id, v_tag.tag_type, 'deal_redeemed', v_redemption.customer_id,
    p_session_id, p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object('redemptionId', v_redemption.id, 'dealId', v_deal.id, 'revenueEventId', v_revenue_id)
  );
  update public.nfc_tags set last_tapped_at = v_now, tap_count = tap_count + 1, updated_at = v_now where id = v_tag.id;

  return jsonb_build_object(
    'redemptionId', v_redemption.id,
    'revenueEventId', v_revenue_id,
    'dealTitle', v_deal.deal_title,
    'venueName', v_venue.name,
    'sourceType', v_redemption.source_type,
    'grossCommissionCents', v_gross_cents,
    'dancerShareBps', v_share_bps,
    'dancerCommissionCents', v_dancer_cents,
    'platformCommissionCents', v_platform_cents,
    'successfulRedemptionNumber', v_success_number,
    'referralFeeTermId', v_referral_term.id,
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
  if p_action <> 'venue_payment_received' then
    raise exception using errcode = '22023', message = 'Dancer payouts must be recorded from the MyDancr dancer commission ledger.';
  end if;
  if length(trim(coalesce(p_external_reference, ''))) < 3
    or length(trim(p_external_reference)) > 180 then
    raise exception using errcode = '22023', message = 'A valid venue payment reference is required.';
  end if;

  select revenue.* into v_event
  from public.deal_revenue_events revenue
  where revenue.id = p_revenue_event_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Venue receivable not found.';
  end if;
  if v_event.status <> 'pending_venue_payment' then
    raise exception using errcode = '22023', message = 'Venue payment cannot be recorded from the current status.';
  end if;

  update public.deal_revenue_events
  set status = 'settled',
      venue_payment_reference = trim(p_external_reference),
      venue_payment_received_at = v_now,
      audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
        'venue_receivable_settled_by', auth.uid(),
        'dancer_payout_dependency', false
      )
  where id = v_event.id;

  return jsonb_build_object(
    'id', v_event.id,
    'status', 'settled',
    'venue_payment_reference', trim(p_external_reference),
    'venue_payment_received_at', v_now
  );
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
    set status = 'settled',
        venue_payment_reference = trim(p_payment_reference),
        venue_payment_received_at = p_paid_at,
        audit = coalesce(revenue.audit, '{}'::jsonb) || jsonb_build_object(
          'club_invoice_id', p_invoice_id,
          'dancer_payout_dependency', false
        )
    where revenue.club_invoice_id = p_invoice_id
      and revenue.status = 'pending_venue_payment';
  end if;

  return jsonb_build_object(
    'id', p_invoice_id,
    'amount_paid_cents', v_paid,
    'status', case when v_paid >= v_invoice.amount_due_cents then 'paid' else 'open' end
  );
end;
$$;

drop function if exists public.record_admin_agent_commission_payment(uuid, uuid, text, timestamptz);
drop function if exists public.assign_admin_venue_sales_agent(uuid, uuid, uuid, text, timestamptz);
drop function if exists public.set_admin_sales_agent(uuid, uuid, uuid, smallint, text);
drop function if exists public.agent_allocations_for_venue(uuid, integer, timestamptz);

drop table if exists public.agent_commission_events;

alter table public.deal_revenue_events
  drop constraint if exists deal_revenue_events_commission_balance_check;
alter table public.deal_revenue_events
  drop column if exists venue_sales_attribution_id,
  drop column if exists agent_commission_cents;
alter table public.deal_revenue_events
  add constraint deal_revenue_events_commission_balance_check
  check (dancer_commission_cents + platform_commission_cents = gross_commission_cents);

drop table if exists public.venue_sales_attributions;
drop trigger if exists validate_sales_agent_hierarchy_trigger on public.sales_agents;
drop table if exists public.sales_agents;
drop function if exists public.validate_sales_agent_hierarchy();

commit;
