-- Preserve the first approval time even when webhook and dashboard refreshes
-- both read the same pending row. Only authenticated server reconciliation can
-- write decisions; this does not change the age-verification rollout setting.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public.reconcile_dancer_age_verification(
  p_user_id uuid, p_attempt_id uuid, p_session_id uuid, p_integration_id uuid,
  p_status text, p_checked_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_user_id is null or p_attempt_id is null or p_session_id is null
    or p_integration_id is null or p_checked_at is null or not isfinite(p_checked_at)
    or p_checked_at > clock_timestamp() + interval '5 minutes'
    or p_status is null or p_status not in ('pending','in_review','verified','declined','expired') then
    raise exception using errcode='22023', message='Invalid verification decision.';
  end if;

  update public.dancer_age_verifications set
    status = p_status,
    checked_at = p_checked_at,
    verified_at = case when p_status = 'verified' then
      case when status = 'verified' then coalesce(verified_at, p_checked_at) else p_checked_at end
      else null end,
    verification_url = case when p_status in ('verified','declined','expired') then null else verification_url end
  where user_id = p_user_id and attempt_id = p_attempt_id and session_id = p_session_id
    and provider = 'ondato' and provider_integration_id = p_integration_id::text
    and (checked_at is null or checked_at < p_checked_at
      -- Millisecond timestamps can tie. A negative result wins that tie;
      -- an approval with the same timestamp cannot undo a revocation.
      or (checked_at = p_checked_at and status = 'verified' and p_status <> 'verified'));
  return found;
end;
$$;
revoke all on function public.reconcile_dancer_age_verification(uuid,uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_dancer_age_verification(uuid,uuid,uuid,uuid,text,timestamptz)
  to service_role;
commit;
