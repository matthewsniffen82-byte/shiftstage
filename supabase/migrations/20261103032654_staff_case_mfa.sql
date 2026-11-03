-- Never accept an aal2 claim alone: the session and its actual factor must still
-- exist. No user-supplied identity or metadata participates in this decision.
create function public.staff_session_security() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'active', exists (
      select 1 from auth.sessions s join public.app_users u on u.id=s.user_id
      where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
        and (s.not_after is null or s.not_after>now())
        and u.role='admin' and u.account_state='active' and u.dmca_suspended_at is null
    ),
    'mfaVerified', coalesce(auth.jwt()->>'aal'='aal2',false) and exists (
      select 1 from auth.sessions s
      join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      join public.app_users u on u.id=s.user_id
      where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
        and (s.not_after is null or s.not_after>now()) and s.aal='aal2'
        and f.status='verified' and f.factor_type='totp'
        and u.role='admin' and u.account_state='active' and u.dmca_suspended_at is null
    )
  );
$$;
revoke all on function public.staff_session_security() from public,anon,authenticated,service_role;
grant execute on function public.staff_session_security() to authenticated;

-- The case API uses service-only registers, but legacy direct table access must
-- not provide an alternate path around the server's MFA check.
create policy safety_privacy_requires_mfa on public.content_reports
as restrictive for all to authenticated
using (case_kind not in ('safety','privacy') or (select (public.staff_session_security()->>'mfaVerified')::boolean))
with check (case_kind not in ('safety','privacy') or (select (public.staff_session_security()->>'mfaVerified')::boolean));
