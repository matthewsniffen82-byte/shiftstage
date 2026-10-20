-- User-requested account reassignment. Keep both club records and Rhino's owner.
-- Before this change, the account owned inactive LVDemoClub and had no team membership.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $$
declare
  account_id constant uuid := 'e7adabbd-5d07-46ba-bb18-0081094162fb';
  rhino_id constant uuid := '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af';
  previous_club_id constant uuid := '0a24428d-3bd7-46fe-b933-a97796200b54';
begin
  perform 1 from public.app_users
    where id = account_id and lower(email) = 'democlub@mydancr.com'
      and role = 'venue' and account_state = 'active'
    for update;
  if not found then raise exception 'Expected the active demo club account'; end if;

  perform 1 from public.venues v join public.app_users owner_account on owner_account.id = v.owner_user_id
    where v.id = rhino_id and v.slug = 'talk-of-the-town' and v.name = 'Spearmint Rhino'
      and v.city = 'Las Vegas' and v.is_active
      and v.owner_user_id = '02b3af5c-779e-4d3c-af08-b70ae0b31de5'
      and owner_account.role = 'venue' and owner_account.account_state = 'active'
    for update of v, owner_account;
  if not found then raise exception 'Expected the active Rhino club and its current owner'; end if;

  perform 1 from public.venues
    where id = previous_club_id and slug = 'lvdemoclub' and not is_active
      and (owner_user_id = account_id or owner_user_id is null)
    for update;
  if not found then raise exception 'Previous club changed; review before reassigning'; end if;

  if exists (select 1 from public.venues where owner_user_id = account_id and id <> previous_club_id)
    or exists (select 1 from public.venue_team_members where user_id = account_id and status = 'active' and venue_id <> rhino_id)
  then raise exception 'Account has unexpected club access'; end if;

  -- Owned clubs take precedence over team memberships in getVenueAccess.
  update public.venues set owner_user_id = null, updated_at = now()
    where id = previous_club_id and owner_user_id = account_id;

  insert into public.venue_team_members (venue_id, user_id, role, status)
    values (rhino_id, account_id, 'manager', 'active')
    on conflict (venue_id, user_id) do update
      set role = 'manager', status = 'active', removed_at = null, updated_at = now();

  update public.app_users set display_name = 'Spearmint Rhino', updated_at = now()
    where id = account_id and display_name in ('LVDemoClub', 'Spearmint Rhino');

  if exists (select 1 from public.venues where owner_user_id = account_id)
    or not exists (select 1 from public.venue_team_members
      where user_id = account_id and venue_id = rhino_id and role = 'manager' and status = 'active')
  then raise exception 'Rhino account reassignment did not verify'; end if;
end $$;

commit;
