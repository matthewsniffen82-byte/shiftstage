begin;

-- Trigger functions execute through their attached database triggers and never
-- need to be called through PostgREST by browser roles. Cover existing and
-- future trigger definitions already present when this migration runs.
do $$
declare
  target_function record;
begin
  for target_function in
    select
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and procedure.prorettype in (
        'pg_catalog.trigger'::regtype,
        'pg_catalog.event_trigger'::regtype
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      target_function.schema_name,
      target_function.function_name,
      target_function.identity_arguments
    );
  end loop;
end;
$$;

commit;
