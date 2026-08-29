begin;

-- Account roles and lifecycle state are provisioned only by trusted server code.
-- An authenticated browser must never be able to promote its own app_users row.
revoke insert, update, delete on table public.app_users from anon, authenticated;

drop policy if exists "users update own profile" on public.app_users;
drop policy if exists "users create own app profile" on public.app_users;

commit;
