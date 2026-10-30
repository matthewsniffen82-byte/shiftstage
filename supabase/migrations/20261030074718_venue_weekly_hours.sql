-- Nullable for older clients and clubs whose hours have not been configured.
create function public.valid_venue_weekly_hours(hours jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare day jsonb;
begin
  if hours is null then return true; end if;
  if jsonb_typeof(hours) <> 'array' then return false; end if;
  if jsonb_array_length(hours) <> 7 then return false; end if;
  for day in select value from jsonb_array_elements(hours) loop
    if jsonb_typeof(day) <> 'object' then return false; end if;
    if day->>'mode' in ('closed', '24-hours') then
      if day - 'mode' <> '{}'::jsonb then return false; end if;
    elsif day->>'mode' = 'custom' then
      if jsonb_typeof(day->'opensAt') is distinct from 'string'
        or jsonb_typeof(day->'closesAt') is distinct from 'string'
        or (day->>'opensAt') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or (day->>'closesAt') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or day->>'opensAt' = day->>'closesAt'
        or day - array['mode', 'opensAt', 'closesAt'] <> '{}'::jsonb then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.valid_venue_weekly_hours(jsonb) from public;
grant execute on function public.valid_venue_weekly_hours(jsonb) to authenticated, service_role;

alter table public.venues add column weekly_hours jsonb,
  add constraint venues_weekly_hours_valid check (public.valid_venue_weekly_hours(weekly_hours));
comment on column public.venues.weekly_hours is 'Sunday-first array of seven days: closed, 24-hours, or custom with HH:MM opensAt/closesAt. Overnight closing belongs to the opening day. Null uses legacy hours.';

update public.venues v set weekly_hours = (
  select jsonb_agg(case
    when not day = any(v.open_days) then jsonb_build_object('mode','closed')
    when v.opens_at = v.closes_at then jsonb_build_object('mode','24-hours')
    else jsonb_build_object('mode','custom','opensAt',to_char(v.opens_at,'HH24:MI'),'closesAt',to_char(v.closes_at,'HH24:MI'))
  end order by day) from generate_series(0,6) day
) where opens_at is not null and closes_at is not null;

grant select(weekly_hours) on public.venues to anon, authenticated;
grant select(weekly_hours), insert(weekly_hours), update(weekly_hours) on public.venues to service_role;
notify pgrst, 'reload schema';
