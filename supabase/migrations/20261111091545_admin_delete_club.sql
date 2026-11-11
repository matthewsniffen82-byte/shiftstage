set local lock_timeout = '5s';

alter table public.venues add column admin_deleted_at timestamptz,
  add constraint deleted_club_stays_closed check (
    admin_deleted_at is null or (not is_active and published_at is null and owner_user_id is null)
  );
grant update (admin_deleted_at) on public.venues to service_role;

create function public.admin_delete_club(p_actor uuid, p_venue uuid, p_confirm_name text)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  club public.venues%rowtype;
  deleted_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service authorization required.' using errcode = '42501';
  end if;
  perform 1 from public.app_users where id = p_actor and role = 'admin'
    and admin_workspace_role = 'owner' and account_state = 'active' and dmca_suspended_at is null for share;
  if not found then
    raise exception 'Site owner access required.' using errcode = '42501';
  end if;

  select * into club from public.venues where id = p_venue for update;
  if not found then raise exception 'Club not found.' using errcode = 'P0002'; end if;
  if btrim(club.name) is distinct from btrim(p_confirm_name) then
    raise exception 'Club name does not match.' using errcode = '22023';
  end if;
  deleted_at := club.admin_deleted_at;
  if deleted_at is null then
    perform public.end_venue_participation(p_actor, p_venue);
    update public.venue_team_members set status = 'removed', removed_at = now(), updated_at = now()
      where venue_id = p_venue and status = 'active';
    update public.venue_team_invitations set revoked_at = now()
      where venue_id = p_venue and revoked_at is null and accepted_at is null;
    update public.venue_claim_codes set revoked_at = now(), revoked_by = p_actor
      where venue_id = p_venue and revoked_at is null and used_at is null;
    update public.internal_roster_links set active = false where venue_id = p_venue and active;
    update public.venues set admin_deleted_at = now(), owner_user_id = null
      where id = p_venue returning admin_deleted_at into strict deleted_at;
    insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
      values (p_actor, 'venue', p_venue, 'delete_club', club.name);
  end if;
  return jsonb_build_object('venueId', p_venue, 'deletedAt', deleted_at);
end;
$$;
revoke all on function public.admin_delete_club(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_club(uuid, uuid, text) to service_role;
