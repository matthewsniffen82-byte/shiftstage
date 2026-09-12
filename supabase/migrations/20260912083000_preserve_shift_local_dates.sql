-- Keep schedule dates aligned with their finite local start and preserve session chronology.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';
lock table public.shifts in share row exclusive mode;
do $preflight$
begin
  if exists (
    select 1 from public.shifts
    where shift_date is distinct from timezone(coalesce(nullif(timezone, ''), 'UTC'), starts_at)::date
  ) then
    raise exception 'SHIFT_LOCAL_DATE_PREFLIGHT_FAILED';
  end if;
end;
$preflight$;

create or replace function public.set_shift_date_from_starts_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_local_date date;
begin
  if not isfinite(new.starts_at) then
    raise exception using errcode = '22007', message = 'A finite shift start is required.';
  end if;
  v_local_date := timezone(coalesce(nullif(new.timezone, ''), 'UTC'), new.starts_at)::date;

  if new.shift_date is null then
    new.shift_date := v_local_date;
  elsif tg_op = 'UPDATE'
    and new.shift_date is not distinct from old.shift_date
    and (new.starts_at is distinct from old.starts_at or new.timezone is distinct from old.timezone)
  then
    new.shift_date := v_local_date;
  elsif new.shift_date is distinct from v_local_date then
    raise exception using errcode = '22007', message = 'Shift date must match the local start date.';
  end if;
  return new;
end;
$function$;

alter table public.shifts add constraint shifts_finite_schedule_times_check check (
  isfinite(starts_at) and isfinite(ends_at) and isfinite(shift_date)
  and (checked_in_at is null or isfinite(checked_in_at))
  and (checked_out_at is null or isfinite(checked_out_at))
);
alter table public.shifts add constraint shifts_checkout_time_order_check check (
  checked_out_at is null or checked_out_at >= checked_in_at
);

commit;
