begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Individual decisions remain durable and visible in the inbox. Only the
-- consolidated delivery is eligible for the email worker.
alter table public.dancer_media_email_deliveries
 add column summary_id uuid references public.dancer_media_email_deliveries(id);
create index dancer_media_email_summary on public.dancer_media_email_deliveries(summary_id)
 where summary_id is not null;
create index dancer_media_email_ungrouped on public.dancer_media_email_deliveries(recipient_id,created_at)
 where payload->>'kind'='dancer_media_rejected' and summary_id is null and status in ('pending','sending');

create function private.dancer_media_rejection_current(p_user uuid,p_payload jsonb) returns boolean
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_payload->>'reviewScope'='club' then
  return exists(select 1 from public.dancer_profiles d
   cross join lateral public.dancer_club_media(array[d.id]) m
   join public.club_media_permissions p on p.dancer_id=m.dancer_id and p.source=m.source and p.media_id=m.id
    and p.content_version=m.content_version and p.decision='rejected'
   where d.user_id=p_user and m.user_id=p_user and m.id::text=p_payload->>'targetId'
    and m.source=p_payload->>'source' and m.content_version=p_payload->>'contentVersion'
    and p.venue_id::text=p_payload->>'venueId');
 elsif p_payload->>'targetType'='video' then
  return exists(select 1 from public.mydancr_tv_videos where id::text=p_payload->>'targetId'
    and submitted_by=p_user and status='rejected');
 else
  return exists(select 1 from public.image_moderation_records where id::text=p_payload->>'targetId'
    and user_id=p_user and decision='rejected');
 end if;
end $$;

create function private.dancer_media_review_pending(p_user uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 with club_decisions as materialized (
  select item->>'id' id,item->>'source' source,
    bool_and(coalesce(item->>'status','pending')='rejected') all_rejected
  from jsonb_array_elements(public.dancer_club_media_statuses(p_user)) item
  group by item->>'id',item->>'source'
 )
 select exists(
  select 1 from public.image_moderation_records r where r.user_id=p_user and r.upload_context like 'profile_%'
   and r.decision='review'
   -- An upload rejected by every connected club is finished unless already
   -- forwarded to MyDancr. Processing and unreviewed uploads still block.
   and not (r.club_reviewed_at is null and exists(select 1 from club_decisions c
     where c.id=r.id::text and c.source='upload' and c.all_rejected))
 ) or exists(
  select 1 from public.mydancr_tv_videos v where v.submitted_by=p_user
   and v.status in ('uploading','moderating','submitted')
   and not (v.club_reviewed_at is null and exists(select 1 from club_decisions c
     where c.id=v.id::text and c.source='video' and c.all_rejected))
 );
$$;

create function private.prepare_dancer_media_summary() returns void
language plpgsql security invoker set search_path='' as $$
declare dancer record; members uuid[]; items jsonb; summary uuid; photos integer; videos integer;
 main_photo boolean; club_rejection boolean; message text;
begin
 -- Serialize with moderation/publication and competing workers. Limit work
 -- per claim; an unfinished review must not block other dancers' summaries.
 for dancer in select d.id,d.user_id from public.dancer_profiles d
  where exists(select 1 from public.dancer_media_email_deliveries q where q.recipient_id=d.user_id
   and q.payload->>'kind'='dancer_media_rejected' and q.summary_id is null and q.status in ('pending','sending'))
  and not exists(select 1 from public.dancer_media_email_deliveries q where q.recipient_id=d.user_id
   and q.payload->>'kind'='dancer_media_review_summary' and q.status in ('pending','sending'))
  and not private.dancer_media_review_pending(d.user_id)
  -- Allow the last decision/upload to settle before forming the summary.
  and not exists(select 1 from public.image_moderation_records r where r.user_id=d.user_id
   and r.upload_context like 'profile_%' and r.updated_at>now()-interval '1 minute')
  and not exists(select 1 from public.mydancr_tv_videos v where v.submitted_by=d.user_id
   and v.updated_at>now()-interval '1 minute')
  and not exists(select 1 from public.dancer_media_email_deliveries q where q.recipient_id=d.user_id
   and q.payload->>'kind'='dancer_media_rejected' and q.summary_id is null
   and (q.created_at>now()-interval '1 minute' or q.lease_until>now()))
  order by d.id for update of d skip locked limit 10
 loop
  update public.dancer_media_email_deliveries q set status='skipped',outcome='review_changed',finished_at=now(),
    lease_id=null,lease_until=null
  where q.recipient_id=dancer.user_id and q.payload->>'kind'='dancer_media_rejected' and q.summary_id is null
   and q.status in ('pending','sending') and not private.dancer_media_rejection_current(q.recipient_id,q.payload);
  select array_agg(q.id order by q.created_at,q.id),jsonb_agg(q.payload order by q.created_at,q.id)
   into members,items from public.dancer_media_email_deliveries q
   where q.recipient_id=dancer.user_id and q.payload->>'kind'='dancer_media_rejected'
    and q.summary_id is null and q.status in ('pending','sending');
  if members is null then continue; end if;
  select count(distinct item->>'targetId') filter(where item->>'targetType'='photo'),
    count(distinct item->>'targetId') filter(where item->>'targetType'='video'),
    coalesce(bool_or(item->>'isMain'='true' or item->>'isAvatar'='true'),false),
    coalesce(bool_or(item->>'reviewScope'='club'),false)
   into photos,videos,main_photo,club_rejection from jsonb_array_elements(items) item;
  message:='Your media review is complete. '||concat_ws(' and ',
   case when photos>0 then photos||case when photos=1 then ' photo' else ' photos' end end,
   case when videos>0 then videos||case when videos=1 then ' video' else ' videos' end end)
   ||case when photos+videos=1 then ' was not approved.' else ' were not approved.' end;
  if main_photo then message:=message||E'\n\nYour main photo needs replacing; your avatar updates automatically.'; end if;
  if club_rejection then message:=message||E'\n\nClub-specific decisions apply only to the club shown in your dashboard.'; end if;
  message:=message||E'\n\nOpen your dashboard to see all results and upload replacements.';
  insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload)
   values(dancer.user_id,'Your media review results',message,jsonb_build_object(
    'kind','dancer_media_review_summary','dancerId',dancer.id,'items',items,
    'photoCount',photos,'videoCount',videos,'emailPath','/dashboard/dancer#dancer-photos-title'))
   returning id into summary;
  update public.dancer_media_email_deliveries set summary_id=summary,status='skipped',outcome='included_in_summary',
   finished_at=now(),lease_id=null,lease_until=null where id=any(members);
 end loop;
end $$;

create or replace function public.claim_dancer_media_emails() returns table(id uuid,lease_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 -- Waiting for moderation is not a failed send and has no 20-hour deadline.
 update public.dancer_media_email_deliveries q set status='failed',outcome='retry_expired',finished_at=now(),lease_id=null,lease_until=null
 where q.payload->>'kind'<>'dancer_media_rejected' and q.status in ('pending','sending')
 and (q.lease_until is null or q.lease_until<=now())
 and (q.attempts>=8 or q.created_at<now()-interval '20 hours');
 perform private.prepare_dancer_media_summary();
 return query with due as (
  select q.id from public.dancer_media_email_deliveries q where q.status in ('pending','sending') and q.next_attempt_at<=now()
   and q.payload->>'kind' in ('dancer_profile_approved','dancer_media_review_summary')
   and (q.lease_until is null or q.lease_until<=now())
   and (q.payload->>'kind'='dancer_profile_approved' or not private.dancer_media_review_pending(q.recipient_id))
  order by q.next_attempt_at,q.id for update skip locked limit 1
 ) update public.dancer_media_email_deliveries q set status='sending',attempts=q.attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where q.id=due.id returning q.id,q.lease_id;
end $$;

create or replace function public.dancer_media_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.dancer_media_email_deliveries; email text;
begin
 select * into job from public.dancer_media_email_deliveries where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found then return null; end if;
 email:=private.dancer_media_email_account(job.recipient_id);
 if email is null or (job.destination is not null and job.destination<>email) then return null; end if;
 if job.payload->>'kind'='dancer_profile_approved' then
  if not exists(select 1 from public.dancer_profiles d where d.id::text=job.payload->>'dancerId'
   and d.user_id=job.recipient_id and d.status='approved' and d.verification_status='approved'
   and d.venue_approved_at is not null and d.disabled_at is null) then return null; end if;
 elsif job.payload->>'kind'='dancer_media_review_summary' then
  if private.dancer_media_review_pending(job.recipient_id)
    or exists(select 1 from jsonb_array_elements(job.payload->'items') item
      where not private.dancer_media_rejection_current(job.recipient_id,item))
    or (job.destination is null and exists(select 1 from public.dancer_media_email_deliveries q
      where q.recipient_id=job.recipient_id and q.payload->>'kind'='dancer_media_rejected'
        and q.summary_id is null and q.status='pending')) then
   -- No provider attempt yet: reopen the group so new decisions join the same
   -- email. After an attempt, never mutate a provider idempotency payload.
   if job.destination is null then
    update public.dancer_media_email_deliveries set summary_id=null,status='pending',outcome=null,finished_at=null
     where summary_id=job.id;
   end if;
   return null;
  end if;
 else
  -- Also blocks a raw per-item job leased by a worker before deployment.
  return null;
 end if;
 update public.dancer_media_email_deliveries set destination=email where id=p_id;
 return jsonb_build_object('email',email,'title',job.title,'body',job.body,'payload',job.payload);
end $$;

revoke all on function private.dancer_media_rejection_current(uuid,jsonb),private.dancer_media_review_pending(uuid),
 private.prepare_dancer_media_summary() from public,anon,authenticated;
grant execute on function private.dancer_media_rejection_current(uuid,jsonb),private.dancer_media_review_pending(uuid),
 private.prepare_dancer_media_summary() to service_role;

notify pgrst,'reload schema';
commit;
