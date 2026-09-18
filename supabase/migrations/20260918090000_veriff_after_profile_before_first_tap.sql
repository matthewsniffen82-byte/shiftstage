-- Allow private profile setup before Veriff, then require age verification
-- before the first dressing-room tap. Preserve the existing rollout setting.
-- Rollback requires a forward migration restoring the inspected functions and
-- removing the enrollment trigger; never enable verification without live setup.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.reserve_dancer_age_verification(p_user_id uuid, p_integration_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.dancer_age_verifications; v_now timestamptz := clock_timestamp();
begin
  if p_integration_id is null or not exists(select 1 from public.app_users where id=p_user_id and role='dancer' and account_state='active') then
    raise exception using errcode='42501', message='Active dancer account and integration required.';
  end if;
  if not exists(select 1 from public.dancer_profiles where user_id=p_user_id
    and status::text in ('pending_review','approved') and disabled_at is null) then
    raise exception using errcode='42501', message='AGE_PROFILE_SETUP_REQUIRED';
  end if;
  insert into public.dancer_age_verifications(user_id,provider,provider_integration_id)
    values(p_user_id,'veriff',p_integration_id::text) on conflict do nothing;
  select * into v from public.dancer_age_verifications where user_id=p_user_id for update;
  if v.provider='veriff' and (v.status='verified' or (v.provider_integration_id=p_integration_id::text
    and (v.status='in_review' or (v.status in ('creating','pending') and v.expires_at>v_now)))) then
    return to_jsonb(v) || jsonb_build_object('reserved',false);
  end if;
  if v.attempt_window_at <= v_now-interval '24 hours' then v.attempt_count:=0; v.attempt_window_at:=v_now; end if;
  if v.attempt_count>=3 then raise exception using errcode='P0001',message='AGE_VERIFICATION_RETRY_LIMIT'; end if;
  update public.dancer_age_verifications set attempt_id=gen_random_uuid(), session_id=null,
    provider='veriff', provider_integration_id=p_integration_id::text,
    status='creating', verification_url=null, created_at=v_now, expires_at=v_now+interval '90 seconds',
    checked_at=null, verified_at=null, attempt_window_at=v.attempt_window_at, attempt_count=v.attempt_count+1
    where user_id=p_user_id returning * into v;
  return to_jsonb(v) || jsonb_build_object('reserved',true);
end;
$$;
revoke all on function public.reserve_dancer_age_verification(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_dancer_age_verification(uuid,uuid) to service_role;

create or replace function public.enforce_dancer_age_verification() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user_id uuid; v_required boolean;
begin
  select enabled into v_required from public.dancer_age_verification_settings where singleton;
  if v_required is false then return new; end if;
  if tg_table_name='dancer_profiles' then
    if not new.is_public and (tg_op='UPDATE' and new.status is not distinct from old.status
      or new.status::text <> 'approved') then return new; end if;
    v_user_id:=new.user_id;
  else
    if new.status::text not in ('draft','posted') then return new; end if;
    select user_id into v_user_id from public.dancer_profiles where id=new.dancer_id;
  end if;
  perform 1 from public.dancer_age_verifications where user_id=v_user_id and provider='veriff' and status='verified' for share;
  if not found then raise exception using errcode='42501',message='Verify you are 18 or older before using dancer features.'; end if;
  return new;
end;
$$;

-- Guard the enrollment write, including direct service RPC callers. A failed
-- check rolls back enrollment, affiliation, tap events, and presence together.
create function public.enforce_dancer_nfc_age_verification() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_verified_at timestamptz;
begin
  if new.status not in ('pending','completed') or
    (select enabled from public.dancer_age_verification_settings where singleton) is false then return new; end if;
  if not exists(select 1 from public.dancer_profiles where user_id=new.dancer_user_id
    and status::text in ('pending_review','approved') and disabled_at is null) then
    raise exception using errcode='42501',message='AGE_PROFILE_SETUP_REQUIRED';
  end if;
  select verified_at into v_verified_at from public.dancer_age_verifications
    where user_id=new.dancer_user_id and provider='veriff' and status='verified' for share;
  if v_verified_at is null or new.tapped_at < v_verified_at then
    raise exception using errcode='42501',message='AGE_VERIFICATION_REQUIRED_BEFORE_TAP';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_dancer_nfc_age_verification() from public,anon,authenticated;
create trigger dancer_nfc_age_verification_guard before insert or update of status,tapped_at
  on public.dancer_nfc_enrollments for each row execute function public.enforce_dancer_nfc_age_verification();

CREATE OR REPLACE FUNCTION public.finalize_pending_dancer_nfc_enrollment(p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public', 'pg_temp'
AS $function$
declare
  v_enrollment public.dancer_nfc_enrollments;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  -- Both fresh taps and deferred completion take this lock before any
  -- tag or enrollment row lock, so their opposite row access orders cannot
  -- deadlock each other for the same dancer. Released with the transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mydancr:dancer-nfc-enrollment:' || p_dancer_user_id::text, 0)
  );

  update public.dancer_nfc_enrollments set status = 'expired', updated_at = v_now
  where dancer_user_id = p_dancer_user_id and status = 'pending' and expires_at <= v_now;

  select * into v_enrollment
  from public.dancer_nfc_enrollments
  where dancer_user_id = p_dancer_user_id and status = 'pending' and expires_at > v_now
    -- A pre-verification tap cannot activate automatically after an age check.
    and (coalesce((select enabled from public.dancer_age_verification_settings where singleton),true) is false
      or exists(select 1 from public.dancer_age_verifications age_check
        where age_check.user_id=p_dancer_user_id and age_check.provider='veriff'
          and age_check.status='verified' and age_check.verified_at <= dancer_nfc_enrollments.tapped_at))
  order by tapped_at asc
  limit 1
  for update;
  if not found then
    return jsonb_build_object('enrollmentStatus', 'none');
  end if;

  update public.dancer_nfc_enrollments set last_attempted_at = v_now, updated_at = v_now where id = v_enrollment.id;
  begin
    v_result := public.approve_dancer_venue_affiliation_from_nfc(
      v_enrollment.nfc_tag_id, p_dancer_user_id, p_session_id,
      p_audit || jsonb_build_object('enrollmentId', v_enrollment.id, 'finalizedAfterSetup', true)
    );
  exception when insufficient_privilege then
    return jsonb_build_object(
      'enrollmentStatus', 'pending',
      'enrollmentId', v_enrollment.id,
      'venueId', v_enrollment.venue_id
    );
  end;
  update public.dancer_nfc_enrollments set
    status = 'completed', completed_at = v_now, last_attempted_at = v_now, updated_at = v_now
  where id = v_enrollment.id;
  return v_result || jsonb_build_object('enrollmentStatus', 'completed', 'enrollmentId', v_enrollment.id);
end;
$function$;

commit;
