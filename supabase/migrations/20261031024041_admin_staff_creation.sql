-- New logins start without staff privileges. Assign the selected scope and audit
-- it together. The owner-only server route verifies the target's trusted creation
-- marker, email and unaccepted state through the Auth admin API before calling.
-- No browser role may call this function or supply its target identity.
create or replace function public.provision_admin_staff(p_actor uuid, p_target uuid, p_email text, p_name text, p_role text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  target_account public.app_users%rowtype;
begin
  perform pg_advisory_xact_lock(208234,1);
  perform public.assert_admin_workspace_access(p_actor,'owner');
  perform 1 from public.app_users where id=p_actor and role='admin' and account_state='active'
    and admin_workspace_role='owner' and dmca_suspended_at is null for share;
  if not found then raise exception 'Staff permission required.' using errcode='42501'; end if;
  if p_role is null or p_role not in ('owner','reviewer','compliance','support','billing') or p_actor=p_target
    or coalesce(length(trim(p_name)),0) not between 1 and 100 then
    raise exception 'Invalid staff details.' using errcode='22023';
  end if;
  select * into target_account from public.app_users where id=p_target for update;
  if not found or target_account.account_state <> 'active' or target_account.dmca_suspended_at is not null
    or target_account.email is distinct from p_email then
    raise exception 'Active account required.' using errcode='42501';
  end if;
  -- A retry after a lost response must never overwrite a later role change.
  if target_account.role <> 'admin' then
    if target_account.role <> 'customer' then
      raise exception 'An existing login cannot be converted to staff.' using errcode='42501';
    end if;
    update public.app_users set role='admin',admin_workspace_role=p_role,display_name=trim(p_name)
      where id=p_target returning * into target_account;
    delete from public.customer_profiles where user_id=p_target;
    insert into public.admin_actions(admin_id,action,target_type,target_id,notes)
      values(p_actor,'staff_added','user',p_target,'Workspace role: '||p_role);
  end if;
  return jsonb_build_object('id',target_account.id,'email',target_account.email,
    'display_name',target_account.display_name,'admin_workspace_role',target_account.admin_workspace_role,
    'account_state',target_account.account_state);
end $$;
revoke all on function public.provision_admin_staff(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.provision_admin_staff(uuid,uuid,text,text,text) to service_role;
