begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Restore club permission for reconnecting after roster removal. The intervening
-- migration remains in the ledger because it was already applied.
create or replace function public.guard_dancer_venue_reentry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'active' then return new; end if;
  perform id from public.venues where id = new.venue_id for share;
  if exists (select 1 from public.venue_participation_ends where venue_id = new.venue_id) then
    raise exception 'This club is no longer on MyDancr.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'revoked' and old.reentry_blocked then
    raise exception 'This club removed your access. Ask the club to allow a new tap before checking in again.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_dancer_venue_reentry() from public, anon, authenticated, service_role;

create function public.allow_dancer_venue_retap(p_actor_user_id uuid, p_affiliation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_affiliation public.venue_dancer_affiliations%rowtype;
begin
  if auth.role() is distinct from 'service_role' or not exists (
    select 1 from public.app_users where id = p_actor_user_id and account_state = 'active' and dmca_suspended_at is null
  ) then raise exception 'An active authorized account is required.' using errcode = '42501'; end if;
  perform v.id from public.venues v join public.venue_dancer_affiliations a on a.venue_id = v.id
    where a.id = p_affiliation_id for share of v;
  select * into v_affiliation from public.venue_dancer_affiliations where id = p_affiliation_id for update;
  if not found or not exists (
    select 1 from public.venues v where v.id = v_affiliation.venue_id and v.is_active and (
      v.owner_user_id = p_actor_user_id
      or exists (select 1 from public.app_users where id = p_actor_user_id and role = 'admin')
      or exists (select 1 from public.venue_team_members m join public.app_users a on a.id = m.user_id
        where m.venue_id = v.id and m.user_id = p_actor_user_id and m.status = 'active' and m.role = 'manager' and a.role = 'venue')
    )
  ) or exists (select 1 from public.venue_participation_ends where venue_id = v_affiliation.venue_id) then
    raise exception 'Only this club can allow a new tap.' using errcode = '42501';
  end if;
  update public.venue_dancer_affiliations set reentry_blocked = false, updated_at = clock_timestamp()
    where id = p_affiliation_id and status = 'revoked';
  if exists (select 1 from public.venue_dancer_affiliations where id = p_affiliation_id and reentry_blocked) then
    raise exception 'New tap permission could not be confirmed.' using errcode = '40001';
  end if;
  return jsonb_build_object('id', p_affiliation_id, 'venueId', v_affiliation.venue_id, 'requiresNewTap', true);
end;
$$;
revoke all on function public.allow_dancer_venue_retap(uuid,uuid) from public, anon, authenticated;
grant execute on function public.allow_dancer_venue_retap(uuid,uuid) to service_role;

-- Removal during the temporary tap-only policy must also require permission.
-- Do not reactivate memberships or alter dancer accounts and media.
update public.venue_dancer_affiliations a set reentry_blocked = true
from public.dancer_profiles d where d.id = a.dancer_id and a.status = 'revoked'
  and a.revoked_by_user_id is distinct from d.user_id;

notify pgrst, 'reload schema';
commit;
