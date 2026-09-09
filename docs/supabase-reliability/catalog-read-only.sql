-- Metadata only: no application rows, storage objects, credentials, or privileged RPC execution.
-- Review and run against the explicitly selected project; never pipe migration files into this command.
begin isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '2s';

select jsonb_build_object(
  'captured_at', now(),
  'read_only', current_setting('transaction_read_only'),
  'postgres_version', current_setting('server_version'),
  'relations', (select coalesce(jsonb_agg(to_jsonb(x) order by schema_name, name), '[]') from (
    select n.nspname as schema_name, c.relname as name, c.relkind as kind,
      c.relrowsecurity as rls, c.relforcerowsecurity as force_rls, c.reloptions as options,
      pg_get_userbyid(c.relowner) as owner,
      (select jsonb_object_agg(r, jsonb_build_object(
        'select', has_table_privilege(r,c.oid,'SELECT'), 'insert',has_table_privilege(r,c.oid,'INSERT'),
        'update',has_table_privilege(r,c.oid,'UPDATE'), 'delete',has_table_privilege(r,c.oid,'DELETE')))
        from unnest(array['anon','authenticated','service_role']) r) as grants
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','storage') and c.relkind in ('r','p','v','m','f')
  ) x),
  'columns', (select coalesce(jsonb_agg(to_jsonb(x) order by table_schema,table_name,ordinal_position), '[]') from (
    select table_schema,table_name,column_name,ordinal_position,data_type,udt_schema,udt_name,
      is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema in ('public','auth','storage')
  ) x),
  'constraints', (select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,table_name,name), '[]') from (
    select n.nspname schema_name, cl.relname table_name, c.conname name,c.contype type,
      c.convalidated validated,c.condeferrable deferrable,c.condeferred initially_deferred,
      c.confdeltype delete_action,case when c.confrelid<>0 then c.confrelid::regclass::text end referenced_table,
      pg_get_constraintdef(c.oid) definition
    from pg_constraint c join pg_namespace n on n.oid=c.connamespace
    left join pg_class cl on cl.oid=c.conrelid
    where n.nspname in ('public','auth','storage')
  ) x),
  'indexes', (select coalesce(jsonb_agg(to_jsonb(x) order by schemaname,tablename,indexname), '[]') from (
    select i.schemaname,i.tablename,i.indexname,i.indexdef,ix.indisvalid,ix.indisready,ix.indisunique
    from pg_indexes i join pg_class ic on ic.relname=i.indexname
    join pg_namespace ns on ns.oid=ic.relnamespace and ns.nspname=i.schemaname
    join pg_index ix on ix.indexrelid=ic.oid where i.schemaname in ('public','auth','storage')
  ) x),
  'policies', (select coalesce(jsonb_agg(to_jsonb(x) order by schemaname,tablename,policyname), '[]') from (
    select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
    from pg_policies where schemaname in ('public','auth','storage')
  ) x),
  'functions', (select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,name,arguments), '[]') from (
    select n.nspname schema_name,p.proname name,pg_get_function_identity_arguments(p.oid) arguments,
      pg_get_function_result(p.oid) result,l.lanname language,p.prosecdef security_definer,
      p.provolatile volatility,p.proconfig settings,pg_get_userbyid(p.proowner) owner,
      md5(pg_get_functiondef(p.oid)) definition_fingerprint,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname in ('public','auth','storage') and p.prokind in ('f','p')
  ) x),
  'triggers', (select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,table_name,name), '[]') from (
    select n.nspname schema_name,c.relname table_name,t.tgname name,t.tgenabled enabled,
      t.tgfoid::regprocedure::text function_name,pg_get_triggerdef(t.oid) definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname in ('public','auth','storage')
  ) x),
  'views', (select coalesce(jsonb_agg(to_jsonb(x) order by schemaname,viewname), '[]') from (
    select schemaname,viewname,definition from pg_views where schemaname in ('public','auth','storage')
  ) x),
  'enums', (select coalesce(jsonb_agg(to_jsonb(x) order by schema_name,name), '[]') from (
    select n.nspname schema_name,t.typname name,array_agg(e.enumlabel order by e.enumsortorder) labels
    from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid
    where n.nspname in ('public','auth','storage') group by n.nspname,t.typname
  ) x),
  'buckets', (select coalesce(jsonb_agg(to_jsonb(x) order by id), '[]') from (
    select id,public,file_size_limit,allowed_mime_types from storage.buckets
  ) x),
  'realtime', (select coalesce(jsonb_agg(to_jsonb(x) order by pubname,schemaname,tablename), '[]') from (
    select pubname,schemaname,tablename from pg_publication_tables
    where pubname='supabase_realtime'
  ) x),
  'extensions', (select coalesce(jsonb_agg(to_jsonb(x) order by name), '[]') from (
    select extname name,extversion version from pg_extension
  ) x),
  'migrations', (select coalesce(jsonb_agg(to_jsonb(x) order by version), '[]') from (
    select version,name from supabase_migrations.schema_migrations
  ) x)
) as catalog;
rollback;
