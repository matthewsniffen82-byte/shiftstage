-- A manager can clear an open table request as delivered in one transaction.
-- Keep the existing venue access check, row lock and expected-status check.
do $migration$
declare
  definition text := pg_get_functiondef('public.internal_roster_manage(uuid,uuid,text,jsonb)'::regprocedure);
  previous constant text := 'r.status=''pending'' and p_data->>''status'' in (''acknowledged'',''cancelled'')';
begin
  if cardinality(string_to_array(definition, previous)) <> 2 then
    raise exception 'Unexpected table request transition rule';
  end if;
  execute replace(definition, previous,
    'r.status=''pending'' and p_data->>''status'' in (''acknowledged'',''completed'',''cancelled'')');
end $migration$;
