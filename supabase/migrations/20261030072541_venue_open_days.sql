-- Opening days use JavaScript/Postgres weekday numbers: Sunday = 0.
-- Retain the previous every-day schedule for all existing clubs.
alter table public.venues
  add column open_days smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  add constraint venues_open_days_valid check (
    cardinality(open_days) between 1 and 7
    and array_ndims(open_days) = 1
    and array_lower(open_days, 1) = 1
    and open_days <@ array[0,1,2,3,4,5,6]::smallint[]
    and array_position(open_days, null) is null
  );

comment on column public.venues.open_days is
  'Days on which opening hours begin (0=Sunday). Overnight closing falls on the following day. Equal times mean 24 hours on each selected calendar day.';

-- Public hours retain the venues table's existing row-level visibility policy.
grant select (open_days) on public.venues to anon, authenticated;
grant select (open_days), insert (open_days), update (open_days) on public.venues to service_role;

notify pgrst, 'reload schema';
