-- A previously optional deployment setting can no longer bypass dancer verification.
update public.dancer_age_verification_settings set enabled = true where not enabled;
alter table public.dancer_age_verification_settings add constraint dancer_age_verification_always_required check (enabled);

-- Preserve existing function signatures, privileges and the deployed review checks.
create function pg_temp.update_review_function(target regprocedure, before_text text, after_text text)
returns void language plpgsql as $$
declare definition text := pg_get_functiondef(target);
begin
  if strpos(definition, before_text) = 0 then
    raise exception 'Expected review logic missing from %', target;
  end if;
  execute replace(definition, before_text, after_text);
end $$;

-- Keep a declined request's decisions for reconsideration, while closing review access.
create function private.club_declined_dancer(club_id uuid, dancer_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.club_dancer_approvals a
    where a.venue_id = $1 and a.dancer_id = $2 and a.status = 'rejected')
$$;
revoke all on function private.club_declined_dancer(uuid,uuid) from public,anon,authenticated;
grant execute on function private.club_declined_dancer(uuid,uuid) to service_role;

select pg_temp.update_review_function('private.media_batch_authorize(uuid,text,uuid,uuid)'::regprocedure,
$before$if p_role='admin' then$before$,
$after$if p_role in ('venue','admin') and private.club_declined_dancer(p_venue,p_dancer) then
  raise exception 'Club request declined. Reopen the request before reviewing media.' using errcode='42501';
 end if;
 if p_role='admin' then$after$);

select pg_temp.update_review_function('private.attach_media_batches(uuid,uuid)'::regprocedure,
$before$perform 1 from public.dancer_profiles where id=d.id for update;$before$,
$after$perform 1 from public.dancer_profiles where id=d.id for update;
   if private.club_declined_dancer(v.id,d.id) then continue; end if;$after$);

select pg_temp.update_review_function('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure,
$before$and case p_role when$before$,
$after$and not private.club_declined_dancer(b.venue_id,b.dancer_id)
    and case p_role when$after$);

select pg_temp.update_review_function('public.dancer_media_editor_context(uuid,uuid)'::regprocedure,
$before$where v.is_active and exists$before$,
$after$where v.is_active and not private.club_declined_dancer(v.id,d.id) and exists$after$);

select pg_temp.update_review_function('public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text)'::regprocedure,
$before$not in ('approved','rejected')$before$,
$after$not in ('approved','rejected','pending')$after$);

select pg_temp.update_review_function('public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text)'::regprocedure,
$before$v_request.status='approved' then$before$,
$after$v_request.status='approved'
    or (p_decision='pending') <> (v_request.status='rejected') then$after$);

select pg_temp.update_review_function('public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text)'::regprocedure,
$before$set status=p_decision,reviewed_at=clock_timestamp(),
    reviewed_by=p_actor_user_id$before$,
$after$set status=p_decision,
    requested_at=case when p_decision='pending' then clock_timestamp() else requested_at end,
    reviewed_at=case when p_decision<>'pending' then clock_timestamp() end,
    reviewed_by=case when p_decision<>'pending' then p_actor_user_id end$after$);

select pg_temp.update_review_function('public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text)'::regprocedure,
$before$where private.editor_media_available(p_dancer_id,p_venue_id,m.source,m.id)$before$,
$after$where exists (
        select 1 from public.dancer_media_batches b cross join lateral jsonb_array_elements(b.items) item
        where b.dancer_id=p_dancer_id and b.venue_id=p_venue_id and item->>'key'=m.source||':'||m.id)
      and private.editor_media_available(p_dancer_id,p_venue_id,m.source,m.id)$after$);

-- Explicit onboarding replacements go straight to the connected club that requested them.
-- An established dancer's off-shift edits still wait for check-in.
select pg_temp.update_review_function('public.submit_dancer_club_media_batch(uuid,uuid)'::regprocedure,
$before$if not exists(select 1 from public.shifts$before$,
$after$if (ctx->>'onboarding')::boolean then
  return private.submit_checked_in_media_batch(p_actor,p_venue);
 end if;
 if not exists(select 1 from public.shifts$after$);

select pg_temp.update_review_function('private.submit_checked_in_media_batch(uuid,uuid)'::regprocedure,
$before$or private.editor_media_origin(s.item->>'source',(s.item->>'id')::uuid) is null)$before$,
$after$or (not (ctx->>'onboarding')::boolean and private.editor_media_origin(s.item->>'source',(s.item->>'id')::uuid) is null))$after$);

select pg_temp.update_review_function('public.submit_dancer_media_batch(uuid)'::regprocedure,
$before$where not submitted and not published;$before$,
$after$where not submitted and not published
  and private.editor_media_origin(item->>'source',(item->>'id')::uuid) is null;$after$);

select pg_temp.update_review_function('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure,
$before$own_dancer uuid;$before$, $after$own_dancer uuid; established boolean;$after$);
select pg_temp.update_review_function('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure,
$before$select id into own_dancer from public.dancer_profiles where user_id=p_actor;$before$,
$after$select id, status='approved' or approved_at is not null into own_dancer,established
    from public.dancer_profiles where user_id=p_actor;$after$);

select pg_temp.update_review_function('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure,
$before$and (p_venue is null or private.editor_media_origin(item->>'source',(item->>'id')::uuid) is null or private.editor_media_origin(item->>'source',(item->>'id')::uuid)=p_venue)$before$,
$after$and (private.editor_media_origin(item->>'source',(item->>'id')::uuid) is not distinct from p_venue
     or (p_venue is not null and private.editor_media_origin(item->>'source',(item->>'id')::uuid) is null
         and established))$after$);

select pg_temp.update_review_function('public.get_dancer_media_review_outcome(uuid)'::regprocedure,
$before$b.state='completed' order by$before$,
$after$b.state='completed' and not private.club_declined_dancer(b.venue_id,b.dancer_id) order by$after$);

-- Draft counts match the files that each submit action can actually send.
select pg_temp.update_review_function('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure,
$before$p_venue is null or r.editor_venue_id is null or r.editor_venue_id=p_venue$before$,
$after$r.editor_venue_id is not distinct from p_venue or (p_venue is not null and r.editor_venue_id is null and established)$after$);
select pg_temp.update_review_function('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure,
$before$p_venue is null or v.editor_venue_id is null or v.editor_venue_id=p_venue$before$,
$after$v.editor_venue_id is not distinct from p_venue or (p_venue is not null and v.editor_venue_id is null and established)$after$);
select pg_temp.update_review_function('public.submit_dancer_media_batch(uuid)'::regprocedure,
$before$where user_id=p_actor and upload_context$before$,
$after$where user_id=p_actor and editor_venue_id is null and upload_context$after$);
select pg_temp.update_review_function('public.submit_dancer_media_batch(uuid)'::regprocedure,
$before$where dancer_id=d and (status='moderating' or upload_validation_pending)$before$,
$after$where dancer_id=d and editor_venue_id is null and (status in ('uploading','moderating') or upload_validation_pending)$after$);

-- Refresh the original request and its email deduplication key only on a new tap after expiry.
create function private.renew_expired_club_request() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.club_dancer_approvals a set requested_at=new.tapped_at, revision=gen_random_uuid()
    from public.dancer_profiles d where d.user_id=new.dancer_user_id and a.dancer_id=d.id
      and a.venue_id=new.venue_id and a.status='pending';
  return new;
end $$;
revoke all on function private.renew_expired_club_request() from public,anon,authenticated;
create trigger renew_expired_club_request after update of tapped_at on public.dancer_nfc_enrollments
  for each row when (new.status='pending' and new.tapped_at>old.tapped_at and old.expires_at<=new.tapped_at)
  execute function private.renew_expired_club_request();

-- The finishing batch carries the approval email. Outside that transaction the profile transition sends it.
select pg_temp.update_review_function('private.finish_resolved_club_media_batch(uuid,jsonb,uuid)'::regprocedure,
$before$club_name text;$before$,
$after$club_name text; previous_batch text := current_setting('mydancr.finishing_media_review',true);$after$);

select pg_temp.update_review_function('private.finish_resolved_club_media_batch(uuid,jsonb,uuid)'::regprocedure,
$before$perform public.finalize_pending_dancer_nfc_enrollment(d.user_id,null,'{}');$before$,
$after$perform set_config('mydancr.finishing_media_review',b.id::text,true);
  perform public.finalize_pending_dancer_nfc_enrollment(d.user_id,null,'{}');
  perform set_config('mydancr.finishing_media_review',coalesce(previous_batch,''),true);$after$);

select pg_temp.update_review_function('private.queue_dancer_profile_approval_email()'::regprocedure,
$before$'Your MyDancr profile is approved'$before$,
$after$'Your profile is approved'$after$);

select pg_temp.update_review_function('private.queue_dancer_profile_approval_email()'::regprocedure,
$before$'kind','dancer_profile_approved'$before$,
$after$'kind','dancer_profile_approved','dashboardUnlocked',true$after$);

select pg_temp.update_review_function('private.suppress_individual_media_email()'::regprocedure,
$before$elsif new.payload->>'kind' in ('dancer_media_rejected','dancer_profile_approved') then return null;$before$,
$after$elsif new.payload->>'kind'='dancer_media_rejected' or (new.payload->>'kind'='dancer_profile_approved'
  and (new.payload->>'dashboardUnlocked' is distinct from 'true'
    or nullif(current_setting('mydancr.finishing_media_review',true),'') is not null)) then return null;$after$);

select pg_temp.update_review_function('public.claim_dancer_media_emails()'::regprocedure,
$before$'dancer_profile_approved' and q.destination is not null$before$,
$after$'dancer_profile_approved' and (q.destination is not null or q.payload->>'dashboardUnlocked'='true')$after$);

select pg_temp.update_review_function('public.claim_dancer_media_emails()'::regprocedure,
$before$or not private.dancer_media_review_pending(q.recipient_id)$before$,
$after$or q.payload->>'dashboardUnlocked'='true' or not private.dancer_media_review_pending(q.recipient_id)$after$);

select pg_temp.update_review_function('private.dancer_media_email_target_before_visibility(uuid,uuid)'::regprocedure,
$before$'dancer_profile_approved' and job.destination is not null$before$,
$after$'dancer_profile_approved' and (job.destination is not null or job.payload->>'dashboardUnlocked'='true')$after$);

select pg_temp.update_review_function('private.dancer_media_email_target_before_visibility(uuid,uuid)'::regprocedure,
$before$b.state='completed' and d.user_id=job.recipient_id$before$,
$after$b.state='completed' and d.user_id=job.recipient_id
    and not private.club_declined_dancer(b.venue_id,d.id)
    and not (coalesce(job.payload->>'outcome','') in ('needs_main','needs_media') and private.club_media_ready(b.venue_id,d.id))
    and not (coalesce(job.payload->>'outcome','')='media_ready' and d.status='approved' and d.verification_status='approved')$after$);

drop function pg_temp.update_review_function(regprocedure,text,text);
notify pgrst, 'reload schema';
