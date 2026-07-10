alter table public.dancer_profiles
  add column if not exists is_public boolean not null default true;

drop policy if exists "approved dancers are public" on public.dancer_profiles;
create policy "approved public dancers are public"
on public.dancer_profiles
for select
using (
  (status = 'approved' and is_public = true)
  or user_id = auth.uid()
  or public.is_admin()
);
