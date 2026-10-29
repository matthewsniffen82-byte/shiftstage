begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- One source of truth for the dashboard and final email. Approval is an actual
-- account/profile state, not inferred from the number of uploaded files.
create function private.dancer_media_review_outcome(p_user uuid,p_items jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d public.dancer_profiles; photos integer; videos integer; has_main boolean; approved boolean;
 rejected_photos integer; rejected_videos integer; rejected_main boolean; club_only boolean;
 outcome text; title text; message text; action text; path text; missing text;
begin
 select * into d from public.dancer_profiles where user_id=p_user;
 if not found then return null; end if;
 select count(*),coalesce(bool_or(is_primary),false) into photos,has_main
  from public.dancer_photos where dancer_id=d.id and review_status='approved';
 select count(*) into videos from public.mydancr_tv_videos
  where dancer_id=d.id and status='approved' and distribution_scope='profile_and_feed';
 approved:=d.status='approved' and d.verification_status='approved' and d.venue_approved_at is not null
  and d.disabled_at is null;
 select count(distinct item->>'targetId') filter(where item->>'targetType'='photo'),
  count(distinct item->>'targetId') filter(where item->>'targetType'='video'),
  coalesce(bool_or(item->>'isMain'='true' or item->>'isAvatar'='true'),false),
  coalesce(bool_or(item->>'reviewScope'='club'),false)
 into rejected_photos,rejected_videos,rejected_main,club_only from jsonb_array_elements(p_items) item;
 if not has_main then
  outcome:='needs_main';title:='Choose a main photo to finish setup';
  message:=case when photos>=3 and videos>=1 then 'Your photos and video meet the minimum requirements. ' else '' end
   ||case when photos>0 then 'Choose an approved photo as your main photo, or upload a replacement.'
     else 'Upload a replacement main photo to continue setup.' end;
  action:=case when photos>0 then 'Choose main photo' else 'Upload main photo' end;path:='/dashboard/dancer#dancer-main-photo';
 elsif approved then
  outcome:='approved';title:='Your profile is approved';
  message:=case when rejected_photos+rejected_videos>0
   then 'Some uploads were not approved. Your approved media remains available, and replacements are optional.'
   else 'Your profile is approved. Open your dashboard to view your profile and check-in status.' end;
  if rejected_main then message:=message||' Your previous approved main photo is still in use.';end if;
  action:='View results';path:='/dashboard/dancer#dancer-photos-title';
 elsif photos<3 or videos<1 then
  outcome:='needs_media';title:='Replace media to finish setup';
  missing:=concat_ws(' and ',case when photos<3 then (3-photos)||case when 3-photos=1 then ' more approved photo' else ' more approved photos' end end,
   case when videos<1 then '1 approved video' end);
  message:='You still need '||missing||'. Your approved media stays saved. Upload replacements for the missing items.';
  action:='Replace media';path:=case when photos<3 then '/dashboard/dancer#dancer-photos-title' else '/dashboard/dancer#dancer-videos-title' end;
 else
  outcome:='media_ready';title:='Your media meets the requirements';
  message:='Your main photo, 3 photos and 1 video are approved. Open your dashboard to finish any remaining setup or check-in steps.';
  if rejected_photos+rejected_videos>0 then message:=message||' Replacing the other rejected uploads is optional.';end if;
  action:='Continue setup';path:='/dashboard/dancer';
 end if;
 if rejected_photos+rejected_videos>0 then
  message:=message||E'\n\nNot approved: '||concat_ws(' and ',
   case when rejected_photos>0 then rejected_photos||case when rejected_photos=1 then ' photo' else ' photos' end end,
   case when rejected_videos>0 then rejected_videos||case when rejected_videos=1 then ' video' else ' videos' end end)||'.';
 end if;
 if club_only then message:=message||' Club-specific decisions apply only to the club shown in your dashboard.';end if;
 return jsonb_build_object('outcome',outcome,'title',title,'body',message,'action',action,'emailPath',path,
  'approvedPhotos',photos,'approvedVideos',videos,'hasApprovedMain',has_main,
  'photoCount',rejected_photos,'videoCount',rejected_videos);
end $$;

create function public.get_dancer_media_review_outcome(p_user uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare items jsonb;
begin
 if private.dancer_media_review_pending(p_user) then return null;end if;
 select coalesce(jsonb_agg(q.payload),'[]'::jsonb) into items from public.dancer_media_email_deliveries q
  where q.recipient_id=p_user and q.payload->>'kind'='dancer_media_rejected'
   and private.dancer_media_rejection_current(p_user,q.payload);
 if jsonb_array_length(items)=0 and not exists(select 1 from public.dancer_media_email_deliveries
   where recipient_id=p_user and payload->>'kind' in ('dancer_profile_approved','dancer_media_review_summary')) then return null;end if;
 return private.dancer_media_review_outcome(p_user,items);
end $$;

create or replace function private.prepare_dancer_media_summary() returns void
language plpgsql security invoker set search_path='' as $$
declare dancer record; members uuid[]; items jsonb; summary uuid; result jsonb;
begin
 for dancer in select d.id,d.user_id from public.dancer_profiles d
  where d.disabled_at is null and exists(select 1 from public.dancer_media_email_deliveries q where q.recipient_id=d.user_id
   and q.payload->>'kind' in ('dancer_media_rejected','dancer_profile_approved')
   and q.summary_id is null and q.status in ('pending','sending') and q.destination is null)
  and not exists(select 1 from public.dancer_media_email_deliveries q where q.recipient_id=d.user_id
   and q.payload->>'kind'='dancer_media_review_summary' and q.status in ('pending','sending'))
  and not private.dancer_media_review_pending(d.user_id)
  and not exists(select 1 from public.image_moderation_records r where r.user_id=d.user_id
   and r.upload_context like 'profile_%' and r.updated_at>now()-interval '1 minute')
  and not exists(select 1 from public.mydancr_tv_videos v where v.submitted_by=d.user_id and v.updated_at>now()-interval '1 minute')
  and not exists(select 1 from public.dancer_media_email_deliveries q where q.recipient_id=d.user_id
   and q.payload->>'kind' in ('dancer_media_rejected','dancer_profile_approved') and q.summary_id is null
   and q.status in ('pending','sending') and (q.created_at>now()-interval '1 minute' or q.lease_until>now()))
  order by d.id for update of d skip locked limit 10
 loop
  update public.dancer_media_email_deliveries q set status='skipped',outcome='review_changed',finished_at=now(),lease_id=null,lease_until=null
  where q.recipient_id=dancer.user_id and q.payload->>'kind'='dancer_media_rejected' and q.summary_id is null
   and q.status in ('pending','sending') and not private.dancer_media_rejection_current(q.recipient_id,q.payload);
  select array_agg(q.id order by q.created_at,q.id),
   coalesce(jsonb_agg(q.payload order by q.created_at,q.id) filter(where q.payload->>'kind'='dancer_media_rejected'),'[]'::jsonb)
   into members,items from public.dancer_media_email_deliveries q
   where q.recipient_id=dancer.user_id and q.payload->>'kind' in ('dancer_media_rejected','dancer_profile_approved')
    and q.summary_id is null and q.status in ('pending','sending') and q.destination is null;
  if members is null then continue;end if;
  result:=private.dancer_media_review_outcome(dancer.user_id,items);
  insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload)
   values(dancer.user_id,result->>'title',result->>'body',result||jsonb_build_object(
    'kind','dancer_media_review_summary','dancerId',dancer.id,'items',items)) returning id into summary;
  update public.dancer_media_email_deliveries set summary_id=summary,status='skipped',outcome='included_in_summary',
   finished_at=now(),lease_id=null,lease_until=null where id=any(members);
 end loop;
end $$;

create or replace function public.claim_dancer_media_emails() returns table(id uuid,lease_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 -- Deadlines apply to attempted sends, never to time spent waiting for review.
 update public.dancer_media_email_deliveries q set status='failed',outcome='retry_expired',finished_at=now(),lease_id=null,lease_until=null
 where q.status in ('pending','sending') and q.destination is not null
  and (q.lease_until is null or q.lease_until<=now()) and (q.attempts>=8 or q.created_at<now()-interval '20 hours');
 perform private.prepare_dancer_media_summary();
 return query with due as (
  select q.id from public.dancer_media_email_deliveries q where q.status in ('pending','sending') and q.next_attempt_at<=now()
   and (q.payload->>'kind'='dancer_media_review_summary' or (q.payload->>'kind'='dancer_profile_approved' and q.destination is not null))
   and (q.lease_until is null or q.lease_until<=now()) and not private.dancer_media_review_pending(q.recipient_id)
  order by q.next_attempt_at,q.id for update skip locked limit 1
 ) update public.dancer_media_email_deliveries q set status='sending',attempts=q.attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where q.id=due.id returning q.id,q.lease_id;
end $$;

create or replace function public.dancer_media_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.dancer_media_email_deliveries; email text; result jsonb;
begin
 select * into job from public.dancer_media_email_deliveries where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found then return null;end if;
 email:=private.dancer_media_email_account(job.recipient_id);
 if email is null or (job.destination is not null and job.destination<>email) then return null;end if;
 if not exists(select 1 from public.dancer_profiles where user_id=job.recipient_id and disabled_at is null) then return null;end if;
 if job.payload->>'kind'='dancer_profile_approved' and job.destination is not null then
  -- Preserve provider idempotency for approval sends already attempted at rollout.
  if not exists(select 1 from public.dancer_profiles d where d.id::text=job.payload->>'dancerId'
   and d.user_id=job.recipient_id and d.status='approved' and d.verification_status='approved'
   and d.venue_approved_at is not null and d.disabled_at is null) then return null;end if;
 elsif job.payload->>'kind'='dancer_media_review_summary' then
  if private.dancer_media_review_pending(job.recipient_id)
   or exists(select 1 from jsonb_array_elements(job.payload->'items') item where not private.dancer_media_rejection_current(job.recipient_id,item))
   or (job.destination is null and exists(select 1 from public.dancer_media_email_deliveries q
    where q.recipient_id=job.recipient_id and q.payload->>'kind' in ('dancer_media_rejected','dancer_profile_approved')
     and q.summary_id is null and q.status='pending')) then
   if job.destination is null then
    update public.dancer_media_email_deliveries set summary_id=null,status='pending',outcome=null,finished_at=null where summary_id=job.id;
   end if;
   return null;
  end if;
  if job.destination is null then
   result:=private.dancer_media_review_outcome(job.recipient_id,job.payload->'items');
   job.title:=result->>'title';job.body:=result->>'body';job.payload:=job.payload||result;
  elsif job.payload->>'outcome'='approved' and private.dancer_media_review_outcome(job.recipient_id,job.payload->'items')->>'outcome'<>'approved' then
   return null;
  end if;
 else return null;
 end if;
 update public.dancer_media_email_deliveries set destination=email,title=job.title,body=job.body,payload=job.payload where id=p_id;
 return jsonb_build_object('email',email,'title',job.title,'body',job.body,'payload',job.payload);
end $$;

-- First activation must have a genuinely approved main photo. Rejected extras
-- do not block activation, and existing approved profiles retain their access.
create function private.require_initial_approved_main_photo() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and (old.venue_approved_at is not null or (old.approved_at is not null and old.verification_status='approved')) then return new;end if;
 if new.status='approved' and not exists(select 1 from public.dancer_photos where dancer_id=new.id and is_primary and review_status='approved') then
  raise exception 'Choose an approved main photo before completing setup.' using errcode='23514';
 end if;
 return new;
end $$;
create trigger dancer_onboarding_main_photo before insert or update of status,verification_status,venue_approved_at on public.dancer_profiles
 for each row execute function private.require_initial_approved_main_photo();

create function public.choose_approved_dancer_main_photo(p_user uuid,p_photo uuid,p_expected_main uuid default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare dancer uuid; selected public.dancer_photos; previous public.dancer_photos; position integer;
begin
 select d.id into dancer from public.dancer_profiles d join public.app_users u on u.id=d.user_id
  where d.user_id=p_user and u.role='dancer' and u.account_state='active' and d.disabled_at is null for update of d;
 if not found then raise exception 'Active dancer profile required.' using errcode='42501';end if;
 perform 1 from public.dancer_photos where dancer_id=dancer order by id for update;
 select * into selected from public.dancer_photos where id=p_photo and dancer_id=dancer and review_status='approved';
 if not found then raise exception 'Choose one of your approved photos.' using errcode='42501';end if;
 if selected.is_primary then return selected.id;end if;
 select * into previous from public.dancer_photos where dancer_id=dancer and is_primary and review_status in ('approved','pending');
 if previous.id is distinct from p_expected_main then raise exception 'Your main photo changed. Refresh and try again.' using errcode='40001';end if;
 if exists(select 1 from public.image_moderation_records where user_id=p_user and upload_context like 'profile_main%' and decision='review') then
  raise exception 'Remove your pending main photo before choosing another.' using errcode='40001';end if;
 position:=selected.sort_order;
 -- The zero position is outside the unique gallery-position index while swapping.
 update public.dancer_photos set is_primary=false,sort_order=0 where id=previous.id;
 update public.dancer_photos set is_primary=true,sort_order=0 where id=selected.id;
 if previous.id is not null then
  if position is null or position<=0 then
   select coalesce(max(sort_order),0)+1 into position from public.dancer_photos where dancer_id=dancer;
  end if;
  update public.dancer_photos set sort_order=position where id=previous.id;
 end if;
 -- No new bytes or approval changes: the existing avatar trigger follows the
 -- final main photo, and all club permissions remain attached to the same media.
 return selected.id;
end $$;

revoke all on function private.dancer_media_review_outcome(uuid,jsonb),public.get_dancer_media_review_outcome(uuid),
 private.require_initial_approved_main_photo(),public.choose_approved_dancer_main_photo(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.dancer_media_review_outcome(uuid,jsonb),public.get_dancer_media_review_outcome(uuid),
 private.require_initial_approved_main_photo(),public.choose_approved_dancer_main_photo(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
