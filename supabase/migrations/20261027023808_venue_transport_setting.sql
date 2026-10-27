begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- This controls the current shuttle request form, not the retired pickup chat.
alter table public.venues add column transport_enabled boolean not null default false;
comment on column public.venues.transport_enabled is 'Admin-managed availability of club transportation and its dashboard inbox.';
grant select (transport_enabled) on public.venues to anon, authenticated;
grant update (transport_enabled) on public.venues to service_role;
-- Existing venue RLS allows browser writes only for unrestricted site admins.
notify pgrst, 'reload schema';
commit;
