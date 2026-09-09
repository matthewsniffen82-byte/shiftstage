-- Admin sessions may inspect audit history but must not forge or erase it.
-- Existing server-only writers and authorized database operations keep
-- their privileges. Account deletion may still anonymize admin_id through its FK.
revoke all privileges on table public.admin_actions from anon, authenticated;
revoke insert (id, admin_id, target_type, target_id, action, notes, created_at),
  update (id, admin_id, target_type, target_id, action, notes, created_at),
  references (id, admin_id, target_type, target_id, action, notes, created_at)
  on table public.admin_actions from anon, authenticated;
grant select on table public.admin_actions to authenticated;

drop policy if exists "admins manage admin actions" on public.admin_actions;
drop policy if exists "active admins read audit history" on public.admin_actions;
create policy "active admins read audit history" on public.admin_actions
  for select to authenticated using (public.is_admin());
