-- Reserve delivery before contacting Stripe. Complete the delivery ledger and
-- invoice summary together; uncertain sends never receive a new provider key.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create table public.club_invoice_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.club_invoices(id) on delete cascade,
  reminder_key text not null check (reminder_key ~ '^(due_soon|overdue_[0-9]+)$'),
  stripe_invoice_id text not null,
  status text not null check (status in ('dispatching', 'sent', 'review_required')),
  attempt_token uuid not null default gen_random_uuid(),
  first_dispatch_at timestamptz not null default clock_timestamp(),
  locked_until timestamptz not null,
  sent_at timestamptz,
  audit jsonb not null default '{}'::jsonb,
  unique (invoice_id, reminder_key)
);
alter table public.club_invoice_reminder_deliveries enable row level security;
revoke all on public.club_invoice_reminder_deliveries from public, anon, authenticated;
grant all on public.club_invoice_reminder_deliveries to service_role;

create function public.claim_club_invoice_reminder_delivery(p_invoice_id uuid, p_reminder_key text, p_stripe_invoice_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_invoice public.club_invoices%rowtype;
  v_delivery public.club_invoice_reminder_deliveries%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_reminder_key is null or length(p_reminder_key) > 80
    or p_reminder_key !~ '^(due_soon|overdue_[0-9]+)$'
    or p_stripe_invoice_id is null or length(p_stripe_invoice_id) not between 3 and 255 then
    raise exception 'Invalid reminder identity' using errcode = '22023';
  end if;
  -- All claims/completions for an invoice acquire this lock first.
  select * into v_invoice from public.club_invoices where id = p_invoice_id for update;
  if not found or v_invoice.status not in ('open', 'overdue')
    or v_invoice.stripe_invoice_id is distinct from p_stripe_invoice_id then
    return jsonb_build_object('status', 'ineligible');
  end if;
  if exists(select 1 from public.club_invoice_reminders where invoice_id = p_invoice_id and reminder_key = p_reminder_key) then
    return jsonb_build_object('status', 'sent');
  end if;
  -- A later weekly window must not bypass a previous uncertain delivery.
  select * into v_delivery from public.club_invoice_reminder_deliveries
    where invoice_id = p_invoice_id and status <> 'sent'
    order by first_dispatch_at, id limit 1 for update;
  if found then
    if v_delivery.status = 'review_required' or v_delivery.first_dispatch_at <= v_now - interval '23 hours'
      or v_delivery.stripe_invoice_id is distinct from p_stripe_invoice_id then
      update public.club_invoice_reminder_deliveries set status = 'review_required' where id = v_delivery.id;
      update public.club_invoices set last_error = 'A reminder delivery is uncertain. Review Stripe delivery before sending another reminder.', updated_at = v_now
        where id = p_invoice_id;
      return jsonb_build_object('status', 'review_required');
    end if;
    if v_delivery.locked_until > v_now or v_delivery.reminder_key <> p_reminder_key then
      return jsonb_build_object('status', 'busy');
    end if;
    update public.club_invoice_reminder_deliveries
      set attempt_token = gen_random_uuid(), locked_until = v_now + interval '60 seconds'
      where id = v_delivery.id returning * into v_delivery;
  else
    insert into public.club_invoice_reminder_deliveries(invoice_id, reminder_key, stripe_invoice_id, status, locked_until, audit)
      values(p_invoice_id, p_reminder_key, p_stripe_invoice_id, 'dispatching', v_now + interval '60 seconds',
        jsonb_build_object('due_at', v_invoice.due_at, 'days_from_due', ceil(extract(epoch from (v_invoice.due_at - v_now)) / 86400))) returning * into v_delivery;
  end if;
  return jsonb_build_object('status', 'claimed', 'deliveryId', v_delivery.id,
    'attemptToken', v_delivery.attempt_token, 'stripeInvoiceId', v_delivery.stripe_invoice_id,
    'idempotencyKey', 'mydancr-reminder-' || v_delivery.id::text,
    'retryBefore', v_delivery.first_dispatch_at + interval '23 hours');
end;
$$;

create function public.complete_club_invoice_reminder_delivery(p_delivery_id uuid, p_attempt_token uuid, p_stripe_invoice_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_delivery public.club_invoice_reminder_deliveries%rowtype;
  v_inserted uuid;
  v_now timestamptz := clock_timestamp();
begin
  perform 1 from public.club_invoices where id = (
    select invoice_id from public.club_invoice_reminder_deliveries where id = p_delivery_id
  ) for update;
  select * into v_delivery from public.club_invoice_reminder_deliveries where id = p_delivery_id for update;
  if not found or v_delivery.stripe_invoice_id is distinct from p_stripe_invoice_id then
    raise exception 'Reminder delivery identity changed' using errcode = '40001';
  end if;
  if v_delivery.status = 'sent' then
    return jsonb_build_object('status', 'sent', 'deliveryId', v_delivery.id);
  end if;
  if v_delivery.status <> 'dispatching' or v_delivery.attempt_token is distinct from p_attempt_token then
    raise exception 'Reminder delivery ownership changed' using errcode = '40001';
  end if;
  insert into public.club_invoice_reminders(invoice_id, reminder_key, provider_reference, audit)
    values(v_delivery.invoice_id, v_delivery.reminder_key, v_delivery.stripe_invoice_id,
      v_delivery.audit || jsonb_build_object('delivery_id', v_delivery.id, 'idempotency_key', 'mydancr-reminder-' || v_delivery.id::text))
    on conflict (invoice_id, reminder_key) do nothing returning id into v_inserted;
  if v_inserted is not null then
    update public.club_invoices set last_reminder_at = v_now, reminder_count = reminder_count + 1,
      updated_at = v_now where id = v_delivery.invoice_id;
  end if;
  update public.club_invoice_reminder_deliveries set status = 'sent', sent_at = v_now where id = v_delivery.id;
  return jsonb_build_object('status', 'sent', 'deliveryId', v_delivery.id);
end;
$$;

revoke all on function public.claim_club_invoice_reminder_delivery(uuid,text,text) from public, anon, authenticated;
revoke all on function public.complete_club_invoice_reminder_delivery(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_club_invoice_reminder_delivery(uuid,text,text) to service_role;
grant execute on function public.complete_club_invoice_reminder_delivery(uuid,uuid,text) to service_role;

-- Held deliveries must not consume the candidate limit on every later run.
create or replace function public.get_due_club_invoice_reminders(p_now timestamptz, p_limit integer default 250)
returns table(id uuid, status text, due_at timestamptz, stripe_invoice_id text, reminder_count integer)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_now is null or not isfinite(p_now) or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception 'Invalid reminder selection bounds' using errcode = '22023';
  end if;
  return query
  select i.id, i.status::text, i.due_at, i.stripe_invoice_id, i.reminder_count
  from public.club_invoices i
  cross join lateral (
    select case when isfinite(i.due_at)
      then ceil(extract(epoch from (i.due_at - p_now)) / 86400) end as days_from_due
  ) d
  cross join lateral (
    select case when d.days_from_due between 0 and 3 then 'due_soon'
      when d.days_from_due < 0 then 'overdue_' || (floor(abs(d.days_from_due) / 7) * 7)::bigint::text
      else null end as reminder_key
  ) r
  where i.status in ('open', 'overdue') and i.stripe_invoice_id is not null
    and r.reminder_key is not null
    and not exists (
      select 1 from public.club_invoice_reminders sent
      where sent.invoice_id = i.id and sent.reminder_key = r.reminder_key
    )
    and not exists (
      select 1 from public.club_invoice_reminder_deliveries held
      where held.invoice_id = i.id and held.status = 'review_required'
    )
  order by i.due_at, i.id
  limit p_limit;
end;
$$;
commit;
