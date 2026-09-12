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
