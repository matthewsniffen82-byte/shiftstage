begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- The email receipt is also the durable deduplication record, even after the
-- dancer clears Notifications. A changed blocker gets its own 15-minute wait.
create unique index dancer_visibility_alert_once
 on public.dancer_media_email_deliveries((payload->>'shiftId'),(payload->>'signature'))
 where payload->>'kind'='dancer_visibility_blocked';

create function private.dancer_visibility_blocker(p_shift uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare current_shift record; eligibility record; media jsonb; reasons jsonb:='[]';
 main_state text; kind text; approved_count integer; pending_count integer; needed integer;
 reason_code text; reason_text text; media_type text:='photos';
begin
 select s.*,d.user_id,v.name venue_name into current_shift
 from public.shifts s join public.dancer_profiles d on d.id=s.dancer_id
 join public.app_users a on a.id=d.user_id and a.role='dancer' and a.account_state='active'
 join public.venues v on v.id=s.venue_id and v.is_active
 join public.dancer_shift_channels c on c.shift_id=s.id and c.dancer_id=s.dancer_id and c.venue_id=s.venue_id
 where s.id=p_shift and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
  and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
  and c.visibility in ('both','external') and d.is_public and not coalesce(d.is_incognito,false)
  and d.disabled_at is null and d.status='approved' and d.verification_status='approved';
 if not found then return null;end if;
 select * into eligibility from private.club_media_eligibility(current_shift.venue_id,array[current_shift.dancer_id]);
 if not found or eligibility.eligible then return null;end if;
 select coalesce(jsonb_agg(x),'[]') into media
 from jsonb_array_elements(public.dancer_club_media_statuses(current_shift.user_id)) x
 where x->>'venueId'=current_shift.venue_id::text and not coalesce((x->>'hidden')::boolean,false);

 if not eligibility.has_approved_main then
  -- Submitted replacements are already being handled; never ask to submit again.
  select x->>'submissionState' into main_state from jsonb_array_elements(media) x
   where x->>'kind'='photo' and coalesce((x->>'isMain')::boolean,false)
   order by case x->>'submissionState' when 'pending' then 0 when 'draft' then 1 else 2 end limit 1;
  if main_state is distinct from 'pending' then
   reason_code:=case main_state when 'draft' then 'main_draft' when 'needs_changes' then 'main_rejected' else 'main_missing' end;
   reason_text:=case main_state when 'draft' then 'Submit your main photo for approval.'
    when 'needs_changes' then 'Replace your main photo and submit it for approval.' else 'Add or choose a main photo and submit it for approval.' end;
   reasons:=reasons||jsonb_build_array(jsonb_build_object('code',reason_code,'text',reason_text));
  end if;
 end if;
 foreach kind in array array['photo','video'] loop
  approved_count:=case when kind='photo' then eligibility.approved_photos else eligibility.approved_videos end;
  needed:=case when kind='photo' then 3 else 1 end;
  select count(distinct coalesce(x->>'photoId',x->>'id')) into pending_count
   from jsonb_array_elements(media) x where x->>'kind'=kind and x->>'submissionState'='pending';
  if approved_count+pending_count>=needed then continue;end if;
  -- The main-photo action also takes the dancer to the photo requirements.
  if kind='photo' and jsonb_array_length(reasons)>0 then continue;end if;
  if exists(select 1 from jsonb_array_elements(media) x where x->>'kind'=kind and x->>'submissionState'='draft') then
   reason_code:=kind||'_draft';reason_text:='Submit your new '||kind||'s for approval.';
  elsif exists(select 1 from jsonb_array_elements(media) x where x->>'kind'=kind and x->>'submissionState'='needs_changes') then
   reason_code:=kind||'_rejected';reason_text:='Replace the '||kind||'s that need changes and submit them for approval.';
  else
   reason_code:=kind||'_missing';reason_text:='Add '||(needed-approved_count-pending_count)||' more '||kind||case when needed-approved_count-pending_count=1 then '' else 's' end||' and submit for approval.';
  end if;
  if jsonb_array_length(reasons)=0 and kind='video' then media_type:='videos';end if;
  reasons:=reasons||jsonb_build_array(jsonb_build_object('code',reason_code,'text',reason_text));
 end loop;
 if jsonb_array_length(reasons)=0 then return null;end if;
 return jsonb_build_object('kind','dancer_visibility_blocked','dancerId',current_shift.dancer_id,
  'recipientId',current_shift.user_id,'shiftId',current_shift.id,'venueId',current_shift.venue_id,
  'venueName',current_shift.venue_name,'mediaType',media_type,'reasons',reasons,
  'signature',md5((select string_agg(x->>'code',',' order by x->>'code') from jsonb_array_elements(reasons) x)));
end $$;

create function private.sync_dancer_visibility_alert(p_shift uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare alert jsonb; job uuid; notice uuid; message text;
begin
 alert:=private.dancer_visibility_blocker(p_shift);
 if alert is null then return;end if;
 message:='You’re checked in at '||(alert->>'venueName')||', but your profile isn’t visible on the public grid. '
  ||(select string_agg(x->>'text',' ' order by ord) from jsonb_array_elements(alert->'reasons') with ordinality r(x,ord));
 insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload,next_attempt_at)
 values((alert->>'recipientId')::uuid,'Your checked-in profile needs attention',message,alert,now()+interval '15 minutes')
 on conflict ((payload->>'shiftId'),(payload->>'signature')) where payload->>'kind'='dancer_visibility_blocked' do nothing
 returning id into job;
 if job is null then return;end if;
 insert into public.notifications(recipient_id,notification_type,channel,title,body,payload)
 values((alert->>'recipientId')::uuid,'approval_status','in_app','Your checked-in profile needs attention',message,alert)
 returning id into notice;
 update public.dancer_media_email_deliveries set notification_id=notice where id=job;
end $$;

create function private.capture_dancer_visibility_alert() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='shifts' then perform private.sync_dancer_visibility_alert(new.id);
 else perform private.sync_dancer_visibility_alert(new.shift_id);end if;
 return new;
end $$;
-- Wait for the tap transaction's channel selection and automatic media
-- submission to finish before deciding whether the dancer needs to act.
create constraint trigger dancer_visibility_after_shift after insert or update on public.shifts
 deferrable initially deferred for each row execute function private.capture_dancer_visibility_alert();
create constraint trigger dancer_visibility_after_channel after insert or update on public.dancer_shift_channels
 deferrable initially deferred for each row execute function private.capture_dancer_visibility_alert();

create function private.refresh_dancer_visibility_alerts() returns void
language plpgsql security invoker set search_path='' as $$
declare shift record;
begin
 for shift in select s.id from public.shifts s where s.checked_in_at is not null and s.checked_out_at is null
  and s.status='posted' and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
 loop perform private.sync_dancer_visibility_alert(shift.id);end loop;
end $$;

create or replace function public.claim_dancer_media_emails() returns table(id uuid,lease_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 perform private.refresh_dancer_visibility_alerts();
 update public.dancer_media_email_deliveries q set status='failed',outcome='retry_expired',finished_at=now(),lease_id=null,lease_until=null
 where q.status in ('pending','sending') and q.destination is not null
  and (q.lease_until is null or q.lease_until<=now()) and (q.attempts>=8 or q.created_at<now()-interval '20 hours');
 return query with due as (
  select q.id from public.dancer_media_email_deliveries q where q.status in ('pending','sending') and q.next_attempt_at<=now()
   and (q.payload->>'kind' in ('dancer_media_review_summary','dancer_media_batch_result','dancer_visibility_blocked')
    or (q.payload->>'kind'='dancer_profile_approved' and q.destination is not null))
   and (q.lease_until is null or q.lease_until<=now())
   and (q.payload->>'kind' in ('dancer_media_batch_result','dancer_visibility_blocked') or not private.dancer_media_review_pending(q.recipient_id))
  order by q.next_attempt_at,q.id for update skip locked limit 1
 ) update public.dancer_media_email_deliveries q set status='sending',attempts=q.attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where q.id=due.id returning q.id,q.lease_id;
end $$;

alter function public.dancer_media_email_target(uuid,uuid) rename to dancer_media_email_target_before_visibility;
alter function public.dancer_media_email_target_before_visibility(uuid,uuid) set schema private;
create function public.dancer_media_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.dancer_media_email_deliveries; current_alert jsonb; email text;
begin
 select * into job from public.dancer_media_email_deliveries where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found then return null;end if;
 if job.payload->>'kind' is distinct from 'dancer_visibility_blocked' then
  return private.dancer_media_email_target_before_visibility(p_id,p_lease);
 end if;
 if job.created_at>now()-interval '15 minutes' then return null;end if;
 current_alert:=private.dancer_visibility_blocker((job.payload->>'shiftId')::uuid);
 if current_alert is null or current_alert->>'signature' is distinct from job.payload->>'signature'
  or current_alert->>'recipientId' is distinct from job.recipient_id::text then return null;end if;
 email:=private.dancer_media_email_account(job.recipient_id);
 if email is null or (job.destination is not null and job.destination<>email) then return null;end if;
 -- Counts can change without changing the kind of action needed. Use the fresh
 -- instructions on the first attempt, then keep provider retries identical.
 if job.destination is null then
  job.payload:=current_alert;
  job.body:='You’re checked in at '||(current_alert->>'venueName')||', but your profile isn’t visible on the public grid. '
   ||(select string_agg(x->>'text',' ' order by ord) from jsonb_array_elements(current_alert->'reasons') with ordinality r(x,ord));
 end if;
 update public.dancer_media_email_deliveries set destination=email,body=job.body,payload=job.payload where id=p_id;
 return jsonb_build_object('email',email,'title',job.title,'body',job.body,'payload',job.payload);
end $$;

revoke all on function private.dancer_visibility_blocker(uuid),private.sync_dancer_visibility_alert(uuid),
 private.capture_dancer_visibility_alert(),private.refresh_dancer_visibility_alerts(),
 public.claim_dancer_media_emails(),private.dancer_media_email_target_before_visibility(uuid,uuid),
 public.dancer_media_email_target(uuid,uuid) from public,anon,authenticated;
grant execute on function private.dancer_visibility_blocker(uuid),private.sync_dancer_visibility_alert(uuid),
 private.capture_dancer_visibility_alert(),private.refresh_dancer_visibility_alerts(),
 public.claim_dancer_media_emails(),private.dancer_media_email_target_before_visibility(uuid,uuid),
 public.dancer_media_email_target(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
