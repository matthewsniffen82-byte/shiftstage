-- Existing profiles must not run their BEFORE INSERT link trigger on a replay.
-- No row repair or data rewrite: the existing service-only signature is preserved.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create or replace function public.provision_app_account_safely(
  p_user_id uuid, p_role text, p_email text, p_display_name text, p_city text
) returns boolean
language plpgsql security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_role public.user_role;
  v_state public.account_state;
begin
  if p_user_id is null or p_role is null or p_role not in ('customer','dancer','venue','admin') then
    raise exception using errcode = '22023', message = 'Invalid account provisioning input.';
  end if;
  insert into public.app_users(id, role, email, display_name)
  values(p_user_id, p_role::public.user_role, p_email, case when p_role = 'dancer' then 'Dancer' else p_display_name end)
  on conflict(id) do nothing;
  select role, account_state into v_role, v_state
    from public.app_users where id = p_user_id for update;
  if v_role::text <> p_role then
    raise exception using errcode = '22023', message = 'Existing account type must be preserved.';
  end if;
  -- Preserve lifecycle state and do not recreate children while an account is inactive.
  if v_state <> 'active' then return true; end if;

  if p_role = 'customer' and not exists(select 1 from public.customer_profiles where user_id = p_user_id) then
    insert into public.customer_profiles(user_id, city) values(p_user_id, coalesce(p_city, ''))
    on conflict(user_id) do nothing;
  elsif p_role = 'dancer' and not exists(select 1 from public.dancer_profiles where user_id = p_user_id) then
    insert into public.dancer_profiles(user_id, real_name, stage_name, slug, city, status,
      verification_status, photo_review_status, is_public, approved_at, disabled_at, identity_saved_at)
    values(p_user_id, 'Verification pending', '', 'dancer-' || p_user_id::text, coalesce(p_city, ''),
      'draft', 'pending', 'pending', false, null, null, null)
    on conflict(user_id) do nothing;
  end if;
  return true;
end;
$$;

revoke all on function public.provision_app_account_safely(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.provision_app_account_safely(uuid,text,text,text,text) to service_role;
commit;
