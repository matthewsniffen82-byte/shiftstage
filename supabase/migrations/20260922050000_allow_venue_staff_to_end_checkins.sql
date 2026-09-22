begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Checkout is separate from roster removal: preserve affiliation, identity,
-- media, and the original tap/cooldown. Authorization and audit are atomic.
create function public.end_venue_dancer_checkin(p_actor_user_id uuid, p_venue_id uuid, p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_owner uuid;
  v_role text;
  v_shift public.shifts%rowtype;
  v_ended_at timestamptz;
  v_log_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server authorization is required.' using errcode = '42501';
  end if;
  perform id from public.app_users where id = p_actor_user_id and role = 'venue'
    and account_state = 'active' and dmca_suspended_at is null for share;
  if not found then raise exception 'An active club account is required.' using errcode = '42501'; end if;

  select owner_user_id into v_owner from public.venues where id = p_venue_id and is_active for share;
  if not found or exists(select 1 from public.venue_participation_ends where venue_id = p_venue_id) then
    raise exception 'An active participating club is required.' using errcode = '42501';
  end if;
  perform id from public.app_users where id = v_owner and role = 'venue'
    and account_state = 'active' and dmca_suspended_at is null for share;
  if not found then raise exception 'An active club owner is required.' using errcode = '42501'; end if;
  if v_owner = p_actor_user_id then
    v_role := 'owner';
  else
    select role into v_role from public.venue_team_members where venue_id = p_venue_id
      and user_id = p_actor_user_id and status = 'active' and role in ('manager', 'staff') for share;
    if not found then raise exception 'Only this club team can end its check-ins.' using errcode = '42501'; end if;
  end if;

  -- Exact session and venue scope prevents stale screens ending a newer tap.
  select * into v_shift from public.shifts where id = p_shift_id and venue_id = p_venue_id for update;
  if not found then raise exception 'Check-in not found at this club.' using errcode = 'P0002'; end if;
  if v_shift.shift_source = 'demo_locked' or v_shift.checked_in_at is null then
    raise exception 'This session cannot be checked out here.' using errcode = '22023';
  end if;
  if v_shift.checked_out_at is not null then
    return jsonb_build_object('shiftId', v_shift.id, 'venueId', v_shift.venue_id,
      'dancerId', v_shift.dancer_id, 'checkedOutAt', v_shift.checked_out_at, 'alreadyEnded', true);
  end if;
  if v_shift.status <> 'posted' or v_shift.shift_source <> 'nfc_presence'
    or v_shift.location_verification_expires_at is null then
    raise exception 'Only a confirmed tap session can be checked out.' using errcode = '22023';
  end if;
  v_ended_at := greatest(v_shift.checked_in_at, least(clock_timestamp(), v_shift.location_verification_expires_at));
  update public.shifts set checked_out_at = v_ended_at,
    location_verification_expires_at = v_ended_at, working_status = 'ended',
    ended_at = v_ended_at, ended_reason = 'venue_checkout',
    commission_tracking_stopped_at = case when commission_tracking_started_at is not null
      then coalesce(commission_tracking_stopped_at, v_ended_at) else commission_tracking_stopped_at end
    where id = p_shift_id and venue_id = p_venue_id and checked_out_at is null
    returning * into v_shift;
  if not found or v_shift.checked_out_at is distinct from v_ended_at
    or v_shift.location_verification_expires_at is distinct from v_ended_at
    or v_shift.working_status is distinct from 'ended' then
    raise exception 'Check-out could not be confirmed.' using errcode = '40001';
  end if;
  insert into public.venue_activity_log(venue_id, actor_user_id, actor_role, action, target_type, target_id, summary, metadata)
    values(p_venue_id, p_actor_user_id, v_role, 'dancer_checkin_ended', 'shift', p_shift_id::text,
      'Ended a dancer check-in. Club approval and dancer account preserved.',
      jsonb_build_object('dancerId', v_shift.dancer_id, 'checkedOutAt', v_ended_at))
    returning id into v_log_id;
  if v_log_id is null then raise exception 'Check-out audit could not be confirmed.' using errcode = '40001'; end if;
  return jsonb_build_object('shiftId', v_shift.id, 'venueId', v_shift.venue_id,
    'dancerId', v_shift.dancer_id, 'checkedOutAt', v_shift.checked_out_at, 'alreadyEnded', false);
end;
$$;
revoke all on function public.end_venue_dancer_checkin(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.end_venue_dancer_checkin(uuid,uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
