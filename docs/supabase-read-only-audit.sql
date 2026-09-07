-- Read-only catalog audit. No user rows, credentials, writes, or function execution.
-- Run individual SELECT statements in the project's SQL Editor; export all rows.

select n.nspname as schema_name, c.relname, c.relkind,
       c.relrowsecurity, c.reloptions,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p', 'v', 'm')
order by 1, 2;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select viewname, definition from pg_views where schemaname = 'public';

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.proname;

select c.conrelid::regclass::text as table_name, c.conname, c.contype,
       c.convalidated, pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_namespace n on n.oid = c.connamespace
where n.nspname = 'public' order by 1, 2;

select tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' order by tablename, indexname;

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns where table_schema = 'public'
order by table_name, ordinal_position;

select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

select tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;

select version, name from supabase_migrations.schema_migrations order by version;

-- Missing object names are metadata only. Expand this list from the inventory
-- during release verification; absence must not trigger automatic migration replay.
select name, to_regclass('public.' || name) is not null as present
from unnest(array['app_users', 'dancer_profiles', 'customer_profiles',
                  'account_recovery_events', 'customer_deal_saves',
                  'request_rate_limit_buckets']) as name;
