-- Contract-controlled venue referral fees with effective dates and audited change requests.

create table if not exists public.venue_referral_fee_terms (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  fee_cents integer not null check (fee_cents between 100 and 100000),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  effective_from timestamptz not null,
  effective_until timestamptz,
  agreement_reference text not null check (char_length(trim(agreement_reference)) between 3 and 160),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_by_admin_user_id uuid references public.app_users(id) on delete set null,
  superseded_at timestamptz,
  superseded_by_admin_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from)
);

create index if not exists venue_referral_fee_terms_effective_idx
  on public.venue_referral_fee_terms(venue_id, effective_from desc, effective_until);

create table if not exists public.venue_referral_fee_change_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  requested_fee_cents integer not null check (requested_fee_cents between 100 and 100000),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  reason text not null check (char_length(trim(reason)) between 10 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by_user_id uuid not null references public.app_users(id) on delete restrict,
  reviewed_by_admin_user_id uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and reviewed_at is null and reviewed_by_admin_user_id is null)
    or
    (status <> 'pending' and reviewed_at is not null)
  )
);

create unique index if not exists venue_referral_fee_requests_one_pending_idx
  on public.venue_referral_fee_change_requests(venue_id)
  where status = 'pending';
create index if not exists venue_referral_fee_requests_status_idx
  on public.venue_referral_fee_change_requests(status, created_at desc);

alter table public.venue_referral_fee_terms enable row level security;
alter table public.venue_referral_fee_change_requests enable row level security;

drop policy if exists "Admins manage referral fee terms" on public.venue_referral_fee_terms;
create policy "Admins manage referral fee terms"
  on public.venue_referral_fee_terms for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Venue owners read own referral fee terms" on public.venue_referral_fee_terms;
create policy "Venue owners read own referral fee terms"
  on public.venue_referral_fee_terms for select
  using (exists (
    select 1 from public.venues venue
    where venue.id = venue_id and venue.owner_user_id = auth.uid()
  ));

drop policy if exists "Admins manage referral fee requests" on public.venue_referral_fee_change_requests;
create policy "Admins manage referral fee requests"
  on public.venue_referral_fee_change_requests for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Venue owners read own referral fee requests" on public.venue_referral_fee_change_requests;
create policy "Venue owners read own referral fee requests"
  on public.venue_referral_fee_change_requests for select
  using (exists (
    select 1 from public.venues venue
    where venue.id = venue_id and venue.owner_user_id = auth.uid()
  ));

-- Preserve every venue's existing fee as the initial contract term. The
-- migration reference distinguishes legacy values from admin-entered terms.
insert into public.venue_referral_fee_terms (
  venue_id,
  fee_cents,
  currency,
  effective_from,
  agreement_reference,
  decision_note
)
select distinct on (deal.venue_id)
  deal.venue_id,
  deal.payout_amount_cents,
  deal.currency,
  coalesce(deal.created_at, now()),
  'Migrated venue referral fee',
  'Preserved from the venue fee configured before admin-controlled agreements.'
from public.club_deals deal
where deal.payout_type = 'flat'
  and deal.payout_amount_cents between 100 and 100000
  and not exists (
    select 1 from public.venue_referral_fee_terms existing
    where existing.venue_id = deal.venue_id
  )
order by deal.venue_id, deal.is_active desc, deal.updated_at desc nulls last, deal.created_at desc;

create or replace function public.set_admin_venue_referral_fee(
  p_admin_id uuid,
  p_venue_id uuid,
  p_fee_cents integer,
  p_currency text,
  p_effective_from timestamptz,
  p_agreement_reference text,
  p_decision_note text default null,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_term_id uuid;
  v_now timestamptz := clock_timestamp();
  v_venue_name text;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_id
      and account.role = 'admin'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active MyDancr admin account required.';
  end if;
  if p_fee_cents < 100 or p_fee_cents > 100000 then
    raise exception using errcode = '22023', message = 'Referral fee must be between $1.00 and $1,000.00.';
  end if;
  if p_currency <> 'usd' then
    raise exception using errcode = '22023', message = 'Only USD referral fee agreements are supported.';
  end if;
  if p_effective_from < v_now - interval '5 minutes'
    or p_effective_from > v_now + interval '5 years' then
    raise exception using errcode = '22023', message = 'Effective date is outside the allowed range.';
  end if;
  if char_length(trim(coalesce(p_agreement_reference, ''))) not between 3 and 160 then
    raise exception using errcode = '22023', message = 'Agreement reference is required.';
  end if;

  select venue.name into v_venue_name
  from public.venues venue
  where venue.id = p_venue_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Venue not found.';
  end if;

  -- Close the term that spans the new effective moment, and retire later
  -- scheduled terms. Rows are retained permanently as contract history.
  update public.venue_referral_fee_terms term
  set effective_until = p_effective_from
  where term.venue_id = p_venue_id
    and term.superseded_at is null
    and term.effective_from < p_effective_from
    and (term.effective_until is null or term.effective_until > p_effective_from);

  update public.venue_referral_fee_terms term
  set superseded_at = v_now,
      superseded_by_admin_user_id = p_admin_id
  where term.venue_id = p_venue_id
    and term.effective_from >= p_effective_from
    and term.superseded_at is null;

  insert into public.venue_referral_fee_terms (
    venue_id,
    fee_cents,
    currency,
    effective_from,
    agreement_reference,
    decision_note,
    created_by_admin_user_id
  ) values (
    p_venue_id,
    p_fee_cents,
    p_currency,
    p_effective_from,
    trim(p_agreement_reference),
    nullif(trim(coalesce(p_decision_note, '')), ''),
    p_admin_id
  ) returning id into v_term_id;

  if p_effective_from <= v_now then
    update public.club_deals
    set payout_type = 'flat', payout_amount_cents = p_fee_cents, currency = p_currency, updated_at = v_now
    where venue_id = p_venue_id;
  end if;

  if p_request_id is not null then
    update public.venue_referral_fee_change_requests
    set status = 'approved',
        reviewed_by_admin_user_id = p_admin_id,
        reviewed_at = v_now,
        decision_note = nullif(trim(coalesce(p_decision_note, '')), ''),
        updated_at = v_now
    where id = p_request_id and venue_id = p_venue_id and status = 'pending';
    if not found then
      raise exception using errcode = '22023', message = 'This fee change request is no longer pending.';
    end if;
  end if;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_referral_fee_term',
    v_term_id,
    case when p_request_id is null then 'set_referral_fee' else 'approve_referral_fee_change' end,
    v_venue_name || ': ' || p_fee_cents::text || ' cents effective ' || p_effective_from::text
  );

  return v_term_id;
end;
$$;

revoke all on function public.set_admin_venue_referral_fee(uuid, uuid, integer, text, timestamptz, text, text, uuid) from public;
grant execute on function public.set_admin_venue_referral_fee(uuid, uuid, integer, text, timestamptz, text, text, uuid) to service_role;

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

comment on table public.venue_referral_fee_terms is
  'Immutable effective-dated MyDancr referral fee agreement history. Venue users cannot edit terms.';
comment on table public.venue_referral_fee_change_requests is
  'Venue-requested fee changes that require an explicit MyDancr admin decision.';
