-- Unused foundation: preserve existing activation, affiliation and presence rules.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create function public.register_and_activate_dancer_tap(
 p_tag_id uuid,p_dancer_user_id uuid,p_session_id uuid,p_audit jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
set lock_timeout='3s'
as $function$
declare
 v_enrollment jsonb;
 v_presence jsonb;
 v_audit jsonb := coalesce(p_audit,'{}'::jsonb);
begin
 if p_tag_id is null or p_dancer_user_id is null or p_session_id is null
   or jsonb_typeof(v_audit) is distinct from 'object' then
   raise exception 'DANCER_TAP_INVALID_INPUT' using errcode='22023';
 end if;
 v_enrollment := public.register_dancer_nfc_enrollment(p_tag_id,p_dancer_user_id,p_session_id,v_audit);
 if jsonb_typeof(v_enrollment) is distinct from 'object'
   or coalesce(v_enrollment->>'enrollmentStatus','') not in('pending','completed')
   or (v_enrollment->>'enrollmentId') is null then
   raise exception 'DANCER_TAP_ENROLLMENT_NOT_CONFIRMED' using errcode='40001';
 end if;
 if v_enrollment->>'enrollmentStatus'='pending' then return v_enrollment; end if;
 v_presence := public.activate_dancer_shift_from_nfc(p_tag_id,p_dancer_user_id,p_session_id,v_audit);
 if jsonb_typeof(v_presence) is distinct from 'object'
   or not(v_presence ?& array['shiftCheckedIn','tapApplied','alreadyWorking','cooldownActive','shiftId','workingUntil','nextTapAllowedAt','venueId'])
   or jsonb_typeof(v_presence->'shiftCheckedIn') is distinct from 'boolean'
   or jsonb_typeof(v_presence->'tapApplied') is distinct from 'boolean'
   or jsonb_typeof(v_presence->'alreadyWorking') is distinct from 'boolean'
   or jsonb_typeof(v_presence->'cooldownActive') is distinct from 'boolean'
   or (v_presence->>'shiftId') is null or (v_presence->>'venueId') is null then
   raise exception 'DANCER_TAP_PRESENCE_NOT_CONFIRMED' using errcode='40001';
 end if;
 return v_enrollment||v_presence;
end;
$function$;
revoke all on function public.register_and_activate_dancer_tap(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.register_and_activate_dancer_tap(uuid,uuid,uuid,jsonb) to service_role;
comment on function public.register_and_activate_dancer_tap(uuid,uuid,uuid,jsonb) is
 'Service-only fresh dancer tap: existing enrollment/affiliation and Working Now operations in one transaction. Incomplete setup remains pending; deferred setup completion stays separate.';
commit;
