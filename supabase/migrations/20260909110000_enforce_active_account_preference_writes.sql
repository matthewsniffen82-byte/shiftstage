-- Disabled accounts must not bypass the application through owner-scoped REST writes.
-- Preserve existing ownership/admin policies, reads, deletion and service operations.
-- These restrictive policies are ANDed with the existing permissive policies.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create policy "active account required for inserts" on public.customer_profiles
as restrictive for insert to authenticated
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for updates" on public.customer_profiles
as restrictive for update to authenticated
using (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'))
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for inserts" on public.favorites
as restrictive for insert to authenticated
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for updates" on public.favorites
as restrictive for update to authenticated
using (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'))
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for inserts" on public.follows
as restrictive for insert to authenticated
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for updates" on public.follows
as restrictive for update to authenticated
using (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'))
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for inserts" on public.going_signals
as restrictive for insert to authenticated
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for updates" on public.going_signals
as restrictive for update to authenticated
using (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'))
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for inserts" on public.venue_follows
as restrictive for insert to authenticated
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

create policy "active account required for updates" on public.venue_follows
as restrictive for update to authenticated
using (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'))
with check (exists (select 1 from public.app_users account where account.id = (select auth.uid()) and account.account_state = 'active'));

commit;
