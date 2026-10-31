-- These are user-action conflicts, not serialization failures. A retry cannot
-- resolve an active shift or cooldown and can hide the actionable response.
-- Preserve the installed function, including newer agreement/eligibility guards.
do $migration$
declare
  definition text := pg_get_functiondef('public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  conflict text;
  old_raise text;
begin
  foreach conflict in array array['NFC_ACTIVE_OTHER_CLUB', 'NFC_COOLDOWN_ACTIVE'] loop
    old_raise := format('raise exception %L using errcode=%L', conflict, '40001');
    if position(old_raise in definition) = 0 then
      raise exception 'Expected NFC conflict guard missing: %', conflict;
    end if;
    definition := replace(definition, old_raise,
      format('raise exception %L using errcode=%L', conflict, 'P0001'));
  end loop;
  execute definition;
end
$migration$;

notify pgrst, 'reload schema';
