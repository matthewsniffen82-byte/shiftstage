-- Fictional venue identities for the clearly labeled MyDancr pitch environment.
-- Venue IDs remain unchanged so schedules, affiliations, deals, NFC inventory,
-- ownership, analytics, and finance records keep their production relationships.

with fictional_venues (slug, fictional_name) as (
  values
    ('centerfolds-cabaret-las-vegas', 'Neon Ember'),
    ('chicas-bonitas', 'Velvet Orbit'),
    ('crazy-horse-3', 'Electric Mirage'),
    ('deja-vu-showgirls', 'Afterglow Social'),
    ('deja-vu-showgirls-las-vegas', 'Violet Hour'),
    ('hustler-club-las-vegas', 'Lunar House'),
    ('little-darlings', 'Prism Room'),
    ('little-darlings-las-vegas', 'Golden Halo'),
    ('palomino-club', 'Midnight Current'),
    ('peppermint-hippo-las-vegas', 'Nova Lounge'),
    ('play-it-again-sams', 'Silver Circuit'),
    ('sapphire-las-vegas', 'Blue Ember'),
    ('spearmint-rhino', 'Radiant Room'),
    ('spearmint-rhino-las-vegas', 'Moonline Social'),
    ('talk-of-the-town', 'Echo House'),
    ('the-library-gentlemens-club', 'Starlight Club'),
    ('treasures-las-vegas', 'Aurora Room')
)
update public.venues as venue
set
  name = fictional_venues.fictional_name,
  phone = null,
  website = null,
  updated_at = now()
from fictional_venues
where venue.slug = fictional_venues.slug
  and lower(trim(venue.city)) = 'las vegas';

do $$
declare
  unmapped_count integer;
begin
  select count(*)
  into unmapped_count
  from public.venues
  where lower(trim(city)) = 'las vegas'
    and slug not in (
      'centerfolds-cabaret-las-vegas',
      'chicas-bonitas',
      'crazy-horse-3',
      'deja-vu-showgirls',
      'deja-vu-showgirls-las-vegas',
      'hustler-club-las-vegas',
      'little-darlings',
      'little-darlings-las-vegas',
      'palomino-club',
      'peppermint-hippo-las-vegas',
      'play-it-again-sams',
      'sapphire-las-vegas',
      'spearmint-rhino',
      'spearmint-rhino-las-vegas',
      'talk-of-the-town',
      'the-library-gentlemens-club',
      'treasures-las-vegas'
    );

  if unmapped_count > 0 then
    raise exception 'Every Las Vegas venue must receive an explicit fictional identity; % remain unmapped.', unmapped_count;
  end if;
end
$$;
