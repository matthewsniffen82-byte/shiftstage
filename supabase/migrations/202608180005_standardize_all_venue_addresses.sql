create or replace function public.mydancr_placeholder_venue_address(
  venue_city text,
  venue_state text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    ', ',
    '0000 MyDancr Ave',
    nullif(btrim(venue_city), ''),
    case
      when nullif(btrim(venue_state), '') is not null
        then btrim(venue_state) || ' 55555'
      else '55555'
    end
  );
$$;

create or replace function public.enforce_mydancr_placeholder_venue_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.address := public.mydancr_placeholder_venue_address(new.city, new.state);
  return new;
end;
$$;

revoke execute on function public.enforce_mydancr_placeholder_venue_address() from public, anon, authenticated;

drop trigger if exists venues_enforce_mydancr_placeholder_address on public.venues;
create trigger venues_enforce_mydancr_placeholder_address
  before insert or update of address, city, state
  on public.venues
  for each row
  execute function public.enforce_mydancr_placeholder_venue_address();

update public.venues as venue
set
  address = public.mydancr_placeholder_venue_address(venue.city, venue.state),
  updated_at = now()
where venue.address is distinct from public.mydancr_placeholder_venue_address(venue.city, venue.state);

do $$
begin
  if exists (
    select 1
    from public.venues as venue
    where venue.address is distinct from public.mydancr_placeholder_venue_address(venue.city, venue.state)
  ) then
    raise exception 'Every venue must use the MyDancr placeholder street address and 55555 ZIP code';
  end if;
end;
$$;
