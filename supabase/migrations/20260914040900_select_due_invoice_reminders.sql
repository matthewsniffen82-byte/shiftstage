-- Select unsent reminder windows before limiting the batch. Already reminded
-- open invoices must not prevent newer invoices from receiving their reminders.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create function public.get_due_club_invoice_reminders(p_now timestamptz, p_limit integer default 250)
returns table(id uuid, status text, due_at timestamptz, stripe_invoice_id text, reminder_count integer)
language plpgsql stable security invoker
set search_path = ''
as $$
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
  order by i.due_at, i.id
  limit p_limit;
end;
$$;

revoke all on function public.get_due_club_invoice_reminders(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_due_club_invoice_reminders(timestamptz, integer) to service_role;
commit;
