insert into public.venues (
  name,
  slug,
  city,
  state,
  address,
  timezone,
  latitude,
  longitude,
  is_active
)
values
  ('Spearmint Rhino Las Vegas', 'spearmint-rhino-las-vegas', 'Las Vegas', 'NV', '3340 S Highland Dr, Las Vegas, NV 89109', 'America/Los_Angeles', 36.129500, -115.178600, true),
  ('Sapphire Las Vegas', 'sapphire-las-vegas', 'Las Vegas', 'NV', '3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109', 'America/Los_Angeles', 36.135200, -115.171600, true),
  ('Crazy Horse 3', 'crazy-horse-3', 'Las Vegas', 'NV', '3525 W Russell Rd, Las Vegas, NV 89118', 'America/Los_Angeles', 36.085500, -115.185800, true),
  ('Palomino Club', 'palomino-club', 'Las Vegas', 'NV', '1848 Las Vegas Blvd N, North Las Vegas, NV 89030', 'America/Los_Angeles', 36.193200, -115.132000, true),
  ('HUSTLER Club Las Vegas', 'hustler-club-las-vegas', 'Las Vegas', 'NV', '6007 Dean Martin Dr, Las Vegas, NV 89118', 'America/Los_Angeles', 36.079900, -115.182200, true),
  ('Little Darlings Las Vegas', 'little-darlings-las-vegas', 'Las Vegas', 'NV', '1514 Western Ave, Las Vegas, NV 89102', 'America/Los_Angeles', 36.153800, -115.163400, true),
  ('Treasures Las Vegas', 'treasures-las-vegas', 'Las Vegas', 'NV', '2801 Westwood Dr, Las Vegas, NV 89109', 'America/Los_Angeles', 36.139000, -115.174000, true),
  ('Chicas Bonitas', 'chicas-bonitas', 'Las Vegas', 'NV', '3606 Procyon St, Las Vegas, NV 89103', 'America/Los_Angeles', 36.124300, -115.187700, true),
  ('Peppermint Hippo Las Vegas', 'peppermint-hippo-las-vegas', 'Las Vegas', 'NV', '4316 Paradise Rd, Las Vegas, NV 89169', 'America/Los_Angeles', 36.111000, -115.153900, true)
on conflict (slug) do update
set
  name = excluded.name,
  city = excluded.city,
  state = excluded.state,
  address = excluded.address,
  timezone = excluded.timezone,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  is_active = true,
  updated_at = now();
