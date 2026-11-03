-- Expired demo assignments must close without becoming commission records.
-- Preserve every existing NFC eligibility, cooldown and receipt guard.
begin;
set local lock_timeout = '3s';
do $migration$
declare
  definition text := pg_get_functiondef('public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb)'::regprocedure);
  old_assignment text := 'commission_tracking_stopped_at = coalesce(commission_tracking_stopped_at, location_verification_expires_at, v_now)';
  new_assignment text := 'commission_tracking_stopped_at = case when shift_source = ''demo_locked'' then null
        else coalesce(commission_tracking_stopped_at, location_verification_expires_at, v_now) end';
begin
  if (length(definition) - length(replace(definition, old_assignment, ''))) / length(old_assignment) <> 1 then
    raise exception 'Expected single expired-shift cleanup assignment was not found';
  end if;
  execute replace(definition, old_assignment, new_assignment);
end
$migration$;
commit;
