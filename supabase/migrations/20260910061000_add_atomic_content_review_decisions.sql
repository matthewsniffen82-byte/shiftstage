-- Add before switching administrator callers. Preserve completed decisions and audit history.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create function public.review_dancer_content_safely(
 p_reviewer_id uuid,p_dancer_id uuid,p_target_type text,p_target_id uuid,p_status text,
 p_notes text,p_label text,p_expected jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
set lock_timeout='3s'
set timezone='UTC'
as $function$
declare
 v_profile public.dancer_profiles%rowtype;
 v_photo public.dancer_photos%rowtype;
 v_social public.social_links%rowtype;
 v_review public.approval_reviews%rowtype;
 v_target jsonb;
 v_expected_target jsonb;
 v_expected_review jsonb;
 v_current_review jsonb;
 v_review_type text;
 v_notes text := nullif(btrim(p_notes),'');
 v_label text := nullif(btrim(p_label),'');
 v_now timestamptz;
 v_summary public.review_status;
 v_confirmed uuid;
 v_audit_id uuid;
begin
 if p_reviewer_id is null or p_dancer_id is null or p_target_id is null
   or p_target_type is null or p_target_type not in('photo','social_link')
   or p_status is null or p_status not in('approved','rejected')
   or length(coalesce(v_notes,''))>12000 or length(coalesce(v_label,''))>1000
   or (p_status='rejected' and v_notes is null)
   or jsonb_typeof(p_expected) is distinct from 'object'
   or jsonb_typeof(p_expected->'target') is distinct from 'object'
   or not(p_expected ? 'review')
   or jsonb_typeof(p_expected->'review') not in('object','null') then
   raise exception 'CONTENT_DECISION_INVALID_INPUT' using errcode='22023';
 end if;
 -- Revalidate administrator authority inside the transaction, before profile/target locks.
 perform a.id from public.app_users a where a.id=p_reviewer_id and a.role='admin'
   and a.account_state='active' for share;
 if not found then raise exception 'CONTENT_DECISION_FORBIDDEN' using errcode='42501'; end if;
 select * into v_profile from public.dancer_profiles where id=p_dancer_id for update;
 if not found then raise exception 'CONTENT_DECISION_PROFILE_MISSING' using errcode='P0002'; end if;
 v_review_type := p_target_type || ':' || p_target_id::text;
 v_expected_target := p_expected->'target';
 v_expected_review := p_expected->'review';

 if p_target_type='photo' then
   perform p.id from public.dancer_photos p where p.dancer_id=p_dancer_id order by p.id for update;
   select * into v_photo from public.dancer_photos where id=p_target_id and dancer_id=p_dancer_id;
   if not found then raise exception 'CONTENT_DECISION_TARGET_MISSING' using errcode='P0002'; end if;
   v_target := jsonb_build_object('storage_path',v_photo.storage_path,'is_primary',v_photo.is_primary,
     'sort_order',v_photo.sort_order,'review_status',v_photo.review_status);
 else
   select * into v_social from public.social_links where id=p_target_id and dancer_id=p_dancer_id for update;
   if not found then raise exception 'CONTENT_DECISION_TARGET_MISSING' using errcode='P0002'; end if;
   if not v_social.is_active then raise exception 'CONTENT_DECISION_TARGET_CHANGED' using errcode='40001'; end if;
   if jsonb_typeof(v_expected_target->'updated_at') is distinct from 'string'
     or length(v_expected_target->>'updated_at')>64 then
     raise exception 'CONTENT_DECISION_INVALID_VERSION' using errcode='22023';
   end if;
   -- Compare timestamp values, not the API's timezone/precision formatting.
   v_expected_target := jsonb_set(v_expected_target,'{updated_at}',to_jsonb((v_expected_target->>'updated_at')::timestamptz));
   v_target := jsonb_build_object('platform',v_social.platform,'handle',v_social.handle,
     'url',v_social.url,'is_active',v_social.is_active,'updated_at',v_social.updated_at);
 end if;
 if v_target is distinct from v_expected_target then
   raise exception 'CONTENT_DECISION_TARGET_CHANGED' using errcode='40001';
 end if;
 perform r.id from public.approval_reviews r where r.dancer_id=p_dancer_id and r.review_type=v_review_type order by r.id for update;
 -- A pending request takes precedence over completed history, even with an old/skewed timestamp.
 select * into v_review from public.approval_reviews r where r.dancer_id=p_dancer_id and r.review_type=v_review_type
   order by (r.status='pending') desc,coalesce(r.reviewed_at,r.created_at) desc,r.id desc limit 1;
 v_current_review := case when v_review.id is null then 'null'::jsonb else
   jsonb_build_object('id',v_review.id,'status',v_review.status,'reviewed_at',v_review.reviewed_at) end;
 if jsonb_typeof(v_expected_review)='object' and v_expected_review->'reviewed_at'<>'null'::jsonb then
   if jsonb_typeof(v_expected_review->'reviewed_at') is distinct from 'string'
     or length(v_expected_review->>'reviewed_at')>64 then
     raise exception 'CONTENT_DECISION_INVALID_VERSION' using errcode='22023';
   end if;
   v_expected_review := jsonb_set(v_expected_review,'{reviewed_at}',to_jsonb((v_expected_review->>'reviewed_at')::timestamptz));
 end if;
 if v_current_review is distinct from v_expected_review then
   raise exception 'CONTENT_DECISION_REVIEW_CHANGED' using errcode='40001';
 end if;

 v_now := clock_timestamp();
 if p_target_type='photo' then
   update public.dancer_photos set review_status=p_status::public.review_status
     where id=p_target_id and dancer_id=p_dancer_id returning id into v_confirmed;
   if v_confirmed is null then raise exception 'CONTENT_DECISION_NOT_CONFIRMED' using errcode='40001'; end if;
   select case when count(*)=0 then 'pending' when bool_or(review_status='rejected') then 'rejected'
     when bool_and(review_status='approved') then 'approved' else 'pending' end::public.review_status into v_summary
     from public.dancer_photos where dancer_id=p_dancer_id;
   update public.dancer_profiles set photo_review_status=v_summary where id=p_dancer_id returning id into v_confirmed;
   if v_confirmed is null then raise exception 'CONTENT_SUMMARY_NOT_CONFIRMED' using errcode='40001'; end if;
   v_target := jsonb_set(v_target,'{review_status}',to_jsonb(p_status));
 end if;

 if v_review.id is not null and v_review.status='pending' then
   update public.approval_reviews set reviewer_id=p_reviewer_id,status=p_status::public.review_status,
     notes=v_notes,reviewed_at=v_now where id=v_review.id and status='pending' returning * into v_review;
 else
   -- A new deliberate decision appends history; it never rewrites a completed decision.
   insert into public.approval_reviews(dancer_id,review_type,reviewer_id,status,notes,reviewed_at,created_at)
     values(p_dancer_id,v_review_type,p_reviewer_id,p_status::public.review_status,v_notes,v_now,v_now) returning * into v_review;
 end if;
 if v_review.id is null then raise exception 'CONTENT_REVIEW_NOT_CONFIRMED' using errcode='40001'; end if;
 insert into public.admin_actions(admin_id,target_type,target_id,action,notes,created_at)
   values(p_reviewer_id,p_target_type,p_dancer_id,
     case p_status when 'approved' then 'approve_submitted_content' else 'reject_submitted_content' end,
     coalesce(v_label,p_target_id::text) || case when v_notes is null then '' else ': ' || v_notes end,v_now)
   returning id into v_audit_id;
 if v_audit_id is null then raise exception 'CONTENT_AUDIT_NOT_CONFIRMED' using errcode='40001'; end if;

 return jsonb_build_object('dancer_id',p_dancer_id,'target_type',p_target_type,'target_id',p_target_id,
   'review_id',v_review.id,'status',v_review.status,'reviewed_at',v_review.reviewed_at,'audit_id',v_audit_id,
   'recipient_id',v_profile.user_id,'profile_status',v_profile.status,
   'version',jsonb_build_object('target',v_target,'review',jsonb_build_object('id',v_review.id,'status',v_review.status,'reviewed_at',v_review.reviewed_at)));
end;
$function$;
revoke all on function public.review_dancer_content_safely(uuid,uuid,text,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.review_dancer_content_safely(uuid,uuid,text,uuid,text,text,text,jsonb) to service_role;
comment on function public.review_dancer_content_safely(uuid,uuid,text,uuid,text,text,text,jsonb) is
 'Service-only active administrator decision with expected target/review snapshot, atomic photo summary and audit. Preserves completed history, rejects stale/repeated snapshots and leaves notifications to the caller.';
commit;
