-- Email credentials remain available until their action completes or is revoked.
create table public.account_email_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('confirmation', 'recovery', 'email_change')),
  email text not null,
  new_email text,
  return_to text not null default '',
  current_confirmed_at timestamptz,
  new_confirmed_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((purpose = 'email_change') = (new_email is not null))
);
create index account_email_actions_user_pending_idx on public.account_email_actions(user_id, purpose)
  where completed_at is null and revoked_at is null;
alter table public.account_email_actions enable row level security;
revoke all on public.account_email_actions from public, anon, authenticated;
grant select, insert, update, delete on public.account_email_actions to service_role;
create policy "Service manages email action credentials" on public.account_email_actions
  for all to service_role using (true) with check (true);

create schema if not exists private;
create or replace function private.close_account_email_actions_on_credentials()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.account_email_actions set completed_at = now()
    where user_id = new.id and purpose = 'recovery' and completed_at is null and revoked_at is null;
    update public.account_email_actions set revoked_at = now()
    where user_id = new.id and purpose in ('confirmation', 'email_change') and completed_at is null and revoked_at is null;
  end if;
  if new.email is distinct from old.email then
    update public.account_email_actions set completed_at = now()
    where user_id = new.id and purpose = 'email_change' and lower(new_email) = lower(new.email)
      and current_confirmed_at is not null and new_confirmed_at is not null
      and completed_at is null and revoked_at is null;
    update public.account_email_actions set revoked_at = now()
    where user_id = new.id and completed_at is null and revoked_at is null;
  end if;
  return new;
end;
$$;
revoke all on function private.close_account_email_actions_on_credentials() from public, anon, authenticated;
create trigger close_account_email_actions_on_credentials
  after update of encrypted_password, email on auth.users
  for each row execute function private.close_account_email_actions_on_credentials();

alter table public.venue_team_invitations alter column expires_at drop not null;
alter table public.venue_vip_invitations alter column expires_at drop not null;
update public.venue_team_invitations set expires_at = null where accepted_at is null and revoked_at is null;
update public.venue_vip_invitations set expires_at = null where accepted_at is null and revoked_at is null;
create or replace function private.keep_invitation_until_completed()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.expires_at := null;
  return new;
end;
$$;
revoke all on function private.keep_invitation_until_completed() from public, anon, authenticated;
create trigger team_invitation_until_completed before insert on public.venue_team_invitations
  for each row execute function private.keep_invitation_until_completed();
create trigger vip_invitation_until_completed before insert on public.venue_vip_invitations
  for each row execute function private.keep_invitation_until_completed();

CREATE OR REPLACE FUNCTION public.redeem_venue_team_invitation(p_invitation_id uuid, p_user_id uuid)
 RETURNS public.venue_team_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invitation public.venue_team_invitations%rowtype;
  v_account public.app_users%rowtype;
  v_member public.venue_team_members%rowtype;
  v_now timestamptz := now();
begin
  select * into v_invitation
  from public.venue_team_invitations
  where id = p_invitation_id
  for update;

  if not found
    or v_invitation.revoked_at is not null
    or v_invitation.expires_at <= v_now then
    raise exception using errcode = '22023', message = 'This venue team invitation is no longer active.';
  end if;

  select * into v_account
  from public.app_users
  where id = p_user_id and role = 'venue' and account_state = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'An active venue account is required.';
  end if;

  if lower(coalesce(v_account.email, '')) <> lower(v_invitation.email) then
    raise exception using errcode = '42501', message = 'Sign in with the email address that received this invitation.';
  end if;

  if v_invitation.accepted_at is not null then
    select * into v_member from public.venue_team_members
    where venue_id = v_invitation.venue_id and user_id = p_user_id and status = 'active';
    if found and v_invitation.accepted_by_user_id = p_user_id then return v_member; end if;
    raise exception using errcode = '42501', message = 'This invitation has already been accepted.';
  end if;

  if exists (
    select 1 from public.venues venue
    where venue.owner_user_id = p_user_id and venue.id <> v_invitation.venue_id
  ) then
    raise exception using errcode = '42501', message = 'Venue owners cannot join a different venue team.';
  end if;

  if exists (
    select 1 from public.venue_team_members member
    where member.user_id = p_user_id
      and member.status = 'active'
      and member.venue_id <> v_invitation.venue_id
  ) then
    raise exception using errcode = '42501', message = 'This account already belongs to another venue team.';
  end if;

  insert into public.venue_team_members (
    venue_id, user_id, role, status, invited_by_user_id, joined_at, removed_at, updated_at
  ) values (
    v_invitation.venue_id, p_user_id, v_invitation.role, 'active',
    v_invitation.invited_by_user_id, v_now, null, v_now
  )
  on conflict (venue_id, user_id) do update set
    role = excluded.role,
    status = 'active',
    invited_by_user_id = excluded.invited_by_user_id,
    joined_at = v_now,
    removed_at = null,
    updated_at = v_now
  returning * into v_member;

  update public.venue_team_invitations set
    accepted_at = v_now,
    accepted_by_user_id = p_user_id,
    updated_at = v_now
  where id = v_invitation.id;

  return v_member;
end;
$function$;

revoke all on function public.redeem_venue_team_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_venue_team_invitation(uuid, uuid) to service_role;
