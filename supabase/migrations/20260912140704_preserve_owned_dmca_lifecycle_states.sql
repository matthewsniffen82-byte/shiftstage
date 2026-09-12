-- Preserve later independent account, profile and video decisions during copyright enforcement.
begin;
-- DMCA_COMPONENT: ownership.sql
-- Private ownership records invalidate restoration after later independent decisions.
create table public.dmca_enforcement_states (
  target_type text not null check(target_type in('account','dancer_profile','tv_video')),
  target_id uuid not null,
  uploader_id uuid not null references public.app_users(id) on delete cascade,
  previous_state jsonb not null check(jsonb_typeof(previous_state)='object'),
  applied_state jsonb not null check(jsonb_typeof(applied_state)='object'),
  restore_allowed boolean not null default true,
  enforced_at timestamptz not null default now(),
  invalidated_at timestamptz,
  primary key(target_type,target_id),
  check(isfinite(enforced_at) and (invalidated_at is null or isfinite(invalidated_at)))
);
create index dmca_enforcement_states_uploader_idx on public.dmca_enforcement_states(uploader_id);
alter table public.dmca_enforcement_states enable row level security;
revoke all on table public.dmca_enforcement_states from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.dmca_enforcement_states to service_role;

create function public.invalidate_dmca_enforcement_state()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  v_type text;
  v_id uuid;
begin
  if tg_level<>'ROW' or tg_when<>'AFTER' or tg_op not in('UPDATE','DELETE') then
    raise exception 'INVALID_DMCA_STATE_TRIGGER' using errcode='42501';
  end if;
  if tg_relid='public.app_users'::regclass then v_type:='account';
  elsif tg_relid='public.dancer_profiles'::regclass then v_type:='dancer_profile';
  elsif tg_relid='public.mydancr_tv_videos'::regclass then v_type:='tv_video';
  else raise exception 'INVALID_DMCA_STATE_SOURCE' using errcode='42501';
  end if;
  v_id:=old.id;
  if tg_op='DELETE' then
    delete from public.dmca_enforcement_states where target_type=v_type and target_id=v_id;
  else
    -- UPDATE OF attachments deliberately include a same-value decision. An
    -- unrelated caption, display-name or metadata edit does not claim status.
    update public.dmca_enforcement_states set restore_allowed=false,invalidated_at=pg_catalog.clock_timestamp()
      where target_type=v_type and target_id=v_id;
  end if;
  return null;
end;
$function$;
revoke all on function public.invalidate_dmca_enforcement_state() from public,anon,authenticated,service_role;

create trigger invalidate_dmca_account_enforcement
after update of role,account_state,dmca_suspended_at or delete on public.app_users
for each row execute function public.invalidate_dmca_enforcement_state();
create trigger invalidate_dmca_profile_enforcement
after update of user_id,status,disabled_at,admin_disabled_at,dmca_suspended_at,is_public,verification_status,photo_review_status,
approved_at,venue_approved_at,venue_approved_by_user_id,venue_approved_venue_id
or delete on public.dancer_profiles
for each row execute function public.invalidate_dmca_enforcement_state();
create trigger invalidate_dmca_video_enforcement
after update of submitted_by,dancer_id,status,published_at,review_notes,reviewed_by,reviewed_at,moderation_decision,distribution_scope
or delete on public.mydancr_tv_videos
for each row execute function public.invalidate_dmca_enforcement_state();

-- DMCA_COMPONENT: takedown.sql
CREATE OR REPLACE FUNCTION public.apply_dmca_takedown(p_case_id uuid, p_admin_id uuid, p_admin_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
 SET lock_timeout TO '3s'
 SET timezone TO 'UTC'
AS $function$
declare
  v_case public.dmca_cases%rowtype;
  v_video public.mydancr_tv_videos%rowtype;
  v_strike_count integer;
  v_account_state text;
  v_dancer_status text;
  v_now timestamptz := now();
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_item public.mydancr_tv_videos%rowtype;
  v_before jsonb;
  v_applied jsonb;
  v_affected integer;
  v_uploader uuid;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'DMCA_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_case_id is null or p_admin_id is null then
    raise exception 'INVALID_DMCA_ACTION_IDENTITY' using errcode='22023';
  end if;
  if length(coalesce(p_admin_notes,''))>4000 then
    raise exception 'INVALID_DMCA_ACTION_NOTES' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then
    raise exception 'DMCA_ADMIN_REQUIRED' using errcode='42501';
  end if;
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

  select submitted_by into v_uploader from public.mydancr_tv_videos where id=v_case.target_id;
  select * into v_account from public.app_users where id=v_uploader for update;
  select * into v_profile from public.dancer_profiles where user_id=v_uploader for update;
  -- Every case for this uploader shares the account lock. Lock all videos in a
  -- stable order before count/enforcement writes; independent edits hold these
  -- same source rows before invalidating their enforcement snapshot.
  perform 1 from public.mydancr_tv_videos where submitted_by=v_uploader order by id for update;
  select * into v_video from public.mydancr_tv_videos where id=v_case.target_id for update;
  if v_video.id is not null and (v_video.submitted_by is distinct from v_uploader
    or v_account.id is null or v_profile.id is null or v_video.dancer_id<>v_profile.id
    or (v_case.uploader_id is not null and v_case.uploader_id is distinct from v_uploader)) then
    raise exception 'DMCA_TARGET_OWNERSHIP_CHANGED' using errcode='40001';
  end if;

  if v_video.id is null then
    raise exception 'The reported MyDancr video no longer exists.';
  end if;

  select previous_state into v_before from public.dmca_enforcement_states
    where target_type='tv_video' and target_id=v_video.id and uploader_id=v_uploader and restore_allowed
      and applied_state=jsonb_build_object('status',v_video.status,'published_at',v_video.published_at,'review_notes',v_video.review_notes);
  if not found then
    v_before:=jsonb_build_object('status',v_video.status,'published_at',v_video.published_at,'review_notes',v_video.review_notes);
  end if;
  update public.mydancr_tv_videos
  set
    status = 'hidden',
    published_at = null,
    review_notes = 'Disabled after a validated copyright notice.',
    updated_at = v_now
  where id = v_video.id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_VIDEO_WRITE_UNCONFIRMED' using errcode='40001';end if;
  select jsonb_build_object('status',status,'published_at',published_at,'review_notes',review_notes)into v_applied
    from public.mydancr_tv_videos where id=v_video.id;
  insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state,enforced_at)
    values('tv_video',v_video.id,v_uploader,v_before,v_applied,v_now)
    on conflict(target_type,target_id)do update set uploader_id=excluded.uploader_id,previous_state=excluded.previous_state,
      applied_state=excluded.applied_state,restore_allowed=true,enforced_at=excluded.enforced_at,invalidated_at=null;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_SNAPSHOT_WRITE_UNCONFIRMED' using errcode='40001';end if;

  insert into public.dmca_strikes (case_id, user_id, active, issued_at)
  values (v_case.id, v_video.submitted_by, true, v_now)
  on conflict (case_id) do update
  set active = true, rescinded_at = null, rescinded_reason = null
  where dmca_strikes.user_id=excluded.user_id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_STRIKE_WRITE_UNCONFIRMED' using errcode='40001';end if;

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
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_CASE_WRITE_UNCONFIRMED' using errcode='40001';end if;

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
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_NOTIFICATION_WRITE_UNCONFIRMED' using errcode='40001';end if;

  if v_strike_count >= 3 then
    -- Preserve the first still-owned pre-enforcement state across later cases.
    -- A deleted account must never be changed back into a disabled account.
    if v_account.account_state<>'deleted' then
      select previous_state into v_before from public.dmca_enforcement_states
        where target_type='account' and target_id=v_account.id and uploader_id=v_uploader and restore_allowed
          and applied_state=jsonb_build_object('account_state',v_account.account_state,'dmca_suspended_at',v_account.dmca_suspended_at);
      if not found then v_before:=jsonb_build_object('account_state',v_account.account_state,'dmca_suspended_at',v_account.dmca_suspended_at);end if;
      update public.app_users set account_state='disabled',dmca_suspended_at=coalesce(dmca_suspended_at,v_now),updated_at=v_now
        where id=v_uploader returning jsonb_build_object('account_state',account_state,'dmca_suspended_at',dmca_suspended_at)into v_applied;
      if not found then raise exception 'DMCA_ACCOUNT_WRITE_UNCONFIRMED' using errcode='40001';end if;
      insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state,enforced_at)
        values('account',v_uploader,v_uploader,v_before,v_applied,v_now)
        on conflict(target_type,target_id)do update set previous_state=excluded.previous_state,applied_state=excluded.applied_state,
          restore_allowed=true,enforced_at=excluded.enforced_at,invalidated_at=null;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_SNAPSHOT_WRITE_UNCONFIRMED' using errcode='40001';end if;
    end if;
    select previous_state into v_before from public.dmca_enforcement_states
      where target_type='dancer_profile' and target_id=v_profile.id and uploader_id=v_uploader and restore_allowed
        and applied_state=jsonb_build_object('status',v_profile.status,'disabled_at',v_profile.disabled_at,'dmca_suspended_at',v_profile.dmca_suspended_at);
    if not found then v_before:=jsonb_build_object('status',v_profile.status,'disabled_at',v_profile.disabled_at,'dmca_suspended_at',v_profile.dmca_suspended_at);end if;
    update public.dancer_profiles set status='disabled',dmca_suspended_at=coalesce(dmca_suspended_at,v_now),disabled_at=v_now,updated_at=v_now
      where id=v_profile.id returning jsonb_build_object('status',status,'disabled_at',disabled_at,'dmca_suspended_at',dmca_suspended_at)into v_applied;
    if not found then raise exception 'DMCA_PROFILE_WRITE_UNCONFIRMED' using errcode='40001';end if;
    insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state,enforced_at)
      values('dancer_profile',v_profile.id,v_uploader,v_before,v_applied,v_now)
      on conflict(target_type,target_id)do update set previous_state=excluded.previous_state,applied_state=excluded.applied_state,
        restore_allowed=true,enforced_at=excluded.enforced_at,invalidated_at=null;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_SNAPSHOT_WRITE_UNCONFIRMED' using errcode='40001';end if;
    for v_item in select * from public.mydancr_tv_videos where submitted_by=v_uploader and status<>'hidden' order by id loop
      if v_item.dancer_id<>v_profile.id then raise exception 'DMCA_TARGET_OWNERSHIP_CHANGED' using errcode='40001';end if;
      v_before:=jsonb_build_object('status',v_item.status,'published_at',v_item.published_at,'review_notes',v_item.review_notes);
      update public.mydancr_tv_videos set status='hidden',published_at=null,updated_at=v_now where id=v_item.id
        returning jsonb_build_object('status',status,'published_at',published_at,'review_notes',review_notes)into v_applied;
      if not found then raise exception 'DMCA_VIDEO_WRITE_UNCONFIRMED' using errcode='40001';end if;
      insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state,enforced_at)
        values('tv_video',v_item.id,v_uploader,v_before,v_applied,v_now)
        on conflict(target_type,target_id)do update set previous_state=excluded.previous_state,applied_state=excluded.applied_state,
          restore_allowed=true,enforced_at=excluded.enforced_at,invalidated_at=null;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_SNAPSHOT_WRITE_UNCONFIRMED' using errcode='40001';end if;
    end loop;

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
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_NOTIFICATION_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'dmca_case',
    v_case.id,
    'apply_dmca_takedown',
    concat('Disabled video ', v_video.id, '; active copyright strikes: ', v_strike_count)
  );
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_AUDIT_WRITE_UNCONFIRMED' using errcode='40001';end if;

  return jsonb_build_object(
    'caseId', v_case.id,
    'videoId', v_video.id,
    'uploaderId', v_video.submitted_by,
    'activeStrikes', v_strike_count,
    'repeatInfringerEnforced', v_strike_count >= 3
  );
end;
$function$
;

-- DMCA_COMPONENT: restoration.sql
-- Resolve an eligible copyright case while preserving independent restrictions.
create or replace function public.restore_dmca_case(p_case_id uuid,p_admin_id uuid default null,p_restoration_notes text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' set timezone='UTC'
as $function$
declare
  v_case public.dmca_cases%rowtype;
  v_counter public.dmca_counter_notices%rowtype;
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_video public.mydancr_tv_videos%rowtype;
  v_state public.dmca_enforcement_states%rowtype;
  v_active_strikes integer;
  v_now timestamptz:=now();
  v_owned boolean;
  v_affected integer;
  v_outcome text:='missing_content';
  v_status text;
  v_account_removed boolean:=false;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'DMCA_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_case_id is null or length(coalesce(p_restoration_notes,''))>4000 then
    raise exception 'INVALID_DMCA_RESTORATION_INPUT' using errcode='22023';
  end if;
  if p_admin_id is not null and not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then
    raise exception 'DMCA_ADMIN_REQUIRED' using errcode='42501';
  end if;
  select * into v_case from public.dmca_cases where id=p_case_id for update;
  if not found then raise exception 'DMCA case not found.';end if;
  if v_case.status<>'countered' or v_case.court_filing_received then
    raise exception 'This DMCA case is not eligible for restoration.';
  end if;
  if v_case.restore_eligible_at is null or not isfinite(v_case.restore_eligible_at) or v_case.restore_eligible_at>v_now then
    raise exception 'The statutory counter-notice waiting period has not ended.';
  end if;
  select * into v_counter from public.dmca_counter_notices where case_id=v_case.id for update;
  if not found then
    -- Account deletion retains the case while the original foreign keys remove
    -- its counter-notice and strikes. Resolve only the retained case when its
    -- completed waiting-period evidence remains and there is no content left.
    v_account_removed:=v_case.uploader_id is null and v_case.counter_received_at is not null
      and isfinite(v_case.counter_received_at) and v_case.counter_received_at<=v_now
      and not exists(select 1 from public.mydancr_tv_videos where id=v_case.target_id)
      and not exists(select 1 from public.dmca_strikes where case_id=v_case.id);
    if not v_account_removed then raise exception 'A valid counter-notice must be forwarded before restoration.';end if;
  elsif v_counter.status<>'forwarded' or v_counter.forwarded_to_claimant_at is null
    or not isfinite(v_counter.forwarded_to_claimant_at) or v_counter.forwarded_to_claimant_at>v_now
    or not v_counter.mistake_belief_confirmed or not v_counter.perjury_confirmed
    or not v_counter.jurisdiction_confirmed or not v_counter.service_confirmed then
    raise exception 'A valid counter-notice must be forwarded before restoration.';
  end if;
  if v_case.uploader_id is distinct from v_counter.uploader_id then
    raise exception 'DMCA_CASE_OWNERSHIP_CHANGED' using errcode='40001';
  end if;
  select * into v_account from public.app_users where id=v_case.uploader_id for update;
  select * into v_profile from public.dancer_profiles where user_id=v_case.uploader_id for update;
  perform 1 from public.mydancr_tv_videos where submitted_by=v_case.uploader_id order by id for update;

  if not v_account_removed then
    update public.dmca_strikes set active=false,rescinded_at=v_now,
      rescinded_reason='Copyright restriction cleared after a valid counter-notice and no timely court filing.'
      where case_id=v_case.id and user_id=v_case.uploader_id and active;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_STRIKE_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;
  select count(*)into v_active_strikes from public.dmca_strikes where user_id=v_case.uploader_id and active;

  if v_active_strikes<3 then
    select * into v_state from public.dmca_enforcement_states
      where target_type='account' and target_id=v_case.uploader_id and uploader_id=v_case.uploader_id for update;
    if found and v_account.id is not null then
      v_owned:=v_state.restore_allowed and v_state.applied_state=
        jsonb_build_object('account_state',v_account.account_state,'dmca_suspended_at',v_account.dmca_suspended_at);
      update public.app_users set
        account_state=case when v_owned then (v_state.previous_state->>'account_state')::public.account_state else account_state end,
        dmca_suspended_at=case when to_jsonb(dmca_suspended_at) is not distinct from v_state.applied_state->'dmca_suspended_at'
          then null else dmca_suspended_at end,
        updated_at=v_now where id=v_case.uploader_id returning * into v_account;
      if not found then raise exception 'DMCA_ACCOUNT_WRITE_UNCONFIRMED' using errcode='40001';end if;
      delete from public.dmca_enforcement_states where target_type='account' and target_id=v_case.uploader_id;
    end if;
    select * into v_state from public.dmca_enforcement_states
      where target_type='dancer_profile' and target_id=v_profile.id and uploader_id=v_case.uploader_id for update;
    if found and v_profile.id is not null then
      v_owned:=v_account.account_state='active' and v_profile.admin_disabled_at is null
        and v_state.restore_allowed and v_state.applied_state=
        jsonb_build_object('status',v_profile.status,'disabled_at',v_profile.disabled_at,'dmca_suspended_at',v_profile.dmca_suspended_at);
      update public.dancer_profiles set
        status=case when v_owned then (v_state.previous_state->>'status')::public.dancer_status else status end,
        disabled_at=case when v_owned then (v_state.previous_state->>'disabled_at')::timestamptz else disabled_at end,
        dmca_suspended_at=case when to_jsonb(dmca_suspended_at) is not distinct from v_state.applied_state->'dmca_suspended_at'
          then null else dmca_suspended_at end,
        updated_at=v_now where id=v_profile.id returning * into v_profile;
      if not found then raise exception 'DMCA_PROFILE_WRITE_UNCONFIRMED' using errcode='40001';end if;
      delete from public.dmca_enforcement_states where target_type='dancer_profile' and target_id=v_profile.id;
    end if;
  end if;

  -- Clear only snapshots no longer needed by another active copyright case or
  -- the repeat-strike restriction. Never manufacture an old per-case snapshot.
  for v_state in select * from public.dmca_enforcement_states
    where target_type='tv_video' and uploader_id=v_case.uploader_id order by target_id for update
  loop
    select * into v_video from public.mydancr_tv_videos where id=v_state.target_id;
    if v_video.id is null then
      delete from public.dmca_enforcement_states where target_type='tv_video' and target_id=v_state.target_id;
      continue;
    end if;
    if exists(select 1 from public.dmca_strikes strike join public.dmca_cases other_case on other_case.id=strike.case_id
      where strike.active and other_case.target_type='tv_video' and other_case.target_id=v_video.id) then
      if v_video.id=v_case.target_id then v_outcome:='another_active_case';end if;
      continue;
    end if;
    if v_active_strikes>=3 then
      if v_video.id=v_case.target_id then v_outcome:='repeat_strike_restriction';end if;
      continue;
    end if;
    v_owned:=v_state.restore_allowed and v_video.submitted_by=v_case.uploader_id and v_video.dancer_id=v_profile.id
      and v_state.applied_state=jsonb_build_object('status',v_video.status,'published_at',v_video.published_at,'review_notes',v_video.review_notes);
    if v_owned and v_account.account_state='active' and v_profile.status<>'disabled'
      and v_profile.admin_disabled_at is null and v_profile.dmca_suspended_at is null then
      update public.mydancr_tv_videos set status=v_state.previous_state->>'status',
        published_at=(v_state.previous_state->>'published_at')::timestamptz,
        review_notes=v_state.previous_state->>'review_notes',updated_at=v_now where id=v_video.id;
      get diagnostics v_affected=row_count;
      if v_affected<>1 then raise exception 'DMCA_VIDEO_WRITE_UNCONFIRMED' using errcode='40001';end if;
      if v_video.id=v_case.target_id then v_outcome:='previous_state_restored';end if;
    else
      if v_video.id=v_case.target_id then v_outcome:='independent_decision_preserved';end if;
    end if;
    delete from public.dmca_enforcement_states where target_type='tv_video' and target_id=v_video.id;
  end loop;
  select status into v_status from public.mydancr_tv_videos where id=v_case.target_id;
  if found and v_outcome='missing_content' then v_outcome:='independent_decision_preserved';end if;

  update public.dmca_cases set status='restored',restored_at=v_now,
    reviewed_by=coalesce(p_admin_id,reviewed_by),reviewed_at=case when p_admin_id is not null then v_now else reviewed_at end,
    admin_notes=coalesce(nullif(trim(coalesce(p_restoration_notes,'')),''),admin_notes),updated_at=v_now where id=v_case.id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_CASE_WRITE_UNCONFIRMED' using errcode='40001';end if;
  if not v_account_removed then
    update public.dmca_counter_notices set status='completed',updated_at=v_now where id=v_counter.id;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_COUNTER_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;
  if v_case.uploader_id is not null then
    insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
    values(v_case.uploader_id,'dmca_status','in_app','Copyright case resolved',
      'The copyright restriction for this case was cleared after the counter-notice waiting period. Other account or content restrictions may still apply.',
      jsonb_build_object('caseId',v_case.id,'targetId',v_case.target_id,'status','restored','restorationOutcome',v_outcome),v_now);
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_NOTIFICATION_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;
  if p_admin_id is not null then
    insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
      values(p_admin_id,'dmca_case',v_case.id,'restore_dmca_content',
        concat(coalesce(p_restoration_notes,'Resolved after valid counter-notice waiting period.'),'; outcome: ',v_outcome));
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_AUDIT_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;
  return jsonb_build_object('caseId',v_case.id,'targetId',v_case.target_id,'uploaderId',v_case.uploader_id,
    'activeStrikes',v_active_strikes,'status','restored','restorationOutcome',v_outcome,'contentStatus',v_status);
end;
$function$;

-- DMCA_COMPONENT: admin-transition.sql
-- Require the expected case version and commit administrator decisions with their audit.
create function public.transition_dmca_admin_case(
  p_case_id uuid,p_admin_id uuid,p_action text,p_expected_status text,
  p_expected_updated_at timestamptz,p_notes text default null
)returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' set timezone='UTC'
as $function$
declare
  v_case public.dmca_cases%rowtype;
  v_status text;
  v_notes text:=nullif(btrim(coalesce(p_notes,'')),'');
  v_now timestamptz;
  v_rows integer;
  v_court_received boolean;
  v_court_notes text;
begin
  if p_admin_id is null or not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then
    raise exception 'DMCA_ADMIN_REQUIRED' using errcode='42501';
  end if;
  if p_case_id is null or p_action is null or p_action not in('request_information','reject','record_court_action','close')
    or p_expected_status is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or length(coalesce(p_notes,''))>4000 then
    raise exception 'INVALID_DMCA_ADMIN_TRANSITION' using errcode='22023';
  end if;
  select * into v_case from public.dmca_cases where id=p_case_id for update;
  if not found then raise exception 'DMCA_CASE_NOT_FOUND' using errcode='P0002';end if;
  if v_case.status is distinct from p_expected_status or v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'DMCA_CASE_CHANGED' using errcode='40001';
  end if;
  -- Match the existing administrator panel's offered state/action pairs.
  if p_action in('request_information','reject') and v_case.status not in('submitted','needs_information')
    or p_action='record_court_action' and (v_case.status<>'countered' or v_notes is null)
    or p_action='close' and v_case.status<>'court_hold' then
    raise exception 'DMCA_ACTION_NOT_AVAILABLE' using errcode='22023';
  end if;
  v_status:=case p_action when 'request_information'then'needs_information' when'reject'then'rejected'
    when'record_court_action'then'court_hold' else'closed'end;
  v_now:=clock_timestamp();
  v_court_received:=case when p_action='record_court_action'then true else v_case.court_filing_received end;
  v_court_notes:=case when p_action='record_court_action'then v_notes else v_case.court_filing_notes end;
  update public.dmca_cases set status=v_status,reviewed_by=p_admin_id,reviewed_at=v_now,updated_at=v_now,
    admin_notes=v_notes,court_filing_received=case when p_action='record_court_action'then true else court_filing_received end,
    court_filing_notes=case when p_action='record_court_action'then v_notes else court_filing_notes end
    where id=p_case_id returning * into v_case;
  if not found or row(v_case.id,v_case.status,v_case.reviewed_by,v_case.reviewed_at,v_case.updated_at,v_case.admin_notes,v_case.court_filing_received,v_case.court_filing_notes)
    is distinct from row(p_case_id,v_status,p_admin_id,v_now,v_now,v_notes,v_court_received,v_court_notes) then
    raise exception 'DMCA_CASE_WRITE_UNCONFIRMED' using errcode='40001';end if;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_admin_id,'dmca_case',p_case_id,'dmca_'||p_action,v_notes);
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'DMCA_AUDIT_WRITE_UNCONFIRMED' using errcode='40001';end if;
  return jsonb_build_object('caseId',v_case.id,'status',v_case.status,'updatedAt',v_case.updated_at);
end;
$function$;
revoke all on function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamptz,text)from public,anon,authenticated,service_role;
grant execute on function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamptz,text)to service_role;

-- DMCA_COMPONENT: counter-submission.sql
-- Confirm counter-notice and case writes within their existing atomic transaction.
CREATE OR REPLACE FUNCTION public.submit_dmca_counter_notice_safely(p_user_id uuid, p_case_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_case public.dmca_cases%rowtype;
  v_counter public.dmca_counter_notices%rowtype;
  v_field record;
  v_legal_name text; v_email text; v_phone text; v_address text;
  v_location text; v_signature text;
  v_now timestamptz; v_day timestamptz; v_eligible timestamptz; v_deadline timestamptz;
  v_weekdays integer := 0;
  v_duplicate boolean := false;
begin
  if p_user_id is null or p_case_id is null or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'INVALID_COUNTER_NOTICE' using errcode='22023';
  end if;
  for v_field in select * from (values ('legalName',2,160),('email',5,320),('phone',7,50),
    ('address',10,1000),('removedMaterialLocation',8,2000),('signature',2,160)) as fields(name,minimum,maximum)
  loop
    if jsonb_typeof(p_details->v_field.name) is distinct from 'string'
      or char_length(btrim(p_details->>v_field.name)) not between v_field.minimum and v_field.maximum then
      raise exception 'INVALID_COUNTER_NOTICE' using errcode='22023';
    end if;
  end loop;
  if p_details->'mistakeBeliefConfirmed' is distinct from 'true'::jsonb
    or p_details->'perjuryConfirmed' is distinct from 'true'::jsonb
    or p_details->'jurisdictionConfirmed' is distinct from 'true'::jsonb
    or p_details->'serviceConfirmed' is distinct from 'true'::jsonb then
    raise exception 'COUNTER_NOTICE_CONFIRMATIONS_REQUIRED' using errcode='22023';
  end if;
  v_legal_name:=btrim(p_details->>'legalName'); v_email:=lower(btrim(p_details->>'email'));
  v_phone:=btrim(p_details->>'phone'); v_address:=btrim(p_details->>'address');
  v_location:=btrim(p_details->>'removedMaterialLocation'); v_signature:=btrim(p_details->>'signature');
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_COUNTER_NOTICE_EMAIL' using errcode='22023';
  end if;

  -- Match takedown/restoration case-first locking. Do not block an authenticated
  -- uploader's appeal merely because their application account is disabled.
  select * into v_case from public.dmca_cases where id=p_case_id and uploader_id=p_user_id for update;
  if not found then raise exception 'COUNTER_NOTICE_CASE_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_counter from public.dmca_counter_notices where case_id=p_case_id for update;
  if found then
    if row(v_counter.uploader_id,v_counter.legal_name,v_counter.email,v_counter.phone,v_counter.address,
      v_counter.removed_material_location,v_counter.signature,v_counter.mistake_belief_confirmed,
      v_counter.perjury_confirmed,v_counter.jurisdiction_confirmed,v_counter.service_confirmed)
      is distinct from row(p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,v_signature,true,true,true,true) then
      raise exception 'COUNTER_NOTICE_ALREADY_HAS_DIFFERENT_DETAILS' using errcode='23505';
    end if;
    if v_case.status='disabled' or v_case.counter_received_at is null
      or v_case.restore_eligible_at is null or v_case.restore_deadline_at is null then
      raise exception 'COUNTER_NOTICE_RECEIPT_UNCONFIRMED' using errcode='40001';
    end if;
    v_duplicate:=true;
  else
    if v_case.status<>'disabled' then raise exception 'COUNTER_NOTICE_CASE_NOT_ELIGIBLE' using errcode='22023'; end if;
    v_now:=clock_timestamp(); v_day:=v_now;
    -- Same UTC weekdays rule as the existing application helper, independent
    -- of the session timezone and daylight-saving interval length.
    while v_weekdays<14 loop
      v_day:=((v_day at time zone 'UTC')+interval '1 day') at time zone 'UTC';
      if extract(isodow from v_day at time zone 'UTC')<6 then
        v_weekdays:=v_weekdays+1;
        if v_weekdays=10 then v_eligible:=v_day; end if;
      end if;
    end loop;
    v_deadline:=v_day;
    insert into public.dmca_counter_notices(case_id,uploader_id,legal_name,email,phone,address,
      removed_material_location,mistake_belief_confirmed,perjury_confirmed,jurisdiction_confirmed,
      service_confirmed,signature,status,created_at,updated_at)
      values(p_case_id,p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,true,true,true,true,
        v_signature,'submitted',v_now,v_now) returning * into v_counter;
    if not found or v_counter.id is null or row(v_counter.case_id,v_counter.uploader_id,v_counter.legal_name,v_counter.email,
      v_counter.phone,v_counter.address,v_counter.removed_material_location,v_counter.signature,v_counter.status,
      v_counter.mistake_belief_confirmed,v_counter.perjury_confirmed,v_counter.jurisdiction_confirmed,v_counter.service_confirmed)
      is distinct from row(p_case_id,p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,v_signature,'submitted',true,true,true,true) then
      raise exception 'COUNTER_NOTICE_INSERT_UNCONFIRMED' using errcode='40001';
    end if;
    update public.dmca_cases set status='countered',counter_received_at=v_now,
      restore_eligible_at=v_eligible,restore_deadline_at=v_deadline,updated_at=v_now
      where id=p_case_id and uploader_id=p_user_id and status='disabled' returning * into v_case;
    if not found or row(v_case.id,v_case.uploader_id,v_case.status,v_case.counter_received_at,v_case.restore_eligible_at,v_case.restore_deadline_at)
      is distinct from row(p_case_id,p_user_id,'countered',v_now,v_eligible,v_deadline) then
      raise exception 'COUNTER_NOTICE_TRANSITION_UNCONFIRMED' using errcode='40001';
    end if;
  end if;
  return jsonb_build_object('duplicate',v_duplicate,
    'counter',jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'created_at',v_counter.created_at),
    'case',jsonb_build_object('id',v_case.id,'status',v_case.status,'counter_received_at',v_case.counter_received_at,
      'restore_eligible_at',v_case.restore_eligible_at,'restore_deadline_at',v_case.restore_deadline_at,
      'claimant_name',v_case.claimant_name,'claimant_email',v_case.claimant_email));
end;
$function$
;

-- DMCA_COMPONENT: counter-forwarding.sql
-- Record an already acknowledged email delivery and retain its original receipt.
create function public.confirm_dmca_counter_forwarding(p_counter_id uuid,p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' set timezone='UTC'
as $function$
declare
 v_case public.dmca_cases%rowtype;
 v_counter public.dmca_counter_notices%rowtype;
 v_now timestamptz;
begin
 if p_counter_id is null or p_case_id is null then raise exception 'INVALID_COUNTER_FORWARDING_IDENTITY' using errcode='22023';end if;
 select * into v_case from public.dmca_cases where id=p_case_id for update;
 if not found then raise exception 'COUNTER_FORWARDING_CASE_MISSING' using errcode='P0002';end if;
 select * into v_counter from public.dmca_counter_notices where id=p_counter_id and case_id=p_case_id for update;
 if not found or v_counter.uploader_id is distinct from v_case.uploader_id then raise exception 'COUNTER_FORWARDING_IDENTITY_CHANGED' using errcode='40001';end if;
 v_now:=clock_timestamp();
 if v_counter.status in('forwarded','completed') and v_counter.forwarded_to_claimant_at is not null
   and isfinite(v_counter.forwarded_to_claimant_at) and v_counter.forwarded_to_claimant_at<=v_now then
  return jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'forwarded_to_claimant_at',v_counter.forwarded_to_claimant_at);
 end if;
 if v_case.status not in('countered','court_hold','closed') or v_counter.status<>'submitted' or v_counter.forwarded_to_claimant_at is not null then
  raise exception 'COUNTER_FORWARDING_STATE_CHANGED' using errcode='40001';
 end if;
 update public.dmca_counter_notices set status='forwarded',forwarded_to_claimant_at=v_now,updated_at=v_now
  where id=p_counter_id and case_id=p_case_id and status='submitted' and forwarded_to_claimant_at is null returning * into v_counter;
 if not found or v_counter.id is distinct from p_counter_id or v_counter.case_id is distinct from p_case_id
  or v_counter.uploader_id is distinct from v_case.uploader_id or v_counter.status<>'forwarded'
  or v_counter.forwarded_to_claimant_at is distinct from v_now or v_counter.updated_at is distinct from v_now then
  raise exception 'COUNTER_FORWARDING_WRITE_UNCONFIRMED' using errcode='40001';
 end if;
 return jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'forwarded_to_claimant_at',v_counter.forwarded_to_claimant_at);
end;
$function$;
revoke all on function public.confirm_dmca_counter_forwarding(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_dmca_counter_forwarding(uuid,uuid) to service_role;

commit;
