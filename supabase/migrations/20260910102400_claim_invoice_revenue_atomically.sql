-- Preserve each revenue event in at most one invoice, including voided history.
-- Do not clean up duplicates automatically; an unexpected duplicate aborts.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table public.club_invoice_items
  add constraint club_invoice_items_revenue_event_once_key unique (revenue_event_id);

create or replace function public.create_club_invoice_draft(
  p_venue_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_at timestamptz,
  p_revenue_event_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $function$
declare
  v_invoice_id uuid;
  v_sequence integer;
  v_expected integer := coalesce(cardinality(p_revenue_event_ids), 0);
  v_count integer;
  v_amount bigint;
  v_currency text;
  v_currency_count integer;
begin
  if v_expected = 0 or array_ndims(p_revenue_event_ids) <> 1 then
    raise exception using errcode = '22023', message = 'At least one revenue event is required.';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start or p_due_at is null then
    raise exception using errcode = '22023', message = 'A valid invoice period and due date are required.';
  end if;

  -- Serialize sequence allocation even when no invoice exists yet.
  perform 1 from public.venues where id = p_venue_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Invoice venue not found.';
  end if;

  -- Lock before inspecting eligibility; caller selections are only snapshots.
  perform revenue.id from public.deal_revenue_events revenue
  where revenue.id = any(p_revenue_event_ids)
  order by revenue.id for update;

  select count(*)::integer, coalesce(sum(revenue.gross_commission_cents), 0)::bigint,
         min(revenue.currency), count(distinct revenue.currency)::integer
    into v_count, v_amount, v_currency, v_currency_count
  from public.deal_revenue_events revenue
  where revenue.id = any(p_revenue_event_ids)
    and revenue.venue_id = p_venue_id
    and revenue.status = 'pending_venue_payment'
    and revenue.club_invoice_id is null
    and not exists (select 1 from public.club_invoice_items item where item.revenue_event_id = revenue.id);

  if v_count <> v_expected or v_amount <= 0 or v_amount > 2147483647 or v_currency_count <> 1 then
    raise exception using errcode = '22023', message = 'Revenue events are no longer invoiceable.';
  end if;

  select coalesce(max(invoice.sequence), 0) + 1 into v_sequence
  from public.club_invoices invoice
  where invoice.venue_id = p_venue_id
    and invoice.period_start = p_period_start
    and invoice.period_end = p_period_end;

  insert into public.club_invoices (
    venue_id, period_start, period_end, sequence, currency, amount_due_cents, due_at
  ) values (
    p_venue_id, p_period_start, p_period_end, v_sequence, v_currency, v_amount::integer, p_due_at
  ) returning id into v_invoice_id;
  if v_invoice_id is null then
    raise exception using errcode = '40001', message = 'Invoice creation could not be confirmed.';
  end if;

  insert into public.club_invoice_items (invoice_id, revenue_event_id, amount_cents)
  select v_invoice_id, revenue.id, revenue.gross_commission_cents
  from public.deal_revenue_events revenue
  where revenue.id = any(p_revenue_event_ids);
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception using errcode = '40001', message = 'Invoice items could not be confirmed.';
  end if;

  update public.deal_revenue_events
  set club_invoice_id = v_invoice_id
  where id = any(p_revenue_event_ids)
    and status = 'pending_venue_payment' and club_invoice_id is null;
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception using errcode = '40001', message = 'Invoice revenue assignment could not be confirmed.';
  end if;

  select count(*)::integer, coalesce(sum(item.amount_cents), 0)::bigint into v_count, v_amount
  from public.club_invoice_items item
  join public.deal_revenue_events revenue on revenue.id = item.revenue_event_id
  where item.invoice_id = v_invoice_id and revenue.id = any(p_revenue_event_ids)
    and revenue.club_invoice_id = v_invoice_id and revenue.venue_id = p_venue_id
    and revenue.status = 'pending_venue_payment' and revenue.currency = v_currency
    and revenue.gross_commission_cents = item.amount_cents;
  if v_count <> v_expected
    or (select count(*) from public.club_invoice_items where invoice_id = v_invoice_id) <> v_expected
    or not exists (
    select 1 from public.club_invoices invoice where invoice.id = v_invoice_id
      and invoice.venue_id = p_venue_id and invoice.amount_due_cents = v_amount
      and invoice.currency = v_currency and invoice.status = 'draft'
      and invoice.period_start = p_period_start and invoice.period_end = p_period_end
      and invoice.due_at = p_due_at and invoice.sequence = v_sequence
  ) then
    raise exception using errcode = '40001', message = 'Invoice totals and revenue could not be confirmed.';
  end if;
  return v_invoice_id;
end;
$function$;

revoke all on function public.create_club_invoice_draft(uuid,date,date,timestamptz,uuid[]) from public, anon, authenticated;
grant execute on function public.create_club_invoice_draft(uuid,date,date,timestamptz,uuid[]) to service_role;
commit;
