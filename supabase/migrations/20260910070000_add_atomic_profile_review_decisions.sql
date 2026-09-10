-- Add before caller integration. Retain the existing publication transition and history.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create function public.review_dancer_profile_safely(
 p_reviewer_id uuid,p_dancer_id uuid,p_status text,p_notes text,p_expected jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
set lock_timeout='3s'
set timezone='UTC'
as $function$
declare
 v_profile public.dancer_profiles%rowtype;
 v_before public.dancer_profiles%rowtype;
 v_account public.app_users%rowtype;
 v_review public.approval_reviews%rowtype;
 v_owner_id uuid;
 v_audit_id uuid;
 v_receipt jsonb;
 v_current jsonb;
 v_expected jsonb := p_expected;
 v_field text;
 v_notes text := nullif(btrim(p_notes),'');
 v_now timestamptz;
 v_keys text[] := array['user_id','stage_name','city','status','verification_status','photo_review_status',
   'avatar_storage_path','is_public','approved_at','disabled_at','admin_disabled_at','venue_approved_at',
   'venue_approved_by_user_id','venue_approved_venue_id','updated_at'];
begin
 if p_reviewer_id is null or p_dancer_id is null or p_status is null
   or p_status not in('approved','rejected') or length(coalesce(v_notes,''))>12000
   or jsonb_typeof(p_expected) is distinct from 'object' then
   raise exception 'PROFILE_DECISION_INVALID_INPUT' using errcode='22023';
 end if;
 perform a.id from public.app_users a where a.id=p_reviewer_id and a.role='admin'
   and a.account_state='active' for share;
 if not found then raise exception 'PROFILE_DECISION_FORBIDDEN' using errcode='42501'; end if;
 select user_id into v_owner_id from public.dancer_profiles where id=p_dancer_id;
 if not found then raise exception 'PROFILE_DECISION_MISSING' using errcode='P0002'; end if;
 -- The nested publication transition and account lifecycle lock the account before the profile.
 select * into v_account from public.app_users where id=v_owner_id for update;
 if not found or v_account.role<>'dancer' then raise exception 'PROFILE_DECISION_ACCOUNT_MISSING' using errcode='P0002'; end if;
 select * into v_profile from public.dancer_profiles where id=p_dancer_id for update;
 if not found or v_profile.user_id<>v_owner_id then raise exception 'PROFILE_DECISION_CHANGED' using errcode='40001'; end if;
 v_before := v_profile;
 select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_profile)) where key=any(v_keys);
 foreach v_field in array array['approved_at','disabled_at','admin_disabled_at','venue_approved_at','updated_at'] loop
   if not(v_expected ? v_field) or jsonb_typeof(v_expected->v_field) not in('string','null')
     or length(v_expected->>v_field)>64 then
     raise exception 'PROFILE_DECISION_INVALID_VERSION' using errcode='22023';
   end if;
   if v_expected->v_field<>'null'::jsonb then
     if not isfinite((v_expected->>v_field)::timestamptz) then
       raise exception 'PROFILE_DECISION_INVALID_VERSION' using errcode='22023';
     end if;
     v_expected := jsonb_set(v_expected,array[v_field],to_jsonb((v_expected->>v_field)::timestamptz));
   end if;
 end loop;
 if v_current is distinct from v_expected then raise exception 'PROFILE_DECISION_CHANGED' using errcode='40001'; end if;
 perform r.id from public.approval_reviews r where r.dancer_id=p_dancer_id and r.review_type='profile' order by r.id for update;
 v_receipt := public.transition_dancer_publication_safely(p_dancer_id,
   case p_status when 'approved' then 'admin_accept' else 'admin_reject' end,p_reviewer_id);
 select * into v_profile from public.dancer_profiles where id=p_dancer_id;
 if not found or v_receipt->>'id' is distinct from p_dancer_id::text
   or v_receipt->>'user_id' is distinct from v_owner_id::text
   or v_profile.updated_at is not distinct from v_before.updated_at
   or v_profile.status::text is distinct from (case p_status when 'approved' then 'pending_review' else 'rejected' end)
   or v_profile.verification_status::text is distinct from (case p_status when 'approved' then 'pending' else 'rejected' end)
   or v_profile.approved_at is not null or v_profile.is_public is distinct from false
   or (to_jsonb(v_profile)-array['status','verification_status','approved_at','is_public','updated_at'])
      is distinct from (to_jsonb(v_before)-array['status','verification_status','approved_at','is_public','updated_at']) then
   raise exception 'PROFILE_TRANSITION_NOT_CONFIRMED' using errcode='40001';
 end if;
 v_now := clock_timestamp();
 insert into public.approval_reviews(dancer_id,reviewer_id,review_type,status,notes,reviewed_at,created_at)
   values(p_dancer_id,p_reviewer_id,'profile',p_status::public.review_status,v_notes,v_now,v_now) returning * into v_review;
 if v_review.id is null then raise exception 'PROFILE_REVIEW_NOT_CONFIRMED' using errcode='40001'; end if;
 insert into public.admin_actions(admin_id,target_type,target_id,action,notes,created_at)
   values(p_reviewer_id,'dancer_profile',p_dancer_id,
     case p_status when 'approved' then 'approve_dancer' else 'reject_dancer' end,v_notes,v_now) returning id into v_audit_id;
 if v_audit_id is null then raise exception 'PROFILE_AUDIT_NOT_CONFIRMED' using errcode='40001'; end if;
 select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_profile)) where key=any(v_keys);
 return jsonb_build_object('dancer_id',p_dancer_id,'recipient_id',v_owner_id,'stage_name',v_profile.stage_name,
   'decision',v_review.status,'status',v_profile.status,'review_id',v_review.id,'audit_id',v_audit_id,
   'reviewed_at',v_now,'version',v_current);
end;
$function$;
revoke all on function public.review_dancer_profile_safely(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.review_dancer_profile_safely(uuid,uuid,text,text,jsonb) to service_role;
comment on function public.review_dancer_profile_safely(uuid,uuid,text,text,jsonb) is
 'Service-only active administrator profile review, loaded snapshot check and atomic existing publication transition, review history and audit. Notifications remain separate.';
commit;
