-- Published venues must have verified map coordinates so city radius filtering,
-- directions, and physical venue operations use the intended location.

update public.venues
set
  latitude = 36.135360,
  longitude = -115.174890,
  updated_at = now()
where slug = 'scores-las-vegas'
  and (latitude is null or longitude is null);

alter table public.venues
  drop constraint if exists venues_published_coordinates_required;

alter table public.venues
  add constraint venues_published_coordinates_required
  check (
    is_active is not true
    or (
      latitude is not null
      and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  ) not valid;

alter table public.venues
  validate constraint venues_published_coordinates_required;

comment on constraint venues_published_coordinates_required on public.venues is
  'A venue cannot be published until MyDancr records valid verified map coordinates.';
