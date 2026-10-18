begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- A saved, still-active check-in may predate the 31-day reporting limit.
-- Allow its exact owner-scoped start without accepting arbitrary long ranges.
-- Keep the existing aggregate body and service-only privileges intact.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_dancer_request_results(uuid,timestamptz,timestamptz)'::regprocedure);
  old_guard text := $old$or (p_until-p_since>interval '31 days' and not exists(
     select 1 from public.dancer_profiles where id=p_dancer_id and created_at=p_since))$old$;
  new_guard text := $new$or (p_until-p_since>interval '31 days' and not exists(
     select 1 from public.dancer_profiles where id=p_dancer_id and created_at=p_since)
     and not exists(
       select 1 from public.shifts s
       where s.dancer_id=p_dancer_id and s.checked_in_at=p_since
         and s.location_status='club_confirmed' and s.status<>'cancelled'
         and s.checked_out_at is null and s.location_verification_expires_at>p_until))$new$;
begin
  if strpos(definition,old_guard)=0 then
    raise exception 'Expected dancer analytics window guard was not found';
  end if;
  execute replace(definition,old_guard,new_guard);
end;
$migration$;

revoke all on function public.get_dancer_request_results(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_dancer_request_results(uuid,timestamptz,timestamptz) to service_role;
commit;
