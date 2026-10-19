begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Owner routes supply the authenticated dancer ID. No public/client RPC access.
create function public.get_dancer_shift_ranking_progress(p_dancer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with active as (
    select s.id,
      c.visibility channel,p.visibility preference,
      w.external_roster_observed_at,w.external_roster_periods,w.both_roster_periods,
      w.external_roster_started_at,w.both_roster_started_at,greatest(w.started_at,s.checked_in_at) lo,
      least(now(),w.expires_at,w.closed_at,s.location_verification_expires_at) hi
    from public.shifts s
    left join public.dancer_shift_channels c on c.shift_id=s.id and c.dancer_id=s.dancer_id and c.venue_id=s.venue_id
    left join public.dancer_channel_preferences p on p.dancer_id=s.dancer_id
    left join public.venue_dancer_work_sessions w on w.shift_id=s.id and w.dancer_id=s.dancer_id and w.venue_id=s.venue_id
      and w.dancer_check_in_at is not null and w.expires_at>s.checked_in_at
    where s.dancer_id=p_dancer_id and s.status='posted' and s.checked_in_at is not null
      and s.checked_out_at is null and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
  ), periods as (
    select id,channel,preference,external_roster_observed_at,
      case when hi>lo then
        ((coalesce(both_roster_periods,'{}') + coalesce(external_roster_periods,'{}'))
          * tstzmultirange(tstzrange(lo,hi,'[)')))
        + case when both_roster_started_at<hi then tstzmultirange(tstzrange(greatest(lo,both_roster_started_at),hi,'[)')) else '{}'::tstzmultirange end
        + case when external_roster_started_at<hi then tstzmultirange(tstzrange(greatest(lo,external_roster_started_at),hi,'[)')) else '{}'::tstzmultirange end
        else '{}'::tstzmultirange end recorded
    from active
  ), totals as (
    select id,channel,preference,bool_or(external_roster_observed_at is not null) observed,
      range_agg(recorded) recorded from periods group by id,channel,preference
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'shiftId',id,
    'visibility',case when channel=preference then channel
      when channel='both' then preference when preference='both' then channel else null end,
    'externalHours',case when observed or recorded<>'{}'::tstzmultirange
      then coalesce((select sum(extract(epoch from(upper(r)-lower(r))))/3600 from unnest(recorded) r),0) else null end
  )),'[]'::jsonb) from totals;
$$;
revoke all on function public.get_dancer_shift_ranking_progress(uuid) from public,anon,authenticated;
grant execute on function public.get_dancer_shift_ranking_progress(uuid) to service_role;

-- This changes an already verified, active Internal session. It never creates,
-- refreshes or extends presence, and cannot bypass a cooldown or a club revocation.
create function public.enable_dancer_shift_both(p_dancer_user_id uuid,p_shift_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare
  dancer public.dancer_profiles;
  shift public.shifts;
  channel text;
  preference text;
  changed boolean;
begin
  if p_dancer_user_id is null or p_shift_id is null then
    raise exception 'INVALID_SHIFT' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:' || p_dancer_user_id::text,0));
  perform 1 from public.app_users where id=p_dancer_user_id and role='dancer' and account_state='active' for update;
  if not found then raise exception 'DANCER_UNAVAILABLE' using errcode='42501'; end if;
  select * into dancer from public.dancer_profiles where user_id=p_dancer_user_id for update;
  if not found or dancer.status<>'approved' or dancer.verification_status<>'approved'
    or dancer.approved_at is null or dancer.venue_approved_at is null
    or dancer.disabled_at is not null or dancer.admin_disabled_at is not null
    or nullif(trim(dancer.avatar_storage_path),'') is null then
    raise exception 'PROFILE_APPROVAL_REQUIRED' using errcode='42501';
  end if;
  perform 1 from public.dancer_age_verifications where user_id=p_dancer_user_id
    and provider='ondato' and status='verified' and verified_at<=clock_timestamp() for share;
  if not found then raise exception 'AGE_VERIFICATION_REQUIRED' using errcode='42501'; end if;
  select * into shift from public.shifts where id=p_shift_id and dancer_id=dancer.id for update;
  if not found then raise exception 'SHIFT_NOT_FOUND' using errcode='P0002'; end if;
  if shift.status<>'posted' or shift.checked_in_at is null or shift.checked_out_at is not null
    or shift.location_status is distinct from 'club_confirmed' or shift.shift_source='demo_locked'
    or shift.nfc_tag_id is null or shift.location_verification_expires_at is null
    or shift.location_verification_expires_at<=clock_timestamp() then
    raise exception 'ACTIVE_VERIFIED_SHIFT_REQUIRED' using errcode='40001';
  end if;
  perform 1 from public.venues v join public.app_users u on u.id=v.owner_user_id
    where v.id=shift.venue_id and v.is_active and u.role='venue' and u.account_state='active' for share of v,u;
  if not found then raise exception 'CLUB_UNAVAILABLE' using errcode='42501'; end if;
  perform 1 from public.venue_dancer_affiliations where dancer_id=dancer.id and venue_id=shift.venue_id
    and status='active' and revoked_at is null for share;
  if not found then raise exception 'CLUB_APPROVAL_REQUIRED' using errcode='42501'; end if;
  perform 1 from public.venue_dancer_work_sessions where shift_id=shift.id and dancer_id=dancer.id and venue_id=shift.venue_id
    and dancer_check_in_at is not null and closed_at is null and expires_at>clock_timestamp();
  if not found then raise exception 'ACTIVE_VERIFIED_SHIFT_REQUIRED' using errcode='40001'; end if;
  select visibility into preference from public.dancer_channel_preferences where dancer_id=dancer.id for update;
  select visibility into channel from public.dancer_shift_channels
    where shift_id=shift.id and dancer_id=dancer.id and venue_id=shift.venue_id for update;
  if preference is null or channel is null or preference not in ('internal','both') or channel not in ('internal','both') then
    raise exception 'INTERNAL_SHIFT_REQUIRED' using errcode='40001';
  end if;
  changed := preference<>'both' or channel<>'both';
  if changed then
    update public.dancer_channel_preferences set visibility='both',selected_at=clock_timestamp() where dancer_id=dancer.id;
    update public.dancer_shift_channels set visibility='both',selected_at=clock_timestamp() where shift_id=shift.id;
    -- Matches the explicit Both choice at the dressing-room sticker. Retrying
    -- an already-applied switch must not undo a subsequent Incognito choice.
    update public.dancer_profiles set is_public=true where id=dancer.id returning * into dancer;
    if not dancer.is_public then raise exception 'PUBLICATION_NOT_CONFIRMED' using errcode='40001'; end if;
  end if;
  return jsonb_build_object('shiftId',shift.id,'visibility','both','changed',changed,
    'isPublic',dancer.is_public,'workingUntil',shift.location_verification_expires_at);
end;
$$;
revoke all on function public.enable_dancer_shift_both(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enable_dancer_shift_both(uuid,uuid) to service_role;
commit;
