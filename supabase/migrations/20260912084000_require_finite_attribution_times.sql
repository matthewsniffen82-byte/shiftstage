-- Attribution windows must represent real instants; null already means no end.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter table public.venue_sales_attributions
  add constraint venue_sales_attributions_finite_times_check check (
    isfinite(effective_from) and (superseded_at is null or isfinite(superseded_at))
  );
commit;
