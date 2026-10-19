-- Use the club's brand name; Las Vegas remains in the separate city field.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $$
declare
  club_owner uuid;
begin
  update public.venues
    set name = 'Spearmint Rhino', updated_at = now()
    where id = '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'
      and slug = 'talk-of-the-town' and city = 'Las Vegas' and is_active
      and name in ('Spearmint Rhino Las Vegas', 'Spearmint Rhino')
    returning owner_user_id into club_owner;
  if not found then
    raise exception 'Expected the active consolidated Rhino club';
  end if;

  update public.app_users
    set display_name = 'Spearmint Rhino', updated_at = now()
    where id = club_owner
      and display_name in ('Spearmint Rhino Las Vegas', 'Spearmint Rhino');
  if not found then
    raise exception 'Expected the matching Rhino account display name';
  end if;
end $$;

commit;
