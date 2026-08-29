begin;

-- Existing API access remains governed by each table's grants and RLS policies.
-- New objects must opt in explicitly instead of inheriting broad browser access.
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated;

alter default privileges in schema public
  revoke all privileges on sequences from anon, authenticated;

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
