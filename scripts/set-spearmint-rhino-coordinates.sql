-- Fill the missing destination used by MyDancr's club-distance calculation.
-- Source checked 2026-10-24: https://spearmintrhinolv.com/contact/
-- The official page's Google Maps place link identifies the club with
-- !3d36.1289282!4d-115.1783956 (the place pin, not the map's viewport center).
-- Store six decimal places to match the existing coordinate columns.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $$
declare
  rhino public.venues%rowtype;
begin
  select * into rhino from public.venues
    where id = '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'
      and slug = 'talk-of-the-town' and name = 'Spearmint Rhino'
      and city = 'Las Vegas' and is_active
      and address = '3340 S Highland Dr, Las Vegas, NV 89109'
    for update;
  if not found then
    raise exception 'Expected the active Rhino club at its verified address';
  end if;

  if rhino.latitude is null and rhino.longitude is null then
    update public.venues
      set latitude = 36.128928, longitude = -115.178396, updated_at = now()
      where id = rhino.id;
  elsif rhino.latitude is distinct from 36.128928
    or rhino.longitude is distinct from -115.178396 then
    raise exception 'Existing Rhino coordinates differ; review before replacing them';
  end if;
end $$;

commit;
