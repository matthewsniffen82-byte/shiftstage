begin;

create table if not exists public.venue_pilot_night_reports (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  service_date date not null,
  total_door_count integer not null check (total_door_count >= 0 and total_door_count <= 1000000),
  pilot_cost_cents integer not null default 0 check (pilot_cost_cents >= 0 and pilot_cost_cents <= 100000000),
  notes text check (notes is null or char_length(notes) <= 500),
  reported_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, service_date)
);

create index if not exists venue_pilot_night_reports_venue_date_idx
  on public.venue_pilot_night_reports (venue_id, service_date desc);

alter table public.venue_pilot_night_reports enable row level security;

drop policy if exists "Admins manage venue pilot night reports" on public.venue_pilot_night_reports;
create policy "Admins manage venue pilot night reports"
  on public.venue_pilot_night_reports
  for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.touch_venue_pilot_night_report_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists venue_pilot_night_reports_touch_updated_at on public.venue_pilot_night_reports;
create trigger venue_pilot_night_reports_touch_updated_at
  before update on public.venue_pilot_night_reports
  for each row execute function public.touch_venue_pilot_night_report_updated_at();

comment on table public.venue_pilot_night_reports is
  'Admin-entered nightly venue totals used to measure pilot-attributable door traffic against verified cashier NFC arrivals.';
comment on column public.venue_pilot_night_reports.service_date is
  'Venue-local nightlife service date. Activity before 06:00 belongs to the previous service date.';

create or replace function public.upsert_venue_pilot_night_report(
  p_admin_id uuid,
  p_venue_id uuid,
  p_service_date date,
  p_total_door_count integer,
  p_pilot_cost_cents integer,
  p_notes text
)
returns public.venue_pilot_night_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.venue_pilot_night_reports;
begin
  if not exists (
    select 1 from public.app_users admin_user
    where admin_user.id = p_admin_id
      and admin_user.role = 'admin'
      and admin_user.account_state = 'active'
  ) then
    raise exception 'Admin access required.';
  end if;

  insert into public.venue_pilot_night_reports (
    venue_id,
    service_date,
    total_door_count,
    pilot_cost_cents,
    notes,
    reported_by_user_id
  ) values (
    p_venue_id,
    p_service_date,
    p_total_door_count,
    p_pilot_cost_cents,
    nullif(trim(p_notes), ''),
    p_admin_id
  )
  on conflict (venue_id, service_date) do update set
    total_door_count = excluded.total_door_count,
    pilot_cost_cents = excluded.pilot_cost_cents,
    notes = excluded.notes,
    reported_by_user_id = excluded.reported_by_user_id
  returning * into v_report;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_pilot_night_report',
    v_report.id,
    'upsert_pilot_night_report',
    p_service_date::text || ': ' || p_total_door_count::text || ' total door count'
  );

  return v_report;
end;
$$;

revoke all on function public.upsert_venue_pilot_night_report(uuid, uuid, date, integer, integer, text) from public, anon, authenticated;
grant execute on function public.upsert_venue_pilot_night_report(uuid, uuid, date, integer, integer, text) to service_role;

commit;
