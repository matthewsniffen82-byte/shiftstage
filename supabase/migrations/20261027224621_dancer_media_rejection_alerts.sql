begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Keep email receipts even if the dancer clears their inbox.
create table public.dancer_media_email_deliveries (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid unique references public.notifications(id) on delete set null,
 recipient_id uuid not null references public.app_users(id) on delete cascade,
 title text not null, body text not null, payload jsonb not null,
 destination text, status text not null default 'pending' check(status in ('pending','sending','accepted','skipped','failed')),
 attempts integer not null default 0, created_at timestamptz not null default now(),
 next_attempt_at timestamptz not null default now(), lease_id uuid, lease_until timestamptz,
 provider_id text, outcome text, finished_at timestamptz
);
create index dancer_media_email_due on public.dancer_media_email_deliveries(next_attempt_at,id) where status in ('pending','sending');
create index dancer_media_email_recipient on public.dancer_media_email_deliveries(recipient_id);
alter table public.dancer_media_email_deliveries enable row level security;
revoke all on public.dancer_media_email_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.dancer_media_email_deliveries to service_role;
create policy dancer_media_email_service on public.dancer_media_email_deliveries to service_role using(true) with check(true);

-- Scope-specific notifications commit with the decision. Unchanged decisions
-- and new revisions of the same rejected bytes do not send repeat alerts.
create function private.notify_club_media_rejection() returns trigger
language plpgsql security definer set search_path='' as $$
declare m record; club_name text;
begin
 if new.decision<>'rejected' then return new; end if;
 if tg_op='UPDATE' then
  if old.decision='rejected' and old.content_version=new.content_version then return new; end if;
 end if;
 select * into m from public.dancer_club_media(array[new.dancer_id])
 where id=new.media_id and source=new.source and content_version=new.content_version;
 if not found then return new; end if;
 select name into club_name from public.venues where id=new.venue_id;
 insert into public.notifications(recipient_id,notification_type,channel,title,body,payload)
 values(m.user_id,'approval_status','in_app','Media needs attention','',jsonb_build_object(
  'kind','dancer_media_rejected','status','rejected','targetType',m.kind,'targetId',m.id,
  'source',m.source,'contentVersion',m.content_version,'dancerId',m.dancer_id,
  'isMain',m.is_main,'venueId',new.venue_id,'venueName',club_name,'reviewScope','club'));
 return new;
end $$;
create trigger club_media_rejection_notice after insert or update on public.club_media_permissions
for each row execute function private.notify_club_media_rejection();

create function private.notify_dancer_photo_rejection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.decision<>'rejected' or new.upload_context not like 'profile_%' then return new; end if;
 if tg_op='UPDATE' then
  if old.decision='rejected' then return new; end if;
 end if;
 insert into public.notifications(recipient_id,notification_type,channel,title,body,payload)
 values(new.user_id,'approval_status','in_app','Photo needs attention','',jsonb_build_object(
  'kind','dancer_media_rejected','status','rejected','targetType','photo','targetId',new.id,
  'source','upload','isMain',new.upload_context like 'profile_main%',
  'isAvatar',new.upload_context='profile_avatar','reviewScope','platform'));
 return new;
end $$;
create trigger dancer_photo_rejection_notice after insert or update on public.image_moderation_records
for each row execute function private.notify_dancer_photo_rejection();

-- Video decisions already emit an inbox message. Normalize it here, using no
-- reviewer reason, and queue the same message rather than inserting a duplicate.
create function private.format_dancer_media_rejection() returns trigger
language plpgsql security definer set search_path='' as $$
declare reviewer text; kind text; main_photo boolean; avatar boolean;
begin
 if not exists(select 1 from public.app_users where id=new.recipient_id and role='dancer' and account_state='active') then return new; end if;
 if new.notification_type='tv_video_status' and new.payload->>'status'='rejected' then
  new.payload:=new.payload||jsonb_build_object('kind','dancer_media_rejected','targetType','video',
    'targetId',new.payload->>'videoId','source','video','reviewScope','platform');
 end if;
 if new.payload->>'kind' is distinct from 'dancer_media_rejected' then return new; end if;
 kind:=new.payload->>'targetType';
 main_photo:=coalesce((new.payload->>'isMain')::boolean,false);
 avatar:=coalesce((new.payload->>'isAvatar')::boolean,false);
 reviewer:=case when new.payload->>'reviewScope'='club' then coalesce(new.payload->>'venueName','Your club') else 'MyDancr' end;
 new.title:=case when main_photo then 'Main photo needs replacing' when avatar then 'Avatar needs attention'
   when kind='video' then 'Video not approved' else 'Photo not approved' end;
 new.body:=reviewer||' did not approve '||case when main_photo then 'your main photo.' when avatar then 'your avatar.'
   when kind='video' then 'a video.' else 'a photo.' end||' '||case
   when main_photo or avatar then 'Choose a different main photo; your avatar updates automatically.'
   when kind='video' then 'Upload a replacement if you want to include it. Videos are optional.'
   else 'Replace it if you still need 3 approved profile photos.' end;
 if new.payload->>'reviewScope'='club' then new.body:=new.body||' This decision applies only to this club.'; end if;
 new.payload:=new.payload||jsonb_build_object('setupStep',case when kind='video' then 'videos' else 'photos' end,
  'emailPath',case when main_photo or avatar then '/dashboard/dancer#dancer-main-photo'
   when kind='video' then '/dashboard/dancer#dancer-videos-title' else '/dashboard/dancer#dancer-photos-title' end);
 return new;
end $$;
create trigger format_dancer_media_rejection before insert on public.notifications
for each row execute function private.format_dancer_media_rejection();

create function private.queue_dancer_media_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.payload->>'kind'='dancer_media_rejected' and exists(select 1 from public.app_users
   where id=new.recipient_id and role='dancer' and account_state='active') then
  insert into public.dancer_media_email_deliveries(notification_id,recipient_id,title,body,payload)
  values(new.id,new.recipient_id,new.title,new.body,new.payload);
 end if;
 return new;
end $$;
create trigger queue_dancer_media_email after insert on public.notifications
for each row execute function private.queue_dancer_media_email();

create function public.claim_dancer_media_emails() returns table(id uuid,lease_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 update public.dancer_media_email_deliveries q set status='failed',outcome='retry_expired',finished_at=now(),lease_id=null,lease_until=null
 where status in ('pending','sending') and (lease_until is null or lease_until<=now())
 and (attempts>=8 or created_at<now()-interval '20 hours');
 return query with due as (
  select q.id from public.dancer_media_email_deliveries q where q.status in ('pending','sending') and q.next_attempt_at<=now()
  and (q.lease_until is null or q.lease_until<=now()) order by q.next_attempt_at,q.id for update skip locked limit 1
 ) update public.dancer_media_email_deliveries q set status='sending',attempts=q.attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where q.id=due.id returning q.id,q.lease_id;
end $$;

create function private.dancer_media_email_account(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select u.email from auth.users u join public.app_users a on a.id=u.id
 where u.id=p_user and a.role='dancer' and a.account_state='active' and u.deleted_at is null
 and u.email_confirmed_at is not null and lower(btrim(u.email))=lower(btrim(a.email));
$$;

create function public.dancer_media_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.dancer_media_email_deliveries; email text;
begin
 select * into job from public.dancer_media_email_deliveries where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found then return null; end if;
 email:=private.dancer_media_email_account(job.recipient_id);
 if email is null or (job.destination is not null and job.destination<>email) then return null; end if;
 -- Do not email a stale rejection after the media has been removed or approved.
 if job.payload->>'reviewScope'='club' then
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

create function public.finish_dancer_media_email(p_id uuid,p_lease uuid,p_status text,p_outcome text,p_provider_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_status is null or p_status not in ('accepted','retry','failed','skipped') then raise exception 'Invalid email outcome'; end if;
 update public.dancer_media_email_deliveries set status=case when p_status='retry' then 'pending' else p_status end,
 next_attempt_at=now()+least(interval '60 minutes',interval '1 minute'*power(2,attempts)),
 lease_id=null,lease_until=null,outcome=left(p_outcome,100),provider_id=left(p_provider_id,200),
 finished_at=case when p_status='retry' then null else now() end
 where id=p_id and lease_id=p_lease and status='sending';
 return found;
end $$;

revoke all on function private.notify_club_media_rejection(),private.notify_dancer_photo_rejection(),
 private.format_dancer_media_rejection(),private.queue_dancer_media_email(),private.dancer_media_email_account(uuid),
 public.claim_dancer_media_emails(),public.dancer_media_email_target(uuid,uuid),public.finish_dancer_media_email(uuid,uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function private.dancer_media_email_account(uuid),public.claim_dancer_media_emails(),
 public.dancer_media_email_target(uuid,uuid),public.finish_dancer_media_email(uuid,uuid,text,text,text) to service_role;

-- Surface existing main-photo blockers once at rollout, including saved club
-- taps that are waiting on media. Never change a review or publish a profile.
insert into public.notifications(recipient_id,notification_type,channel,title,body,payload)
select m.user_id,'approval_status','in_app','Main photo needs replacing','',jsonb_build_object(
 'kind','dancer_media_rejected','status','rejected','targetType','photo','targetId',m.id,
 'source',m.source,'contentVersion',m.content_version,'dancerId',m.dancer_id,'isMain',true,
 'venueId',p.venue_id,'venueName',v.name,'reviewScope','club')
from public.dancer_profiles d cross join lateral public.dancer_club_media(array[d.id]) m
join public.club_media_permissions p on p.dancer_id=m.dancer_id and p.source=m.source and p.media_id=m.id
 and p.content_version=m.content_version and p.decision='rejected'
join public.venues v on v.id=p.venue_id
where d.status='pending_review' and m.is_main and m.record->>'status'<>'approved'
and not exists(select 1 from public.notifications n where n.recipient_id=m.user_id
 and n.payload->>'kind'='dancer_media_rejected' and n.payload->>'targetId'=m.id::text and n.payload->>'venueId'=p.venue_id::text);

notify pgrst,'reload schema';
commit;
