-- Display lists remain bounded; their limits must not change financial totals.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
create function public.get_admin_finance_totals()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with invoices as (
    select
      coalesce(sum(amount_due_cents - amount_paid_cents) filter (where status in ('open','overdue')),0)::text outstanding,
      coalesce(sum(amount_due_cents - amount_paid_cents) filter (where status in ('open','overdue') and (status = 'overdue' or due_at < now())),0)::text overdue,
      coalesce(sum(amount_paid_cents) filter (where status = 'paid'),0)::text paid,
      count(*) filter (where status in ('open','overdue'))::text open_count,
      count(*) filter (where status in ('open','overdue') and (status = 'overdue' or due_at < now()))::text overdue_count
    from public.club_invoices
  ), exports as (
    select count(*) filter (where status in ('waiting_for_affiliate','pending','processing'))::text pending,
      count(*) filter (where status = 'reconciliation_required')::text review,
      coalesce(sum(amount_cents) filter (where status = 'exported'),0)::text exported
    from public.nats_commission_exports
  ), venue_groups as (
    select coalesce(v.name,'Venue') name, sum(c.amount_cents) amount, count(*) entries
    from public.commission_events c left join public.venues v on v.id = c.venue_id
    where c.status not in ('reversed','failed') group by coalesce(v.name,'Venue')
    order by sum(c.amount_cents) desc, coalesce(v.name,'Venue') limit 10
  ), dancer_groups as (
    select coalesce(d.stage_name,'Dancer') name, sum(c.amount_cents) amount, count(*) entries
    from public.commission_events c left join public.dancer_profiles d on d.id = c.dancer_id
    where c.status not in ('reversed','failed') group by coalesce(d.stage_name,'Dancer')
    order by sum(c.amount_cents) desc, coalesce(d.stage_name,'Dancer') limit 10
  )
  select jsonb_build_object('metrics', jsonb_build_object(
    'outstandingReceivablesCents', i.outstanding, 'overdueReceivablesCents', i.overdue,
    'paidClubRevenueCents', i.paid, 'openInvoiceCount', i.open_count, 'overdueInvoiceCount', i.overdue_count,
    'myDancrNetRevenueCents', (select coalesce(sum(platform_commission_cents),0)::text from public.deal_revenue_events where status = 'settled'),
    'natsPendingAccountCount', (select count(*)::text from public.nats_affiliate_accounts where status = 'requested'),
    'natsPendingExportCount', e.pending, 'natsReconciliationCount', e.review, 'natsExportedCents', e.exported
  ), 'earningsByVenue', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amountCents', amount::text, 'count', entries::text) order by amount desc, name),'[]'::jsonb) from venue_groups),
     'earningsByDancer', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amountCents', amount::text, 'count', entries::text) order by amount desc, name),'[]'::jsonb) from dancer_groups))
  from invoices i cross join exports e;
$$;
revoke all on function public.get_admin_finance_totals() from public, anon, authenticated;
grant execute on function public.get_admin_finance_totals() to service_role;
commit;
