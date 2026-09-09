-- Administrative profile suspensions must survive account self-pause/resume.
-- Apply in a transaction. Refuse an ambiguous existing suspension population;
-- the reviewed production population has none, so no provenance is guessed.
lock table public.dancer_profiles in share row exclusive mode;
do $preflight$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='dancer_profiles' and column_name='admin_disabled_at')
    and exists (select 1 from public.dancer_profiles where status='disabled' or disabled_at is not null) then
    raise exception using errcode='55000', message='Review existing profile suspensions before applying this migration.';
  end if;
end;
$preflight$;
alter table public.dancer_profiles add column if not exists admin_disabled_at timestamptz;
revoke all (admin_disabled_at) on public.dancer_profiles from anon, authenticated;

create or replace function public.transition_dancer_publication_safely(
  p_dancer_id uuid, p_transition text, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile public.dancer_profiles%rowtype;
  v_account public.app_users%rowtype;
  v_owner boolean;
  v_admin boolean;
  v_update jsonb;
  v_status public.dancer_status;
begin
  if p_actor_user_id is null then raise exception using errcode='42501',message='An authorized actor is required.'; end if;
  select * into v_profile from public.dancer_profiles where id=p_dancer_id;
  if not found then raise exception using errcode='P0002',message='Dancer profile not found.'; end if;
  -- Account before profile is the same order used by account-state changes.
  select * into v_account from public.app_users where id=v_profile.user_id for update;
  if not found or v_account.role<>'dancer' then raise exception using errcode='P0002',message='Dancer account not found.'; end if;
  select * into v_profile from public.dancer_profiles where id=p_dancer_id for update;
  if not found or v_profile.user_id<>v_account.id then raise exception using errcode='P0002',message='Dancer profile changed.'; end if;
  v_owner := p_actor_user_id=v_profile.user_id;
  v_admin := exists(select 1 from public.app_users where id=p_actor_user_id and role='admin' and account_state='active');
  if not (v_owner or v_admin) then raise exception using errcode='42501',message='Unauthorized profile change.'; end if;
  if p_transition='submit_for_venue_review' then
    if not v_owner or v_account.account_state<>'active' or v_profile.disabled_at is not null or v_profile.admin_disabled_at is not null or v_profile.status='disabled' then
      raise exception using errcode='42501',message='Only the active dancer can submit this profile.';
    end if;
    v_update := jsonb_build_object('status','pending_review','verification_status','pending','approved_at',null,'is_public',false);
  elsif p_transition in ('admin_accept','admin_reject') then
    if not v_admin then raise exception using errcode='42501',message='An active admin account is required.'; end if;
    v_update := jsonb_build_object('status',case when p_transition='admin_accept' then 'pending_review' else 'rejected' end,
      'verification_status',case when p_transition='admin_accept' then 'pending' else 'rejected' end,'approved_at',null,'is_public',false);
  elsif p_transition in ('set_public','set_private') then
    if not v_owner then raise exception using errcode='42501',message='Only the dancer can change profile visibility.'; end if;
    if p_transition='set_public' and (v_account.account_state<>'active' or v_profile.status<>'approved'
      or v_profile.verification_status<>'approved' or v_profile.approved_at is null
      or v_profile.venue_approved_at is null or v_profile.disabled_at is not null or v_profile.admin_disabled_at is not null) then
      raise exception using errcode='22023',message='Profile approval is required before reactivation.';
    end if;
    v_update := jsonb_build_object('is_public',p_transition='set_public');
  elsif p_transition='disable' then
    v_update := jsonb_build_object('status','disabled','disabled_at',clock_timestamp(),'is_public',false);
    if v_admin then v_update := v_update || jsonb_build_object('admin_disabled_at',clock_timestamp()); end if;
  elsif p_transition='reactivate' then
    if v_account.account_state<>'active' then raise exception using errcode='22023',message='The dancer account must be active before reactivation.'; end if;
    -- Resuming a login account does not undo an administrative profile suspension.
    if v_profile.admin_disabled_at is not null and not v_admin then
      v_update := jsonb_build_object('status','disabled','is_public',false);
    else
      v_status := case when v_profile.verification_status='rejected' or v_profile.status='rejected' then 'rejected'::public.dancer_status
        when v_profile.verification_status='approved' and v_profile.approved_at is not null and v_profile.venue_approved_at is not null then 'approved'::public.dancer_status
        else 'pending_review'::public.dancer_status end;
      v_update := jsonb_build_object('status',v_status,'disabled_at',null,'admin_disabled_at',null,'is_public',v_status='approved');
    end if;
  else raise exception using errcode='22023',message='Unknown dancer publication transition.';
  end if;
  update public.dancer_profiles d set
    status=coalesce((v_update->>'status')::public.dancer_status,d.status),
    verification_status=coalesce((v_update->>'verification_status')::public.review_status,d.verification_status),
    approved_at=case when v_update ? 'approved_at' then (v_update->>'approved_at')::timestamptz else d.approved_at end,
    disabled_at=case when v_update ? 'disabled_at' then (v_update->>'disabled_at')::timestamptz else d.disabled_at end,
    admin_disabled_at=case when v_update ? 'admin_disabled_at' then (v_update->>'admin_disabled_at')::timestamptz else d.admin_disabled_at end,
    is_public=coalesce((v_update->>'is_public')::boolean,d.is_public), updated_at=clock_timestamp()
  where d.id=p_dancer_id returning d.* into v_profile;
  return jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,'status',v_profile.status,
    'verification_status',v_profile.verification_status,'approved_at',v_profile.approved_at,
    'is_public',v_profile.is_public,'disabled_at',v_profile.disabled_at,'venue_approved_at',v_profile.venue_approved_at,
    'venue_approved_by_user_id',v_profile.venue_approved_by_user_id,'venue_approved_venue_id',v_profile.venue_approved_venue_id);
end; $$;
revoke all on function public.transition_dancer_publication_safely(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.transition_dancer_publication_safely(uuid,text,uuid) to service_role;
