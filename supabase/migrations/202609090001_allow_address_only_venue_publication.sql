-- A venue address is sufficient for publication. Coordinates are optional metadata.
alter table public.venues
  drop constraint if exists venues_published_coordinates_required;

-- Remove Club B's confirmed placeholder coordinates, which placed this Las Vegas
-- venue thousands of miles outside its city and hid it from local discovery.
-- Match the exact old values so later location corrections are never overwritten.
update public.venues
set latitude = null, longitude = null, updated_at = now()
where id = 'c622a577-2d8e-4577-a99c-acfda11fa870'
  and slug = 'club-b'
  and city = 'Las Vegas'
  and latitude = 5
  and longitude = 100;
