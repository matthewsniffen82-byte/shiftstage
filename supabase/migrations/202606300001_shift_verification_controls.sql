alter table public.shifts
  add column if not exists working_status text not null default 'self_reported',
  add column if not exists commission_tracking_started_at timestamptz,
  add column if not exists commission_tracking_stopped_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists ended_reason text,
  add column if not exists checkout_latitude numeric(9,6),
  add column if not exists checkout_longitude numeric(9,6),
  add column if not exists shift_summary jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shifts_working_status_check'
      and conrelid = 'public.shifts'::regclass
  ) then
    alter table public.shifts
      add constraint shifts_working_status_check
      check (working_status in ('self_reported', 'checked_in', 'ended', 'club_confirmed'));
  end if;
end $$;

create index if not exists shifts_working_status_idx on public.shifts (working_status);
create index if not exists shifts_ended_at_idx on public.shifts (ended_at);
create index if not exists shifts_commission_tracking_started_at_idx on public.shifts (commission_tracking_started_at);
