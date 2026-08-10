begin;

create or replace function public.authorize_dancer_profile_from_nfc(
  p_dancer_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enrollment public.dancer_nfc_enrollments;
  v_venue public.venues;
  v_profile public.dancer_profiles;
  v_affiliation public.venue_dancer_affiliations;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1
    from public.app_users account
    where account.id = p_dancer_user_id
      and account.role = 'dancer'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active dancer account is required.';
  end if;

  select enrollment.* into v_enrollment
  from public.dancer_nfc_enrollments enrollment
  where enrollment.dancer_user_id = p_dancer_user_id
    and (
      enrollment.status = 'completed'
      or (enrollment.status = 'pending' and enrollment.expires_at > v_now)
    )
  order by enrollment.tapped_at desc
  limit 1;

  if not found then
    return jsonb_build_object('authorized', false, 'reason', 'no_nfc_enrollment');
  end if;

  select venue.* into v_venue
  from public.venues venue
  join public.app_users owner on owner.id = venue.owner_user_id
  where venue.id = v_enrollment.venue_id
    and venue.is_active = true
    and owner.role = 'venue'
    and owner.account_state = 'active';

  if not found then
    return jsonb_build_object('authorized', false, 'reason', 'inactive_venue');
  end if;

  update public.dancer_profiles dancer set
    venue_approved_at = coalesce(dancer.venue_approved_at, v_enrollment.tapped_at),
    venue_approved_by_user_id = coalesce(dancer.venue_approved_by_user_id, v_venue.owner_user_id),
    venue_approved_venue_id = coalesce(dancer.venue_approved_venue_id, v_venue.id),
    updated_at = v_now
  where dancer.user_id = p_dancer_user_id
    and dancer.status not in ('rejected', 'disabled')
    and dancer.disabled_at is null
  returning dancer.* into v_profile;

  if not found then
    return jsonb_build_object(
      'authorized', false,
      'reason', 'profile_not_ready',
      'enrollmentId', v_enrollment.id,
      'venueId', v_venue.id,
      'venueName', v_venue.name
    );
  end if;

  insert into public.venue_dancer_affiliations (
    venue_id, dancer_id, status, approved_by_user_id, approved_at,
    revoked_by_user_id, revoked_at, revoke_reason, updated_at
  ) values (
    v_venue.id, v_profile.id, 'active', v_venue.owner_user_id, v_enrollment.tapped_at,
    null, null, null, v_now
  ) on conflict (venue_id, dancer_id) do update set
    status = 'active',
    approved_by_user_id = excluded.approved_by_user_id,
    approved_at = case
      when public.venue_dancer_affiliations.status = 'active'
        and public.venue_dancer_affiliations.revoked_at is null
      then public.venue_dancer_affiliations.approved_at
      else excluded.approved_at
    end,
    revoked_by_user_id = null,
    revoked_at = null,
    revoke_reason = null,
    updated_at = excluded.updated_at
  returning * into v_affiliation;

  return jsonb_build_object(
    'authorized', true,
    'authorizedAt', v_profile.venue_approved_at,
    'enrollmentId', v_enrollment.id,
    'affiliationId', v_affiliation.id,
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'profilePublic', v_profile.is_public
  );
end;
$$;

revoke all on function public.authorize_dancer_profile_from_nfc(uuid) from public;
grant execute on function public.authorize_dancer_profile_from_nfc(uuid) to service_role;

comment on function public.authorize_dancer_profile_from_nfc(uuid) is
  'Records dressing-room NFC venue authorization immediately. Public visibility remains governed by profile completeness and media moderation.';

notify pgrst, 'reload schema';
commit;
