alter table public.venues
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6);

alter table public.venues
  add constraint venues_latitude_range check (latitude is null or latitude between -90 and 90),
  add constraint venues_longitude_range check (longitude is null or longitude between -180 and 180);

alter table public.shifts
  add column if not exists location_status text not null default 'self_reported',
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_out_at timestamptz,
  add column if not exists checkin_latitude numeric(9,6),
  add column if not exists checkin_longitude numeric(9,6),
  add column if not exists checkin_distance_feet numeric(8,2);

alter table public.shifts
  add constraint shifts_location_status_check check (location_status in ('self_reported', 'location_confirmed', 'club_confirmed')),
  add constraint shifts_checkin_latitude_range check (checkin_latitude is null or checkin_latitude between -90 and 90),
  add constraint shifts_checkin_longitude_range check (checkin_longitude is null or checkin_longitude between -180 and 180),
  add constraint shifts_checkout_after_checkin check (checked_out_at is null or checked_in_at is not null);

create index if not exists shifts_location_status_idx on public.shifts(location_status);
create index if not exists shifts_checked_in_idx on public.shifts(checked_in_at);
