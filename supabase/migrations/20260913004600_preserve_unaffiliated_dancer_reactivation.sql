begin;

-- Preserve the existing locked, service-only transition and its pause ownership
-- checks. A verified dancer who was already public need not join a venue merely
-- to recover the publication state saved by their own account pause.
do $migration$
declare
  definition text;
  old_clause constant text := 'and verification_status = ''approved'' and approved_at is not null and venue_approved_at is not null';
  new_clause constant text := 'and verification_status = ''approved'' and approved_at is not null';
begin
  select pg_get_functiondef('public.transition_own_account_safely(uuid,text)'::regprocedure) into definition;
  if md5(definition) <> '61a345ec72eed2eddeeb32776f165385'
    or (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause) <> 2 then
    raise exception 'Account transition differs from reviewed definition';
  end if;
  execute replace(definition,old_clause,new_clause);
end;
$migration$;

commit;
