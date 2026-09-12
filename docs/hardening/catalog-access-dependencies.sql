-- Metadata only. Select the intended project before running this query.
-- Companion to catalog-read-only.sql; no application rows or RPC execution.
begin isolation level repeatable read read only;
set local statement_timeout = '20s';
set local search_path = pg_catalog, public, pg_temp;

select jsonb_build_object(
  'captured_at', now(),
  'read_only', current_setting('transaction_read_only'),
  'column_grants', (select coalesce(jsonb_agg(to_jsonb(x) order by table_name, column_name, grantee, privilege_type), '[]') from (
    select c.relname table_name, a.attname column_name,
      case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end grantee,
      g.privilege_type, g.is_grantable, pg_get_userbyid(g.grantor) grantor
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(a.attacl) g
    where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
      and (g.grantee = 0 or pg_get_userbyid(g.grantee) in ('anon', 'authenticated', 'service_role'))
  ) x),
  'roles', (select jsonb_agg(jsonb_build_object(
    'name', rolname, 'superuser', rolsuper, 'inherit', rolinherit,
    'create_role', rolcreaterole, 'create_database', rolcreatedb, 'login', rolcanlogin,
    'replication', rolreplication, 'bypass_rls', rolbypassrls
  ) order by rolname) from pg_roles),
  'memberships', (select jsonb_agg(jsonb_build_object(
    'member', member::regrole::text, 'role', roleid::regrole::text,
    'grantor', grantor::regrole::text, 'admin_option', admin_option,
    'inherit_option', inherit_option, 'set_option', set_option
  ) order by member::regrole::text, roleid::regrole::text) from pg_auth_members)
) as access;
rollback;
