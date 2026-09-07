begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Live catalog had only the customer-leading favorites key and recipient index.
-- These predicates are used by the bounded per-dancer ranking aggregates below.
create index if not exists favorites_dancer_created_idx on public.favorites(dancer_id,created_at);
create index if not exists notifications_dancer_opened_created_idx
  on public.notifications((payload->>'dancerId'),created_at) where read_at is not null;

create or replace function public.provision_app_account_safely(
  p_user_id uuid, p_role text, p_email text, p_display_name text, p_city text
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role public.user_role;
begin
  if p_user_id is null or p_role is null or p_role not in ('customer','dancer','venue','admin') then
    raise exception using errcode='22023', message='Invalid account provisioning input.';
  end if;
  insert into public.app_users(id,role,email,display_name)
  values(p_user_id,p_role::public.user_role,p_email,case when p_role='dancer' then 'Dancer' else p_display_name end)
  on conflict(id) do nothing;
  select role into v_role from public.app_users where id=p_user_id for update;
  if v_role::text <> p_role then
    raise exception using errcode='22023', message='Existing account type must be preserved.';
  end if;
  if p_role='customer' then
    insert into public.customer_profiles(user_id,city) values(p_user_id,coalesce(p_city,''))
    on conflict(user_id) do nothing;
  elsif p_role='dancer' then
    -- Match the existing Auth bootstrap's private legacy NOT NULL placeholder.
    insert into public.dancer_profiles(user_id,real_name,stage_name,slug,city,status,
      verification_status,photo_review_status,is_public,approved_at,disabled_at,identity_saved_at)
    values(p_user_id,'Verification pending','','dancer-'||p_user_id::text,coalesce(p_city,''),
      'draft','pending','pending',false,null,null,null)
    on conflict(user_id) do nothing;
  end if;
  return true;
end; $$;
revoke all on function public.provision_app_account_safely(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.provision_app_account_safely(uuid,text,text,text,text) to service_role;

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
    if not v_owner or v_account.account_state<>'active' or v_profile.disabled_at is not null or v_profile.status='disabled' then
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
      or v_profile.venue_approved_at is null or v_profile.disabled_at is not null) then
      raise exception using errcode='22023',message='Profile approval is required before reactivation.';
    end if;
    v_update := jsonb_build_object('is_public',p_transition='set_public');
  elsif p_transition='disable' then
    v_update := jsonb_build_object('status','disabled','disabled_at',clock_timestamp(),'is_public',false);
  elsif p_transition='reactivate' then
    if v_account.account_state<>'active' then raise exception using errcode='22023',message='The dancer account must be active before reactivation.'; end if;
    v_status := case when v_profile.verification_status='rejected' or v_profile.status='rejected' then 'rejected'::public.dancer_status
      when v_profile.verification_status='approved' and v_profile.approved_at is not null and v_profile.venue_approved_at is not null then 'approved'::public.dancer_status
      else 'pending_review'::public.dancer_status end;
    v_update := jsonb_build_object('status',v_status,'disabled_at',null,'is_public',v_status='approved');
  else raise exception using errcode='22023',message='Unknown dancer publication transition.';
  end if;
  update public.dancer_profiles d set
    status=coalesce((v_update->>'status')::public.dancer_status,d.status),
    verification_status=coalesce((v_update->>'verification_status')::public.review_status,d.verification_status),
    approved_at=case when v_update ? 'approved_at' then (v_update->>'approved_at')::timestamptz else d.approved_at end,
    disabled_at=case when v_update ? 'disabled_at' then (v_update->>'disabled_at')::timestamptz else d.disabled_at end,
    is_public=coalesce((v_update->>'is_public')::boolean,d.is_public), updated_at=clock_timestamp()
  where d.id=p_dancer_id returning d.* into v_profile;
  return jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,'status',v_profile.status,
    'verification_status',v_profile.verification_status,'approved_at',v_profile.approved_at,
    'is_public',v_profile.is_public,'disabled_at',v_profile.disabled_at,'venue_approved_at',v_profile.venue_approved_at,
    'venue_approved_by_user_id',v_profile.venue_approved_by_user_id,'venue_approved_venue_id',v_profile.venue_approved_venue_id);
end; $$;
revoke all on function public.transition_dancer_publication_safely(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.transition_dancer_publication_safely(uuid,text,uuid) to service_role;

create or replace function public.get_ranking_metric_batch(p_dancer_ids uuid[],p_since timestamptz)
returns table(dancer_id uuid,metrics jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_since is null or p_dancer_ids is null or cardinality(p_dancer_ids)>200 then
    raise exception using errcode='22023',message='Ranking batch must contain at most 200 dancers and a start time.';
  end if;
  return query select d.id,jsonb_build_object(
    'profileViews',(select count(*) from public.profile_views x where x.dancer_id=d.id and x.viewed_at>=p_since),
    'scheduleViews',(select count(*) from public.schedule_views x where x.dancer_id=d.id and x.viewed_at>=p_since),
    'followers',(select count(*) from public.follows x where x.dancer_id=d.id and x.created_at>=p_since),
    'favorites',(select count(*) from public.favorites x where x.dancer_id=d.id and x.created_at>=p_since),
    'directionRequests',(select count(*) from public.direction_requests x where x.dancer_id=d.id and x.requested_at>=p_since),
    'goingSignals',(select count(*) from public.going_signals x join public.shifts s on s.id=x.shift_id where s.dancer_id=d.id and x.created_at>=p_since),
    'notificationOpens',(select count(*) from public.notifications x where x.payload->>'dancerId'=d.id::text and x.read_at is not null and x.created_at>=p_since),
    'socialClicks',(select count(*) from public.social_clicks x where x.dancer_id=d.id and x.clicked_at>=p_since)
  ) from public.dancer_profiles d where d.id=any(p_dancer_ids);
end; $$;
revoke all on function public.get_ranking_metric_batch(uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.get_ranking_metric_batch(uuid[],timestamptz) to service_role;

-- Preserve legacy metric meanings while eliminating multiplicative joined rows.
create or replace view public.dancer_monthly_impact as select d.id as dancer_id,
  (select count(*) from public.profile_views x where x.dancer_id=d.id and x.viewed_at>=now()-interval '30 days') as profile_views_30d,
  (select count(*) from public.schedule_views x where x.dancer_id=d.id and x.viewed_at>=now()-interval '30 days') as schedule_views_30d,
  (select count(*) from public.direction_requests x where x.dancer_id=d.id and x.requested_at>=now()-interval '30 days') as direction_requests_30d,
  (select count(*) from public.social_clicks x where x.dancer_id=d.id and x.clicked_at>=now()-interval '30 days') as social_clicks_30d,
  (select count(distinct x.shift_id) from public.going_signals x join public.shifts s on s.id=x.shift_id where s.dancer_id=d.id and x.created_at>=now()-interval '30 days') as going_signals_30d,
  (select count(distinct x.customer_id) from public.follows x where x.dancer_id=d.id and x.created_at>=now()-interval '30 days') as followers_gained_30d
from public.dancer_profiles d;
revoke all on public.dancer_monthly_impact from public,anon,authenticated;
grant select on public.dancer_monthly_impact to service_role;

notify pgrst,'reload schema';
commit;
