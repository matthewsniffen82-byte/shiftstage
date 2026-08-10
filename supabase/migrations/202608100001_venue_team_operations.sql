begin;

create table if not exists public.venue_team_members (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null check (role in ('manager', 'staff')),
  status text not null default 'active' check (status in ('active', 'removed')),
  invited_by_user_id uuid references public.app_users(id) on delete set null,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (venue_id, user_id)
);

create index if not exists venue_team_members_user_status_idx
  on public.venue_team_members (user_id, status, updated_at desc);

create index if not exists venue_team_members_venue_status_idx
  on public.venue_team_members (venue_id, status, role, updated_at desc);

create unique index if not exists venue_team_members_active_user_idx
  on public.venue_team_members (user_id)
  where status = 'active';

create table if not exists public.venue_team_invitations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager', 'staff')),
  token_digest text not null unique,
  invited_by_user_id uuid not null references public.app_users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references public.app_users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(email) between 3 and 320),
  check (expires_at > created_at)
);

create unique index if not exists venue_team_invitations_pending_email_idx
  on public.venue_team_invitations (venue_id, lower(email))
  where accepted_at is null and revoked_at is null;

create index if not exists venue_team_invitations_venue_idx
  on public.venue_team_invitations (venue_id, created_at desc);

create table if not exists public.venue_activity_log (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  actor_user_id uuid references public.app_users(id) on delete set null,
  actor_role text not null check (actor_role in ('owner', 'manager', 'staff', 'admin', 'system')),
  action text not null,
  target_type text,
  target_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (char_length(action) between 2 and 100),
  check (char_length(summary) between 2 and 300)
);

create index if not exists venue_activity_log_venue_time_idx
  on public.venue_activity_log (venue_id, created_at desc);

create table if not exists public.venue_nfc_support_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  nfc_tag_id uuid references public.nfc_tags(id) on delete set null,
  requested_by_user_id uuid not null references public.app_users(id) on delete restrict,
  request_type text not null check (request_type in ('damaged', 'lost', 'relocate', 'replacement')),
  notes text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (notes is null or char_length(notes) <= 1000)
);

create index if not exists venue_nfc_support_requests_venue_status_idx
  on public.venue_nfc_support_requests (venue_id, status, created_at desc);

alter table public.nfc_tags
  add column if not exists scan_count bigint not null default 0,
  add column if not exists last_scanned_at timestamptz;

create or replace function public.record_nfc_tag_scan(p_tag_id uuid)
returns public.nfc_tags
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag public.nfc_tags;
begin
  update public.nfc_tags
  set
    scan_count = scan_count + 1,
    last_scanned_at = now()
  where id = p_tag_id and status = 'active'
  returning * into v_tag;

  return v_tag;
end;
$$;

revoke all on function public.record_nfc_tag_scan(uuid) from public;
grant execute on function public.record_nfc_tag_scan(uuid) to service_role;

alter table public.venue_team_members enable row level security;
alter table public.venue_team_invitations enable row level security;
alter table public.venue_activity_log enable row level security;
alter table public.venue_nfc_support_requests enable row level security;

drop policy if exists "Admins manage venue team members" on public.venue_team_members;
create policy "Admins manage venue team members" on public.venue_team_members for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Venue users read own team membership" on public.venue_team_members;
create policy "Venue users read own team membership" on public.venue_team_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.venues venue
      where venue.id = venue_id and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Admins manage venue team invitations" on public.venue_team_invitations;
create policy "Admins manage venue team invitations" on public.venue_team_invitations for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Venue owners read own team invitations" on public.venue_team_invitations;
create policy "Venue owners read own team invitations" on public.venue_team_invitations for select
  using (exists (
    select 1 from public.venues venue
    where venue.id = venue_id and venue.owner_user_id = auth.uid()
  ));

drop policy if exists "Admins manage venue activity" on public.venue_activity_log;
create policy "Admins manage venue activity" on public.venue_activity_log for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Venue team reads own activity" on public.venue_activity_log;
create policy "Venue team reads own activity" on public.venue_activity_log for select
  using (
    exists (
      select 1 from public.venues venue
      where venue.id = venue_id and venue.owner_user_id = auth.uid()
    )
    or exists (
      select 1 from public.venue_team_members member
      where member.venue_id = venue_id
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  );

drop policy if exists "Admins manage venue NFC support requests" on public.venue_nfc_support_requests;
create policy "Admins manage venue NFC support requests" on public.venue_nfc_support_requests for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Venue team reads own NFC support requests" on public.venue_nfc_support_requests;
create policy "Venue team reads own NFC support requests" on public.venue_nfc_support_requests for select
  using (
    exists (
      select 1 from public.venues venue
      where venue.id = venue_id and venue.owner_user_id = auth.uid()
    )
    or exists (
      select 1 from public.venue_team_members member
      where member.venue_id = venue_id
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  );

create or replace function public.redeem_venue_team_invitation(
  p_invitation_id uuid,
  p_user_id uuid
)
returns public.venue_team_members
language plpgsql
security definer
set search_path = public
as $$
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
    or v_invitation.accepted_at is not null
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
$$;

revoke all on function public.redeem_venue_team_invitation(uuid, uuid) from public;
grant execute on function public.redeem_venue_team_invitation(uuid, uuid) to service_role;

create or replace function public.revoke_dancer_venue_affiliation(
  p_affiliation_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_affiliation public.venue_dancer_affiliations;
  v_replacement public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
begin
  select * into v_affiliation
  from public.venue_dancer_affiliations
  where id = p_affiliation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue affiliation not found.';
  end if;

  select * into v_dancer from public.dancer_profiles where id = v_affiliation.dancer_id for update;
  select * into v_venue from public.venues where id = v_affiliation.venue_id;

  if p_actor_user_id is distinct from v_dancer.user_id
    and p_actor_user_id is distinct from v_venue.owner_user_id
    and not exists (
      select 1 from public.venue_team_members member
      where member.venue_id = v_affiliation.venue_id
        and member.user_id = p_actor_user_id
        and member.role = 'manager'
        and member.status = 'active'
    )
  then
    raise exception using errcode = '42501', message = 'Only the dancer, venue owner, or an active venue manager can remove this affiliation.';
  end if;

  if v_affiliation.status = 'active' then
    update public.venue_dancer_affiliations
    set
      status = 'revoked',
      revoked_by_user_id = p_actor_user_id,
      revoked_at = v_now,
      revoke_reason = coalesce(v_reason, 'Affiliation removed by an authorized account.'),
      updated_at = v_now
    where id = v_affiliation.id
    returning * into v_affiliation;

    update public.shifts
    set
      checked_out_at = v_now,
      location_status = 'self_reported',
      location_verification_expires_at = v_now,
      working_status = 'ended',
      commission_tracking_stopped_at = coalesce(commission_tracking_stopped_at, v_now),
      ended_at = coalesce(ended_at, v_now),
      ended_reason = 'venue_affiliation_revoked',
      updated_at = v_now
    where dancer_id = v_affiliation.dancer_id
      and venue_id = v_affiliation.venue_id
      and checked_in_at is not null
      and checked_out_at is null;

    select * into v_replacement
    from public.venue_dancer_affiliations
    where dancer_id = v_affiliation.dancer_id
      and status = 'active'
      and revoked_at is null
    order by approved_at asc
    limit 1;

    if found then
      update public.dancer_profiles
      set
        venue_approved_at = v_replacement.approved_at,
        venue_approved_by_user_id = v_replacement.approved_by_user_id,
        venue_approved_venue_id = v_replacement.venue_id
      where id = v_affiliation.dancer_id;
    else
      update public.dancer_profiles
      set
        venue_approved_at = null,
        venue_approved_by_user_id = null,
        venue_approved_venue_id = null
      where id = v_affiliation.dancer_id;
    end if;

    insert into public.venue_dancer_affiliation_events (
      affiliation_id, venue_id, dancer_id, actor_user_id, event_type, event_payload
    ) values (
      v_affiliation.id,
      v_affiliation.venue_id,
      v_affiliation.dancer_id,
      p_actor_user_id,
      'affiliation_revoked',
      jsonb_build_object('reason', v_affiliation.revoke_reason, 'profileDeactivated', false)
    );
  end if;

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'profileDeactivated', false,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$$;

revoke all on function public.revoke_dancer_venue_affiliation(uuid, uuid, text) from public;
grant execute on function public.revoke_dancer_venue_affiliation(uuid, uuid, text) to service_role;

grant all on public.venue_team_members,
  public.venue_team_invitations,
  public.venue_activity_log,
  public.venue_nfc_support_requests to service_role;

notify pgrst, 'reload schema';
commit;
