begin;

alter table public.venue_signup_requests
  add column if not exists requester_user_id uuid references public.app_users(id) on delete set null,
  add column if not exists login_email text;

create unique index if not exists venue_signup_requests_manager_idx
  on public.venue_signup_requests (requester_user_id)
  where requester_user_id is not null;

-- Only the server links a new manager to a request. Existing requests retain
-- their original one-time-code signup flow.
create or replace function public.activate_approved_venue_request_manager()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if new.login_email is null or new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  perform 1 from public.app_users where id = new.requester_user_id for update;
  if new.requester_user_id is null or not exists (
    select 1 from public.app_users account
    join auth.users auth_user on auth_user.id = account.id
    where account.id = new.requester_user_id
      and account.role = 'venue' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The request manager account is unavailable. Contact support before approving.';
  end if;

  -- The review RPC holds the request lock. Lock the manager and venue too,
  -- so ownership and code consumption either both succeed or both roll back.
  select owner_user_id into v_owner from public.venues where id = new.matched_venue_id for update;
  if not found or (v_owner is not null and v_owner <> new.requester_user_id) then
    raise exception using errcode = '42501', message = 'The approved venue cannot be assigned to this manager.';
  end if;
  if exists (select 1 from public.venues where owner_user_id = new.requester_user_id and id <> new.matched_venue_id)
    or exists (select 1 from public.venue_team_members where user_id = new.requester_user_id and status = 'active') then
    raise exception using errcode = '42501', message = 'This manager already has venue access.';
  end if;

  update public.venues set owner_user_id = new.requester_user_id, updated_at = now()
    where id = new.matched_venue_id;
  update public.venue_claim_codes set used_at = now(), used_by = new.requester_user_id
    where id = new.access_code_id and venue_id = new.matched_venue_id and used_at is null and revoked_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'The approval access credential is unavailable.';
  end if;
  return new;
end;
$$;

drop trigger if exists venue_request_activate_manager on public.venue_signup_requests;
create trigger venue_request_activate_manager
  after update of status on public.venue_signup_requests
  for each row execute function public.activate_approved_venue_request_manager();

revoke all on function public.activate_approved_venue_request_manager() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
