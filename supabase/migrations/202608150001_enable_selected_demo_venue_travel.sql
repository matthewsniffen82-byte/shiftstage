with travel_destinations(slug, address, latitude, longitude) as (
  values
    ('deja-vu-showgirls-las-vegas', '3247 S Sammy Davis Jr Dr, Las Vegas, NV 89109', 36.130900::double precision, -115.174800::double precision),
    ('little-darlings-las-vegas', '1514 Western Ave, Las Vegas, NV 89102', 36.153800::double precision, -115.163400::double precision),
    ('peppermint-hippo-las-vegas', '4316 Paradise Rd, Las Vegas, NV 89169', 36.111000::double precision, -115.153900::double precision),
    ('sapphire-las-vegas', '3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109', 36.135200::double precision, -115.171600::double precision),
    ('spearmint-rhino-las-vegas', '3340 S Highland Dr, Las Vegas, NV 89109', 36.129500::double precision, -115.178600::double precision)
)
update public.venues as venue
set
  address = destination.address,
  city = 'Las Vegas',
  state = 'NV',
  latitude = destination.latitude,
  longitude = destination.longitude,
  updated_at = now()
from travel_destinations as destination
where venue.slug = destination.slug;

do $$
declare
  active_destination_count integer;
begin
  select count(*)
  into active_destination_count
  from public.venues
  where (slug, address) in (
    ('deja-vu-showgirls-las-vegas', '3247 S Sammy Davis Jr Dr, Las Vegas, NV 89109'),
    ('little-darlings-las-vegas', '1514 Western Ave, Las Vegas, NV 89102'),
    ('peppermint-hippo-las-vegas', '4316 Paradise Rd, Las Vegas, NV 89169'),
    ('sapphire-las-vegas', '3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109'),
    ('spearmint-rhino-las-vegas', '3340 S Highland Dr, Las Vegas, NV 89109')
  );

  if active_destination_count <> 5 then
    raise exception 'Expected five demonstration venues with active travel destinations, found %', active_destination_count;
  end if;
end;
$$;
