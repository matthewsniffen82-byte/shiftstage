begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A club can withdraw its listing without owning or deleting dancer accounts.
-- This is distinct from temporarily unpublishing a page for edits.
create table public.venue_participation_ends (
  venue_id uuid primary key references public.venues(id) on delete restrict,
  ended_by_user_id uuid not null references public.app_users(id) on delete restrict,
  ended_at timestamptz not null default clock_timestamp() check (isfinite(ended_at))
);
alter table public.venue_participation_ends enable row level security;
revoke all on public.venue_participation_ends from public, anon, authenticated, service_role;
grant select on public.venue_participation_ends to service_role;

alter table public.venue_dancer_affiliations
  add column reentry_blocked boolean not null default false;
update public.venue_dancer_affiliations a set reentry_blocked = true
from public.dancer_profiles d where d.id = a.dancer_id and a.status = 'revoked'
  and a.revoked_by_user_id is distinct from d.user_id;

create function public.cancel_departed_venue_shifts(p_venue_id uuid, p_dancer_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  update public.shifts set
    status = 'cancelled',
    checked_out_at = case when checked_in_at is not null then coalesce(checked_out_at, v_now) else null end,
    location_status = 'self_reported',
    location_verification_expires_at = case when checked_in_at is not null then v_now else location_verification_expires_at end,
    working_status = 'ended',
    commission_tracking_stopped_at = case when commission_tracking_started_at is not null then coalesce(commission_tracking_stopped_at, v_now) else commission_tracking_stopped_at end,
    ended_at = coalesce(ended_at, v_now), ended_reason = p_reason, updated_at = v_now
  where venue_id = p_venue_id and (p_dancer_id is null or dancer_id = p_dancer_id)
    and status in ('draft', 'posted')
    and (ends_at >= v_now or (checked_in_at is not null and checked_out_at is null));
  if exists (select 1 from public.shifts
    where venue_id = p_venue_id and (p_dancer_id is null or dancer_id = p_dancer_id)
      and status in ('draft', 'posted')
      and (ends_at >= v_now or (checked_in_at is not null and checked_out_at is null))) then
    raise exception 'Club check-in removal could not be confirmed.' using errcode = '40001';
  end if;
end;
$$;
revoke all on function public.cancel_departed_venue_shifts(uuid,uuid,text) from public, anon, authenticated, service_role;

-- Guard all writers, including older deployments and concurrent NFC requests.
create function public.guard_ended_venue_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active and exists (select 1 from public.venue_participation_ends where venue_id = new.id) then
    raise exception 'This club has left MyDancr. A new agreement must be reviewed before it can return.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_ended_venue_publication() from public, anon, authenticated, service_role;
create trigger guard_ended_venue_publication before insert or update of is_active on public.venues
for each row execute function public.guard_ended_venue_publication();

create function public.guard_dancer_venue_reentry()
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
create trigger guard_dancer_venue_reentry before insert or update on public.venue_dancer_affiliations
for each row execute function public.guard_dancer_venue_reentry();

create function public.guard_departed_venue_shift()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'posted' then return new; end if;
  -- Serialize publication with withdrawal and affiliation revocation. Existing
  -- historical rows are retained; only attempts to publish/reopen are checked.
  if tg_op = 'UPDATE' and new.status = old.status and new.venue_id = old.venue_id
    and new.dancer_id = old.dancer_id and new.starts_at = old.starts_at and new.ends_at = old.ends_at
    and new.checked_in_at is not distinct from old.checked_in_at
    and new.checked_out_at is not distinct from old.checked_out_at then return new; end if;
  perform id from public.venues where id = new.venue_id for share;
  if exists (select 1 from public.venue_participation_ends where venue_id = new.venue_id) then
    raise exception 'This club is no longer on MyDancr.' using errcode = '42501';
  end if;
  perform id from public.venue_dancer_affiliations
    where venue_id = new.venue_id and dancer_id = new.dancer_id for share;
  if exists (select 1 from public.venue_dancer_affiliations
    where venue_id = new.venue_id and dancer_id = new.dancer_id and status = 'revoked') then
    raise exception 'Your affiliation with this club has ended.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_departed_venue_shift() from public, anon, authenticated, service_role;
create trigger guard_departed_venue_shift before insert or update on public.shifts
for each row execute function public.guard_departed_venue_shift();

-- The reviewed revocation definition is replaced below, preserving its account
-- ownership checks and its explicit profileDeactivated=false result.

create or replace function public.revoke_dancer_venue_affiliation(
  p_affiliation_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
declare
  v_affiliation public.venue_dancer_affiliations;
  v_replacement public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service authorization required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_users where id = p_actor_user_id and account_state = 'active') then
    raise exception 'An active account is required.' using errcode = '42501';
  end if;

  -- Match the withdrawal lock order before locking the dancer association.
  perform v.id from public.venues v join public.venue_dancer_affiliations a on a.venue_id = v.id
    where a.id = p_affiliation_id for share of v;
  select * into v_affiliation
  from public.venue_dancer_affiliations
  where id = p_affiliation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue affiliation not found.';
  end if;

  select * into v_dancer
  from public.dancer_profiles
  where id = v_affiliation.dancer_id
  for update;

  select * into v_venue
  from public.venues
  where id = v_affiliation.venue_id;

  if p_actor_user_id is distinct from v_dancer.user_id
    and p_actor_user_id is distinct from v_venue.owner_user_id
    and not exists (select 1 from public.app_users where id = p_actor_user_id and role = 'admin' and account_state = 'active')
    and not exists (
      select 1
      from public.venue_team_members as member
      join public.app_users as account on account.id = member.user_id
      where member.venue_id = v_affiliation.venue_id
        and member.user_id = p_actor_user_id
        and member.status = 'active'
        and member.role = 'manager'
        and account.role = 'venue'
        and account.account_state = 'active'
    )
  then
    raise exception using errcode = '42501', message = 'Only the dancer or an authorized venue owner or manager can remove this affiliation.';
  end if;

  if v_affiliation.status = 'active' then
    update public.venue_dancer_affiliations
    set
      status = 'revoked',
      reentry_blocked = p_actor_user_id is distinct from v_dancer.user_id,
      revoked_by_user_id = p_actor_user_id,
      revoked_at = v_now,
      revoke_reason = coalesce(v_reason, 'Affiliation removed by an authorized account.'),
      updated_at = v_now
    where id = v_affiliation.id
    returning * into v_affiliation;

    perform public.cancel_departed_venue_shifts(v_affiliation.venue_id, v_affiliation.dancer_id, 'venue_affiliation_revoked');

    select * into v_replacement
    from public.venue_dancer_affiliations
    where dancer_id = v_affiliation.dancer_id
      and status = 'active'
      and revoked_at is null
      and venue_id in (select id from public.venues where is_active)
    order by approved_at asc
    limit 1;

    if found then
      update public.dancer_profiles
      set
        venue_approved_at = v_replacement.approved_at,
        venue_approved_by_user_id = v_replacement.approved_by_user_id,
        venue_approved_venue_id = v_replacement.venue_id
      where id = v_affiliation.dancer_id;
    else
      update public.dancer_profiles
      set
        venue_approved_at = null,
        venue_approved_by_user_id = null,
        venue_approved_venue_id = null
      where id = v_affiliation.dancer_id;
    end if;

    insert into public.venue_dancer_affiliation_events (
      affiliation_id,
      venue_id,
      dancer_id,
      actor_user_id,
      event_type,
      event_payload
    ) values (
      v_affiliation.id,
      v_affiliation.venue_id,
      v_affiliation.dancer_id,
      p_actor_user_id,
      'affiliation_revoked',
      jsonb_build_object('reason', v_affiliation.revoke_reason, 'profileDeactivated', false)
    );
  end if;

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'profileDeactivated', false,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$$;

revoke all on function public.revoke_dancer_venue_affiliation(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.revoke_dancer_venue_affiliation(uuid,uuid,text) to service_role;

create function public.end_venue_participation(p_actor_user_id uuid, p_venue_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_actor public.app_users%rowtype;
  v_venue public.venues%rowtype;
  v_end public.venue_participation_ends%rowtype;
  v_affiliation record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service authorization required.' using errcode = '42501';
  end if;
  select * into v_actor from public.app_users where id = p_actor_user_id for share;
  if not found or v_actor.account_state <> 'active' or v_actor.dmca_suspended_at is not null then
    raise exception 'An active account is required.' using errcode = '42501';
  end if;
  select * into v_venue from public.venues where id = p_venue_id for update;
  if not found or not (v_actor.role = 'admin' or (v_actor.role = 'venue' and v_venue.owner_user_id = p_actor_user_id)) then
    raise exception 'Only the club owner or MyDancr can remove this club.' using errcode = '42501';
  end if;
  insert into public.venue_participation_ends(venue_id, ended_by_user_id)
    values (p_venue_id, p_actor_user_id) on conflict (venue_id) do nothing;
  select * into strict v_end from public.venue_participation_ends where venue_id = p_venue_id;

  update public.venues set is_active = false, published_at = null where id = p_venue_id;
  if not exists (select 1 from public.venues where id = p_venue_id and not is_active and published_at is null) then
    raise exception 'Club removal could not be confirmed.' using errcode = '40001';
  end if;
  for v_affiliation in select id from public.venue_dancer_affiliations
    where venue_id = p_venue_id and status = 'active' order by id
  loop
    perform public.revoke_dancer_venue_affiliation(v_affiliation.id, p_actor_user_id, 'Club left MyDancr. Dancer account retained.');
  end loop;
  -- Also clear shifts whose old affiliation is already missing or revoked.
  perform public.cancel_departed_venue_shifts(p_venue_id, null, 'venue_left_mydancr');
  update public.nfc_tags set status = 'revoked', revoked_at = coalesce(revoked_at, v_end.ended_at)
    where venue_id = p_venue_id and status <> 'revoked';
  update public.dancer_nfc_enrollments set status = 'revoked', updated_at = clock_timestamp()
    where venue_id = p_venue_id and status = 'pending';
  update public.venue_dancer_verification_tokens set revoked_at = coalesce(revoked_at, v_end.ended_at)
    where venue_id = p_venue_id and used_at is null;
  if exists (select 1 from public.venue_dancer_affiliations where venue_id = p_venue_id and status = 'active')
    or exists (select 1 from public.shifts where venue_id = p_venue_id and status in ('posted','draft')
      and (ends_at >= clock_timestamp() or (checked_in_at is not null and checked_out_at is null)))
    or exists (select 1 from public.nfc_tags where venue_id = p_venue_id and status <> 'revoked')
    or exists (select 1 from public.dancer_nfc_enrollments where venue_id = p_venue_id and status = 'pending') then
    raise exception 'Club removal could not be confirmed.' using errcode = '40001';
  end if;
  return jsonb_build_object('venueId', p_venue_id, 'endedAt', v_end.ended_at, 'dancerAccountsPreserved', true);
end;
$$;
revoke all on function public.end_venue_participation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.end_venue_participation(uuid,uuid) to service_role;

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

-- Preserve current verified sessions, then withdraw scheduled appearances.
update public.shifts set shift_source = 'nfc_presence'
where shift_source = 'scheduled' and status = 'posted' and checked_in_at is not null
  and checked_out_at is null and location_status = 'club_confirmed'
  and location_verification_expires_at > clock_timestamp();
update public.shifts set status = 'cancelled', working_status = 'ended',
  checked_out_at = case when checked_in_at is not null then coalesce(checked_out_at, clock_timestamp()) else null end,
  ended_at = coalesce(ended_at, clock_timestamp()), ended_reason = 'upcoming_posts_retired', updated_at = clock_timestamp()
where shift_source = 'scheduled' and status in ('draft','posted')
  and (ends_at >= clock_timestamp() or (checked_in_at is not null and checked_out_at is null));

create function public.reject_upcoming_shift_posts()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.shift_source = 'scheduled' and new.status in ('draft','posted') then
    raise exception 'Upcoming posts are no longer available. Use a dressing-room tap to start Working Now.' using errcode = '42501';
  end if;
  if new.shift_source = 'nfc_presence' and new.status in ('draft','posted')
    and auth.role() is distinct from 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception 'Working Now can only be started by the check-in service.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_upcoming_shift_posts() from public, anon, authenticated, service_role;
create trigger reject_upcoming_shift_posts before insert or update on public.shifts
for each row execute function public.reject_upcoming_shift_posts();

notify pgrst, 'reload schema';
commit;
