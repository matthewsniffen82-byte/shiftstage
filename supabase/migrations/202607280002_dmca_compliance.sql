-- Production DMCA notice, counter-notice, restoration, and repeat-infringer workflow.

alter type public.notification_type add value if not exists 'dmca_status';

alter table public.app_users
  add column if not exists dmca_suspended_at timestamptz;

alter table public.dancer_profiles
  add column if not exists dmca_suspended_at timestamptz;

create table if not exists public.dmca_agent_settings (
  id boolean primary key default true check (id),
  legal_name text not null,
  organization text,
  email text not null,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state_region text,
  postal_code text,
  country text,
  registered_with_copyright_office boolean not null default false,
  registration_renewal_at date,
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.dmca_agent_settings (id, legal_name, organization, email)
values (true, 'MyDancr Copyright Agent', 'MyDancr', 'support@mydancr.com')
on conflict (id) do nothing;

create table if not exists public.dmca_cases (
  id uuid primary key default gen_random_uuid(),
  claimant_name text not null,
  claimant_company text,
  claimant_email text not null,
  claimant_phone text not null,
  claimant_address text not null,
  copyrighted_work_description text not null,
  original_work_url text,
  infringing_url text not null,
  target_type text not null default 'other',
  target_id uuid,
  uploader_id uuid references public.app_users(id) on delete set null,
  status text not null default 'submitted',
  good_faith_confirmed boolean not null,
  accuracy_confirmed boolean not null,
  authority_confirmed boolean not null,
  signature text not null,
  request_ip_hash text not null,
  content_previous_status text,
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  disabled_at timestamptz,
  uploader_notified_at timestamptz,
  counter_received_at timestamptz,
  restore_eligible_at timestamptz,
  restore_deadline_at timestamptz,
  court_filing_received boolean not null default false,
  court_filing_notes text,
  restored_at timestamptz,
  repeat_infringer_enforced boolean not null default false,
  account_previous_state text,
  dancer_previous_status text,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dmca_cases_status_check check (
    status in (
      'submitted',
      'needs_information',
      'rejected',
      'disabled',
      'countered',
      'court_hold',
      'restored',
      'closed'
    )
  ),
  constraint dmca_cases_target_type_check check (target_type in ('tv_video', 'profile_media', 'other')),
  constraint dmca_cases_claimant_name_check check (length(trim(claimant_name)) between 2 and 160),
  constraint dmca_cases_claimant_email_check check (length(trim(claimant_email)) between 5 and 320),
  constraint dmca_cases_claimant_phone_check check (length(trim(claimant_phone)) between 7 and 50),
  constraint dmca_cases_claimant_address_check check (length(trim(claimant_address)) between 10 and 1000),
  constraint dmca_cases_work_check check (length(trim(copyrighted_work_description)) between 10 and 4000),
  constraint dmca_cases_signature_check check (length(trim(signature)) between 2 and 160)
);

create table if not exists public.dmca_counter_notices (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.dmca_cases(id) on delete cascade,
  uploader_id uuid not null references public.app_users(id) on delete cascade,
  legal_name text not null,
  email text not null,
  phone text not null,
  address text not null,
  removed_material_location text not null,
  mistake_belief_confirmed boolean not null,
  perjury_confirmed boolean not null,
  jurisdiction_confirmed boolean not null,
  service_confirmed boolean not null,
  signature text not null,
  status text not null default 'submitted',
  forwarded_to_claimant_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dmca_counter_status_check check (status in ('submitted', 'forwarded', 'rejected', 'withdrawn', 'completed')),
  constraint dmca_counter_legal_name_check check (length(trim(legal_name)) between 2 and 160),
  constraint dmca_counter_email_check check (length(trim(email)) between 5 and 320),
  constraint dmca_counter_phone_check check (length(trim(phone)) between 7 and 50),
  constraint dmca_counter_address_check check (length(trim(address)) between 10 and 1000),
  constraint dmca_counter_location_check check (length(trim(removed_material_location)) between 8 and 2000),
  constraint dmca_counter_signature_check check (length(trim(signature)) between 2 and 160)
);

create table if not exists public.dmca_strikes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.dmca_cases(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  active boolean not null default true,
  issued_at timestamptz not null default now(),
  rescinded_at timestamptz,
  rescinded_reason text
);

create index if not exists dmca_cases_status_created_idx
  on public.dmca_cases(status, created_at asc);
create index if not exists dmca_cases_uploader_created_idx
  on public.dmca_cases(uploader_id, created_at desc);
create index if not exists dmca_cases_restore_idx
  on public.dmca_cases(restore_eligible_at asc)
  where status = 'countered' and court_filing_received = false;
create index if not exists dmca_cases_rate_limit_idx
  on public.dmca_cases(request_ip_hash, created_at desc);
create index if not exists dmca_strikes_user_active_idx
  on public.dmca_strikes(user_id, active, issued_at desc);

alter table public.dmca_agent_settings enable row level security;
alter table public.dmca_cases enable row level security;
alter table public.dmca_counter_notices enable row level security;
alter table public.dmca_strikes enable row level security;

drop policy if exists "public reads dmca agent settings" on public.dmca_agent_settings;
create policy "public reads dmca agent settings"
  on public.dmca_agent_settings for select
  using (true);

drop policy if exists "admins manage dmca agent settings" on public.dmca_agent_settings;
create policy "admins manage dmca agent settings"
  on public.dmca_agent_settings for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "uploaders read own dmca cases" on public.dmca_cases;
create policy "uploaders read own dmca cases"
  on public.dmca_cases for select
  using (uploader_id = auth.uid() or public.is_admin());

drop policy if exists "admins manage dmca cases" on public.dmca_cases;
create policy "admins manage dmca cases"
  on public.dmca_cases for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "uploaders read own counter notices" on public.dmca_counter_notices;
create policy "uploaders read own counter notices"
  on public.dmca_counter_notices for select
  using (uploader_id = auth.uid() or public.is_admin());

drop policy if exists "admins manage counter notices" on public.dmca_counter_notices;
create policy "admins manage counter notices"
  on public.dmca_counter_notices for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "users read own dmca strikes" on public.dmca_strikes;
create policy "users read own dmca strikes"
  on public.dmca_strikes for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admins manage dmca strikes" on public.dmca_strikes;
create policy "admins manage dmca strikes"
  on public.dmca_strikes for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.apply_dmca_takedown(
  p_case_id uuid,
  p_admin_id uuid,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.dmca_cases%rowtype;
  v_video public.mydancr_tv_videos%rowtype;
  v_strike_count integer;
  v_account_state text;
  v_dancer_status text;
  v_now timestamptz := now();
begin
  select * into v_case
  from public.dmca_cases
  where id = p_case_id
  for update;

  if v_case.id is null then
    raise exception 'DMCA case not found.';
  end if;

  if v_case.status not in ('submitted', 'needs_information') then
    raise exception 'This DMCA notice cannot be removed from its current state.';
  end if;

  if v_case.target_type <> 'tv_video' or v_case.target_id is null then
    raise exception 'The reported MyDancr video could not be identified.';
  end if;

  select * into v_video
  from public.mydancr_tv_videos
  where id = v_case.target_id
  for update;

  if v_video.id is null then
    raise exception 'The reported MyDancr video no longer exists.';
  end if;

  update public.mydancr_tv_videos
  set
    status = 'hidden',
    published_at = null,
    review_notes = 'Disabled after a validated copyright notice.',
    updated_at = v_now
  where id = v_video.id;

  insert into public.dmca_strikes (case_id, user_id, active, issued_at)
  values (v_case.id, v_video.submitted_by, true, v_now)
  on conflict (case_id) do update
  set active = true, rescinded_at = null, rescinded_reason = null;

  select count(*) into v_strike_count
  from public.dmca_strikes
  where user_id = v_video.submitted_by and active = true;

  select account_state::text into v_account_state
  from public.app_users
  where id = v_video.submitted_by;

  select status::text into v_dancer_status
  from public.dancer_profiles
  where user_id = v_video.submitted_by;

  update public.dmca_cases
  set
    uploader_id = v_video.submitted_by,
    status = 'disabled',
    content_previous_status = coalesce(content_previous_status, v_video.status),
    reviewed_by = p_admin_id,
    reviewed_at = v_now,
    disabled_at = v_now,
    uploader_notified_at = v_now,
    admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
    repeat_infringer_enforced = v_strike_count >= 3,
    account_previous_state = case when v_strike_count >= 3 then v_account_state else account_previous_state end,
    dancer_previous_status = case when v_strike_count >= 3 then v_dancer_status else dancer_previous_status end,
    updated_at = v_now
  where id = v_case.id;

  insert into public.notifications (
    recipient_id,
    notification_type,
    channel,
    title,
    body,
    payload,
    sent_at
  )
  values (
    v_video.submitted_by,
    'dmca_status',
    'in_app',
    'Copyright notice received',
    'A MyDancr TV video was disabled after a copyright notice. You may submit a valid counter-notice from the copyright page.',
    jsonb_build_object('caseId', v_case.id, 'videoId', v_video.id, 'status', 'disabled'),
    v_now
  );

  if v_strike_count >= 3 then
    update public.app_users
    set account_state = 'disabled', dmca_suspended_at = coalesce(dmca_suspended_at, v_now), updated_at = v_now
    where id = v_video.submitted_by;

    update public.dancer_profiles
    set status = 'disabled', dmca_suspended_at = coalesce(dmca_suspended_at, v_now), disabled_at = v_now, updated_at = v_now
    where user_id = v_video.submitted_by;

    update public.mydancr_tv_videos
    set status = 'hidden', published_at = null, updated_at = v_now
    where submitted_by = v_video.submitted_by and status <> 'hidden';

    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    )
    values (
      v_video.submitted_by,
      'dmca_status',
      'in_app',
      'Account suspended for repeated copyright violations',
      'Your account reached three active copyright strikes and has been suspended under the repeat-infringer policy.',
      jsonb_build_object('caseId', v_case.id, 'activeStrikes', v_strike_count, 'status', 'suspended'),
      v_now
    );
  end if;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'dmca_case',
    v_case.id,
    'apply_dmca_takedown',
    concat('Disabled video ', v_video.id, '; active copyright strikes: ', v_strike_count)
  );

  return jsonb_build_object(
    'caseId', v_case.id,
    'videoId', v_video.id,
    'uploaderId', v_video.submitted_by,
    'activeStrikes', v_strike_count,
    'repeatInfringerEnforced', v_strike_count >= 3
  );
end;
$$;

create or replace function public.restore_dmca_case(
  p_case_id uuid,
  p_admin_id uuid default null,
  p_restoration_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.dmca_cases%rowtype;
  v_counter public.dmca_counter_notices%rowtype;
  v_active_strikes integer;
  v_restore_status text;
  v_now timestamptz := now();
begin
  select * into v_case
  from public.dmca_cases
  where id = p_case_id
  for update;

  if v_case.id is null then
    raise exception 'DMCA case not found.';
  end if;

  if v_case.status <> 'countered' or v_case.court_filing_received then
    raise exception 'This DMCA case is not eligible for restoration.';
  end if;

  if v_case.restore_eligible_at is null or v_case.restore_eligible_at > v_now then
    raise exception 'The statutory counter-notice waiting period has not ended.';
  end if;

  select * into v_counter
  from public.dmca_counter_notices
  where case_id = v_case.id
  for update;

  if v_counter.id is null then
    raise exception 'A valid counter-notice is required before restoration.';
  end if;

  if v_counter.forwarded_to_claimant_at is null then
    raise exception 'The counter-notice must be forwarded to the claimant before restoration.';
  end if;

  v_restore_status := case
    when v_case.content_previous_status in ('approved', 'submitted', 'rejected', 'expired') then v_case.content_previous_status
    else 'submitted'
  end;

  if v_case.target_type = 'tv_video' and v_case.target_id is not null then
    update public.mydancr_tv_videos
    set
      status = v_restore_status,
      published_at = case when v_restore_status = 'approved' then coalesce(published_at, v_now) else null end,
      review_notes = 'Restored after the DMCA counter-notice waiting period.',
      updated_at = v_now
    where id = v_case.target_id;
  end if;

  update public.dmca_strikes
  set
    active = false,
    rescinded_at = v_now,
    rescinded_reason = 'Content restored after a valid counter-notice and no timely court filing.'
  where case_id = v_case.id and active = true;

  select count(*) into v_active_strikes
  from public.dmca_strikes
  where user_id = v_case.uploader_id and active = true;

  if v_case.repeat_infringer_enforced and v_active_strikes < 3 and v_case.uploader_id is not null then
    update public.app_users
    set
      account_state = coalesce(v_case.account_previous_state, 'active')::public.account_state,
      dmca_suspended_at = null,
      updated_at = v_now
    where id = v_case.uploader_id and dmca_suspended_at is not null;

    update public.dancer_profiles
    set
      status = coalesce(v_case.dancer_previous_status, 'approved')::public.dancer_status,
      dmca_suspended_at = null,
      disabled_at = case
        when coalesce(v_case.dancer_previous_status, 'approved') = 'disabled' then disabled_at
        else null
      end,
      updated_at = v_now
    where user_id = v_case.uploader_id and dmca_suspended_at is not null;
  end if;

  update public.dmca_cases
  set
    status = 'restored',
    restored_at = v_now,
    reviewed_by = coalesce(p_admin_id, reviewed_by),
    reviewed_at = case when p_admin_id is not null then v_now else reviewed_at end,
    admin_notes = coalesce(nullif(trim(coalesce(p_restoration_notes, '')), ''), admin_notes),
    updated_at = v_now
  where id = v_case.id;

  update public.dmca_counter_notices
  set status = 'completed', updated_at = v_now
  where case_id = v_case.id;

  if v_case.uploader_id is not null then
    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    )
    values (
      v_case.uploader_id,
      'dmca_status',
      'in_app',
      'Copyright case restored',
      'Your content was restored after the counter-notice waiting period ended without a recorded court filing.',
      jsonb_build_object('caseId', v_case.id, 'targetId', v_case.target_id, 'status', 'restored'),
      v_now
    );
  end if;

  if p_admin_id is not null then
    insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
    values (
      p_admin_id,
      'dmca_case',
      v_case.id,
      'restore_dmca_content',
      coalesce(p_restoration_notes, 'Restored after valid counter-notice waiting period.')
    );
  end if;

  return jsonb_build_object(
    'caseId', v_case.id,
    'targetId', v_case.target_id,
    'uploaderId', v_case.uploader_id,
    'activeStrikes', v_active_strikes,
    'status', 'restored'
  );
end;
$$;

revoke all on function public.apply_dmca_takedown(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.restore_dmca_case(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_dmca_takedown(uuid, uuid, text) to service_role;
grant execute on function public.restore_dmca_case(uuid, uuid, text) to service_role;
