begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- A durable receipt prevents repeat approval emails after edits, visibility
-- changes, retried activation, or clearing the dancer's in-app notifications.
create unique index dancer_profile_approval_email_once
on public.dancer_media_email_deliveries(recipient_id)
where payload->>'kind'='dancer_profile_approved';

create function private.queue_dancer_profile_approval_email() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status is distinct from 'approved' or new.verification_status is distinct from 'approved'
   or new.venue_approved_at is null or new.disabled_at is not null then return new; end if;
 if tg_op='UPDATE' and old.status='approved' and old.verification_status='approved'
   and old.venue_approved_at is not null and old.disabled_at is null then return new; end if;
 if not exists(select 1 from public.app_users where id=new.user_id and role='dancer' and account_state='active') then return new; end if;
 insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload)
 values(new.user_id,'Your MyDancr profile is approved',
   'Your MyDancr dancer profile is approved. Open your dashboard to view your profile and check-in status.',
   jsonb_build_object('kind','dancer_profile_approved','dancerId',new.id,'emailPath','/dashboard/dancer'))
 on conflict (recipient_id) where payload->>'kind'='dancer_profile_approved' do nothing;
 return new;
end $$;
revoke all on function private.queue_dancer_profile_approval_email() from public,anon,authenticated;
grant execute on function private.queue_dancer_profile_approval_email() to service_role;

create trigger queue_dancer_profile_approval_email
after insert or update of status,verification_status,venue_approved_at,disabled_at on public.dancer_profiles
for each row execute function private.queue_dancer_profile_approval_email();

-- Recheck the current account and approval before delivering, while preserving
-- the existing rejection checks and the same leased retry/idempotency system.
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
 elsif job.payload->>'reviewScope'='club' then
  if not exists(select 1 from public.dancer_club_media(array[(job.payload->>'dancerId')::uuid]) m
   join public.club_media_permissions p on p.dancer_id=m.dancer_id and p.source=m.source and p.media_id=m.id
    and p.content_version=m.content_version and p.decision='rejected'
   where m.user_id=job.recipient_id and m.id::text=job.payload->>'targetId'
    and m.source=job.payload->>'source' and m.content_version=job.payload->>'contentVersion'
    and p.venue_id::text=job.payload->>'venueId') then return null; end if;
 elsif job.payload->>'targetType'='video' then
  if not exists(select 1 from public.mydancr_tv_videos where id::text=job.payload->>'targetId'
    and submitted_by=job.recipient_id and status='rejected') then return null; end if;
 else
  if not exists(select 1 from public.image_moderation_records where id::text=job.payload->>'targetId'
    and user_id=job.recipient_id and decision='rejected') then return null; end if;
 end if;
 update public.dancer_media_email_deliveries set destination=email where id=p_id;
 return jsonb_build_object('email',email,'title',job.title,'body',job.body,'payload',job.payload);
end $$;

-- Recover recently completed approvals missed by the old in-app-only flow.
-- Older approvals are deliberately not replayed to the entire dancer roster.
insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload)
select d.user_id,'Your MyDancr profile is approved',
 'Your MyDancr dancer profile is approved. Open your dashboard to view your profile and check-in status.',
 jsonb_build_object('kind','dancer_profile_approved','dancerId',d.id,'emailPath','/dashboard/dancer')
from public.dancer_profiles d join public.app_users u on u.id=d.user_id
where d.status='approved' and d.verification_status='approved' and d.disabled_at is null
 and d.venue_approved_at>=now()-interval '24 hours' and u.role='dancer' and u.account_state='active'
on conflict (recipient_id) where payload->>'kind'='dancer_profile_approved' do nothing;

notify pgrst,'reload schema';
commit;
