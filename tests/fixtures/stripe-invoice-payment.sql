CREATE OR REPLACE FUNCTION public.apply_club_invoice_payment(p_invoice_id uuid, p_total_paid_cents integer, p_payment_reference text, p_paid_at timestamp with time zone DEFAULT now(), p_stripe_invoice_id text DEFAULT NULL::text, p_hosted_invoice_url text DEFAULT NULL::text, p_invoice_pdf_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
