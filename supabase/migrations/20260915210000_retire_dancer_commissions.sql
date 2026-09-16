-- End future dancer commissions without changing historical financial records.
-- Cashier attribution, venue fees and snapshotted sales-agent allocations remain.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.commission_events, public.nats_affiliate_accounts,
  public.nats_commission_exports, public.dancer_payout_batches in share row exclusive mode;

CREATE OR REPLACE FUNCTION public.confirm_deal_redemption_from_nfc(p_token text, p_tag_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public', 'pg_temp'
AS $function$
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
  v_agent_allocations jsonb;
  v_platform_cents integer := 0;
  v_revenue_id uuid;
  v_attribution_id uuid;
  v_policy_version constant text := 'dancer-commissions-retired+sales-agent-v3';
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
  -- Capture the total, recipients and attribution in one statement snapshot.
  -- The STABLE allocation helper uses that same snapshot. Later writes must
  -- consume these captured rows even if agent eligibility changes meanwhile.
  select coalesce(sum(allocation.amount_cents), 0)::integer,
    coalesce(jsonb_agg(to_jsonb(allocation)
      order by allocation.sponsor_level, allocation.recipient_agent_id), '[]'::jsonb),
    (
      select attribution.id
      from public.venue_sales_attributions attribution
      where attribution.venue_id = v_redemption.venue_id
        and attribution.effective_from <= v_now
        and (attribution.superseded_at is null or attribution.superseded_at > v_now)
      order by attribution.effective_from desc limit 1
    )
  into v_agent_cents, v_agent_allocations, v_attribution_id
  from public.agent_allocations_for_venue(v_redemption.venue_id, v_gross_cents, v_now) allocation;

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
      'dancer_commission_reason', 'program_retired'
    ), v_now, false, null
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
  from jsonb_to_recordset(v_agent_allocations) as allocation(
    venue_sales_attribution_id uuid, signing_agent_id uuid, recipient_agent_id uuid,
    sponsor_level smallint, share_bps integer, amount_cents integer
  );

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
    'dancerCommissionEligible', false,
    'dancerShareBps', v_share_bps,
    'dancerCommissionCents', v_dancer_cents,
    'agentCommissionCents', v_agent_cents,
    'platformCommissionCents', v_platform_cents,
    'successfulRedemptionNumber', v_success_number,
    'referralFeeTermId', v_referral_term.id, 'status', 'redeemed'
  );
end;
$function$;

-- Protect against stale applications or direct service-role inserts. Updates to
-- existing earnings/history remain available for audited reconciliation.
create or replace function public.reject_retired_dancer_commission_write()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode = '55000', message = 'The dancer commission program has ended.';
end;
$$;
revoke all on function public.reject_retired_dancer_commission_write() from public, anon, authenticated;

create trigger commission_events_retired_program
  before insert on public.commission_events
  for each row execute function public.reject_retired_dancer_commission_write();
create trigger nats_affiliate_accounts_retired_program
  before insert or update on public.nats_affiliate_accounts
  for each row execute function public.reject_retired_dancer_commission_write();
create trigger dancer_payout_batches_retired_program
  before insert on public.dancer_payout_batches
  for each row execute function public.reject_retired_dancer_commission_write();

-- Stop automatic export enrollment; retain existing export and audit records.
drop trigger commission_events_enqueue_nats_export on public.commission_events;
drop trigger nats_affiliate_accounts_activate_exports on public.nats_affiliate_accounts;
create trigger nats_commission_exports_retired_program
  before insert on public.nats_commission_exports
  for each row execute function public.reject_retired_dancer_commission_write();

-- The historical RPCs remain for record interpretation, but cannot initiate
-- payouts/exports from any application role. Agent RPC privileges are untouched.
do $$
declare signature text;
begin
  foreach signature in array array[
    'public.claim_nats_commission_exports(integer)',
    'public.request_dancer_payout(uuid,text,text,boolean)',
    'public.create_dancer_payout_batch(uuid,text,uuid[],text)',
    'public.admin_retry_dancer_payout(uuid,uuid,text)',
    'public.claim_dancer_payout_dispatch(uuid)',
    'public.mark_dancer_payout_processing(uuid,text)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', signature);
    end if;
  end loop;
end;
$$;
revoke all on function public.confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb) to service_role;

commit;
