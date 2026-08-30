begin;

-- These helpers are only used by the trusted auth bootstrap trigger. Keep
-- object resolution deterministic and remove their unnecessary PostgREST
-- execution surface.
alter function public.slugify(text)
  set search_path = pg_catalog, pg_temp;
alter function public.unique_dancer_slug(text, uuid)
  set search_path = pg_catalog, pg_temp;

revoke execute on function public.slugify(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.unique_dancer_slug(text, uuid)
  from public, anon, authenticated, service_role;

-- Trigger functions run through their attached triggers; API roles never need
-- to call them directly. Apply this rule to invoker and definer functions.
do $$
declare
  target_function record;
begin
  for target_function in
    select
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prorettype in (
        'pg_catalog.trigger'::regtype,
        'pg_catalog.event_trigger'::regtype
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated, service_role',
      target_function.schema_name,
      target_function.function_name,
      target_function.identity_arguments
    );
  end loop;
end;
$$;

-- This legacy trigger function previously inherited the caller search path.
alter function public.prohibit_financial_record_delete()
  set search_path = pg_catalog, pg_temp;

commit;
