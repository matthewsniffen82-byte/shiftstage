-- Keep venue receivables and MyDancr-funded dancer rewards as independent ledgers.

drop policy if exists "Venue owners read own commission events" on public.commission_events;
drop policy if exists "Venue owners read own deal revenue events" on public.deal_revenue_events;
drop policy if exists "Dancers read own deal revenue events" on public.deal_revenue_events;

create or replace function public.ensure_mydancr_funded_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending_club_payment' then
    new.status := 'payable';
    new.payable_at := coalesce(new.payable_at, clock_timestamp());
    new.club_payment_received_at := null;
    new.audit := coalesce(new.audit, '{}'::jsonb) || jsonb_build_object(
      'commission_funder', 'mydancr',
      'venue_payment_dependency', false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists commission_events_make_mydancr_funded on public.commission_events;
create trigger commission_events_make_mydancr_funded
  before insert or update of status on public.commission_events
  for each row
  execute function public.ensure_mydancr_funded_commission();

update public.commission_events
set
  status = 'payable',
  payable_at = coalesce(payable_at, created_at, now()),
  club_payment_received_at = null,
  audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
    'commission_funder', 'mydancr',
    'venue_payment_dependency', false,
    'separated_from_venue_receivable_at', now()
  )
where status = 'pending_club_payment';

-- A paid venue receivable is settled even when its related dancer reward has not
-- been paid yet. Dancer payout state lives only on commission_events.
update public.deal_revenue_events
set
  status = 'settled',
  audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
    'dancer_payout_dependency', false,
    'separated_from_dancer_payout_at', now()
  )
where status = 'payable';

-- Preserve the original confirmation implementation as an owner-only function,
-- then expose a wrapper that does not disclose private dancer payout terms to a
-- venue account confirming a redemption.
do $$
begin
  if to_regprocedure('public.confirm_deal_redemption_with_financial_details(text,jsonb)') is null then
    alter function public.confirm_deal_redemption(text, jsonb)
      rename to confirm_deal_redemption_with_financial_details;
  end if;
end;
$$;

revoke all on function public.confirm_deal_redemption_with_financial_details(text, jsonb)
  from public, anon, authenticated;

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
  v_result jsonb;
begin
  v_result := public.confirm_deal_redemption_with_financial_details(p_token, p_audit);

  if coalesce((v_result ->> 'ok')::boolean, true) = false then
    return jsonb_build_object(
      'ok', false,
      'status', coalesce((v_result ->> 'status')::integer, 400),
      'error', coalesce(v_result ->> 'error', 'Unable to redeem this QR code.')
    );
  end if;

  return jsonb_build_object(
    'redemption_id', v_result ->> 'redemption_id',
    'revenue_event_id', v_result ->> 'revenue_event_id',
    'source_type', v_result ->> 'source_type',
    'status', v_result ->> 'status'
  );
end;
$$;

revoke all on function public.confirm_deal_redemption(text, jsonb) from public, anon;
grant execute on function public.confirm_deal_redemption(text, jsonb) to authenticated;

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

  select revenue.*
    into v_event
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
  set
    status = 'settled',
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

create or replace function public.settle_dancer_commission_event(
  p_commission_event_id uuid,
  p_external_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_event public.commission_events%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;

  if length(trim(coalesce(p_external_reference, ''))) < 3
    or length(trim(p_external_reference)) > 180 then
    raise exception using errcode = '22023', message = 'A valid dancer payout reference is required.';
  end if;

  select commission.*
    into v_event
  from public.commission_events commission
  where commission.id = p_commission_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Dancer commission not found.';
  end if;

  if v_event.status <> 'payable' then
    raise exception using errcode = '22023', message = 'Dancer payout cannot be recorded from the current status.';
  end if;

  update public.commission_events
  set
    status = 'paid',
    paid_at = v_now,
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
      'commission_funder', 'mydancr',
      'dancer_payout_reference', trim(p_external_reference),
      'dancer_payout_recorded_by', auth.uid()
    )
  where id = v_event.id;

  return jsonb_build_object(
    'id', v_event.id,
    'status', 'paid',
    'amount_cents', v_event.amount_cents,
    'dancer_payout_reference', trim(p_external_reference),
    'paid_at', v_now
  );
end;
$$;

revoke all on function public.settle_deal_revenue_event(uuid, text, text) from public, anon;
grant execute on function public.settle_deal_revenue_event(uuid, text, text) to authenticated;
revoke all on function public.settle_dancer_commission_event(uuid, text) from public, anon;
grant execute on function public.settle_dancer_commission_event(uuid, text) to authenticated;

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
    raise exception using errcode = '22023', message = 'A valid payout reference is required.';
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
  set status = 'paid',
      stripe_transfer_id = case when left(trim(p_transfer_id), 3) = 'tr_' then trim(p_transfer_id) else stripe_transfer_id end,
      external_reference = trim(p_transfer_id),
      paid_at = p_paid_at,
      failure_message = null,
      updated_at = now()
  where id = p_batch_id;

  update public.commission_events commission
  set status = 'paid',
      paid_at = p_paid_at,
      audit = coalesce(commission.audit, '{}'::jsonb) || jsonb_build_object(
        'commission_funder', 'mydancr',
        'payout_batch_id', p_batch_id,
        'dancer_payout_reference', trim(p_transfer_id)
      )
  where commission.payout_batch_id = p_batch_id
    and commission.status = 'payable';

  return jsonb_build_object(
    'id', p_batch_id,
    'status', 'paid',
    'payout_reference', trim(p_transfer_id),
    'stripe_transfer_id', case when left(trim(p_transfer_id), 3) = 'tr_' then trim(p_transfer_id) else null end
  );
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
      audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
        'commission_funder', 'mydancr',
        'released_payout_batch_id', p_batch_id,
        'release_status', p_status,
        'release_reason', left(coalesce(p_failure_message, ''), 500)
      )
  where payout_batch_id = p_batch_id;

  update public.dancer_payout_batches
  set status = p_status,
      failure_message = left(coalesce(p_failure_message, 'Payout could not be completed.'), 500),
      updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object('id', p_batch_id, 'status', p_status);
end;
$$;

revoke all on function public.apply_club_invoice_payment(uuid, integer, text, timestamptz, text, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_dancer_payout_batch(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.release_dancer_payout_batch(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_club_invoice_payment(uuid, integer, text, timestamptz, text, text, text)
  to service_role;
grant execute on function public.complete_dancer_payout_batch(uuid, text, timestamptz)
  to service_role;
grant execute on function public.release_dancer_payout_batch(uuid, text, text)
  to service_role;
