do $$
declare
  expected_count integer := 17;
  listed_count integer;
begin
  select count(*)
  into listed_count
  from public.venues
  where slug in (
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

  if listed_count <> expected_count then
    raise exception 'Expected % listed Las Vegas demonstration venues, found %', expected_count, listed_count;
  end if;
end;
$$;

update public.venues
set
  address = '0000 MyDancr Ave, Las Vegas, NV 55555',
  city = 'Las Vegas',
  state = 'NV',
  updated_at = now()
where slug in (
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

do $$
begin
  if exists (
    select 1
    from public.venues
    where slug in (
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
    )
      and address is distinct from '0000 MyDancr Ave, Las Vegas, NV 55555'
  ) then
    raise exception 'Every listed Las Vegas demonstration venue must use the fictional pitch address';
  end if;
end;
$$;
