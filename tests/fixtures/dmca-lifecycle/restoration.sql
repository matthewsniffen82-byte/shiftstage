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
