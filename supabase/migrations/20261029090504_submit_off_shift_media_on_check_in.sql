begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- First visits start from the previous club's approved profile. The references
-- are frozen for this club; approval and future edits remain independent.
create table public.dancer_club_starting_profiles (
 dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete cascade,
 source_venue_id uuid not null references public.venues(id),
 items jsonb not null check(jsonb_typeof(items)='array'),
 created_at timestamptz not null default now(),primary key(dancer_id,venue_id)
);
create index dancer_club_starting_venue on public.dancer_club_starting_profiles(venue_id);
create index dancer_club_starting_source on public.dancer_club_starting_profiles(source_venue_id);
alter table public.dancer_club_starting_profiles enable row level security;
revoke all on public.dancer_club_starting_profiles from public,anon,authenticated;
grant all on public.dancer_club_starting_profiles to service_role;
create policy dancer_club_starting_service on public.dancer_club_starting_profiles to service_role using(true) with check(true);

create function private.editor_media_available(p_dancer uuid,p_venue uuid,p_source text,p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select private.editor_media_origin(p_source,p_id)=p_venue
 or case when exists(select 1 from public.dancer_club_starting_profiles where dancer_id=p_dancer and venue_id=p_venue)
 then exists(select 1 from public.dancer_club_starting_profiles s,jsonb_array_elements(s.items) x
   where s.dancer_id=p_dancer and s.venue_id=p_venue and x->>'source'=p_source and x->>'id'=p_id::text)
 else private.editor_media_origin(p_source,p_id) is null end
$$;

create function private.seed_first_club_profile(p_dancer uuid,p_venue uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare candidate record; allowed jsonb; snapshot jsonb; main_photo uuid;
begin
 if exists(select 1 from public.dancer_club_starting_profiles where dancer_id=p_dancer and venue_id=p_venue)
 or exists(select 1 from public.club_media_permissions where dancer_id=p_dancer and venue_id=p_venue)
 or exists(select 1 from public.dancer_media_batches where dancer_id=p_dancer and venue_id=p_venue) then return;end if;
 for candidate in
  select c.venue_id,max(c.last_check_in) last_check_in from (
   select venue_id,checked_in_at last_check_in from public.shifts where dancer_id=p_dancer and checked_in_at is not null
   union all select venue_id,null::timestamptz from public.venue_dancer_affiliations where dancer_id=p_dancer and status='active' and revoked_at is null
  ) c where c.venue_id<>p_venue group by c.venue_id order by max(c.last_check_in) desc nulls last,c.venue_id
 loop
  allowed:=public.club_public_media(candidate.venue_id,array[p_dancer]);
  if not exists(select 1 from jsonb_array_elements(allowed) x where x->>'photoId' is not null) then continue;end if;
  select jsonb_agg(jsonb_build_object('id',m.id,'source',m.source,'photoId',m.photo_id,
   'isMain',coalesce((x->>'isMain')::boolean,false) or m.is_main,'preferredMain',coalesce((x->>'isMain')::boolean,false)) order by m.created_at,m.id)
   into snapshot from public.dancer_club_media(array[p_dancer]) m join jsonb_array_elements(allowed) x
   on m.photo_id=(x->>'photoId')::uuid or m.id=(x->>'videoId')::uuid or m.record->>'final_storage_path'=x->>'avatarPath';
  insert into public.dancer_club_starting_profiles(dancer_id,venue_id,source_venue_id,items) values(p_dancer,p_venue,candidate.venue_id,snapshot);
  select (x->>'photoId')::uuid into main_photo from jsonb_array_elements(snapshot) x where x->>'photoId' is not null
   order by (x->>'preferredMain')::boolean desc,(x->>'isMain')::boolean desc limit 1;
  if main_photo is not null and not exists(select 1 from public.dancer_club_media_edits
   where dancer_id=p_dancer and venue_id=p_venue and is_main and not removed) then
   insert into public.dancer_club_media_edits(dancer_id,venue_id,kind,media_id,is_main) values(p_dancer,p_venue,'photo',main_photo,true)
    on conflict(dancer_id,venue_id,kind,media_id) do nothing;
  end if;
  return;
 end loop;
end $$;

-- A real tap freezes the off-shift draft IDs. Processing may finish later;
-- uploads added after that tap still require the dancer's Submit action.
create table public.dancer_media_check_in_submissions (
 id uuid primary key default gen_random_uuid(),
 dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete cascade,
 session_id uuid not null,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
 created_at timestamptz not null default now(), completed_at timestamptz,
 unique(dancer_id,session_id)
);
create index dancer_media_check_in_pending on public.dancer_media_check_in_submissions(dancer_id,venue_id) where completed_at is null;
create index dancer_media_check_in_venue on public.dancer_media_check_in_submissions(venue_id);
alter table public.dancer_media_check_in_submissions enable row level security;
revoke all on public.dancer_media_check_in_submissions from public,anon,authenticated;
grant all on public.dancer_media_check_in_submissions to service_role;
create policy dancer_media_check_in_service on public.dancer_media_check_in_submissions to service_role using(true) with check(true);

create function private.flush_check_in_media(p_dancer uuid,p_venue uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare q public.dancer_media_check_in_submissions; snapshot jsonb;
begin
 if not exists(select 1 from public.dancer_media_check_in_submissions where dancer_id=p_dancer and venue_id=p_venue and completed_at is null) then return;end if;
 perform 1 from public.dancer_profiles where id=p_dancer for update;
 for q in select * from public.dancer_media_check_in_submissions where dancer_id=p_dancer and venue_id=p_venue and completed_at is null order by created_at,id for update loop
  if exists(select 1 from jsonb_array_elements(q.items) x
   join public.image_moderation_records r on x->>'source'='upload' and r.id=(x->>'id')::uuid
   where r.status in ('pending','moderating','moderation_retry')
   and not private.editor_media_removed(p_dancer,p_venue,'photo',r.id,r.image_id))
  or exists(select 1 from jsonb_array_elements(q.items) x
   join public.mydancr_tv_videos v on x->>'source'='video' and v.id=(x->>'id')::uuid
   where (v.status in ('uploading','moderating') or v.upload_validation_pending)
   and not private.editor_media_removed(p_dancer,p_venue,'video',v.id)) then continue;end if;
  select jsonb_agg(s.item order by s.item->>'key') into snapshot from private.media_batch_snapshot(p_dancer) s
  where not s.submitted and not s.published
   and exists(select 1 from jsonb_array_elements(q.items) x where x->>'source'=s.item->>'source' and x->>'id'=s.item->>'id')
   and not private.editor_media_removed(p_dancer,p_venue,s.item->>'kind',(s.item->>'id')::uuid);
  if snapshot is not null then
   insert into public.dancer_media_submissions(dancer_id,items) values(p_dancer,snapshot);
   perform private.attach_media_batches(p_venue,p_dancer);
  end if;
  update public.dancer_media_check_in_submissions set completed_at=clock_timestamp() where id=q.id;
 end loop;
end $$;

create function private.capture_check_in_media() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d public.dancer_profiles; v uuid; captured jsonb;
begin
 -- Only the validated, newly inserted tap receipt can submit offline drafts.
 if coalesce((new.receipt->>'alreadyWorking')::boolean,false)
  or (new.receipt->>'enrollmentStatus' is distinct from 'pending' and (new.receipt->>'shiftCheckedIn')::boolean is distinct from true) then return new;end if;
 select * into d from public.dancer_profiles where user_id=new.user_id and disabled_at is null for update;
 if not found or (d.approved_at is null and d.status<>'approved') then return new;end if;
 if new.receipt->>'enrollmentStatus'='pending' and exists(select 1 from public.shifts s where s.dancer_id=d.id
  and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
  and s.location_status='club_confirmed' and s.location_verification_expires_at>now()) then return new;end if;
 select venue_id into v from public.nfc_tags where id=new.tag_id and status='active';
 if v is null or new.receipt->>'venueId' is distinct from v::text then return new;end if;
 perform private.seed_first_club_profile(d.id,v);
 with drafts as (
  select r.id,'upload' source,'photo' kind from public.image_moderation_records r
   where r.user_id=d.user_id and r.editor_venue_id=v and r.upload_context like 'profile_%'
   and r.status in ('pending','moderating','moderation_retry','pending_review','moderation_error')
  union all select t.id,'video','video' from public.mydancr_tv_videos t
   where t.dancer_id=d.id and t.editor_venue_id=v and t.distribution_scope='profile_and_feed'
   and t.status in ('uploading','moderating','submitted')
 ) select jsonb_agg(jsonb_build_object('id',m.id,'source',m.source) order by m.source,m.id) into captured from drafts m
 where not private.editor_media_removed(d.id,v,m.kind,m.id)
 and not exists(select 1 from private.media_batch_snapshot(d.id) s where s.item->>'id'=m.id::text and s.item->>'source'=m.source and s.submitted)
 and not exists(select 1 from public.dancer_media_check_in_submissions q,jsonb_array_elements(q.items) x
   where q.dancer_id=d.id and q.venue_id=v and q.completed_at is null and x->>'source'=m.source and x->>'id'=m.id::text);
 if captured is not null then
  insert into public.dancer_media_check_in_submissions(dancer_id,venue_id,session_id,items) values(d.id,v,new.session_id,captured)
   on conflict(dancer_id,session_id) do nothing;
  perform private.flush_check_in_media(d.id,v);
 else
  perform private.attach_media_batches(v,d.id);
 end if;
 return new;
end $$;
create trigger submit_off_shift_media_on_tap after insert on public.dancer_channel_tap_receipts
 for each row execute function private.capture_check_in_media();

create function private.finish_check_in_media_processing() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d uuid;v uuid;
begin
 if tg_table_name='image_moderation_records' then
  select id into d from public.dancer_profiles where user_id=new.user_id;v:=new.editor_venue_id;
 elsif tg_table_name='mydancr_tv_videos' then d:=new.dancer_id;v:=new.editor_venue_id;
 else d:=new.dancer_id;v:=new.venue_id;end if;
 if d is not null and v is not null then perform private.flush_check_in_media(d,v);end if;
 return new;
end $$;
create trigger check_in_photo_processing after update of status,category_flags on public.image_moderation_records
 for each row execute function private.finish_check_in_media_processing();
create trigger check_in_video_processing after update of status,upload_validation_pending,moderation_details on public.mydancr_tv_videos
 for each row execute function private.finish_check_in_media_processing();
create trigger check_in_media_removal after insert or update of removed on public.dancer_club_media_edits
 for each row execute function private.finish_check_in_media_processing();

-- Off-shift drafts are saved, not emailed by an old browser's Submit button.
alter function public.submit_dancer_club_media_batch(uuid,uuid) rename to submit_checked_in_media_batch;
alter function public.submit_checked_in_media_batch(uuid,uuid) set schema private;
create function public.submit_dancer_club_media_batch(p_actor uuid,p_venue uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ctx jsonb;
begin
 ctx:=public.dancer_media_editor_context(p_actor,p_venue);
 if not exists(select 1 from public.shifts s where s.dancer_id=(ctx->>'dancerId')::uuid and s.venue_id=p_venue
  and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
  and s.location_status='club_confirmed' and s.location_verification_expires_at>now()) then
  return jsonb_build_object('submitted',0,'waitingForCheckIn',true,'venueId',p_venue);
 end if;
 return private.submit_checked_in_media_batch(p_actor,p_venue);
end $$;
revoke all on function private.editor_media_available(uuid,uuid,text,uuid),private.seed_first_club_profile(uuid,uuid),
 private.flush_check_in_media(uuid,uuid),private.capture_check_in_media(),private.finish_check_in_media_processing(),
 public.submit_dancer_club_media_batch(uuid,uuid) from public,anon,authenticated;
grant execute on function private.editor_media_available(uuid,uuid,text,uuid),private.seed_first_club_profile(uuid,uuid),
 private.flush_check_in_media(uuid,uuid),private.capture_check_in_media(),private.finish_check_in_media_processing(),
 public.submit_dancer_club_media_batch(uuid,uuid) to service_role;
create or replace function public.club_public_media(p_venue_id uuid,p_dancer_ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 with allowed as (
 select x,m.id,m.source,m.photo_id,m.dancer_id,m.kind,r.editor_is_main,r.editor_replaces_photo_id,r.created_at,
 e.is_main,e.is_pinned from jsonb_array_elements(public.club_public_media_before_editor(p_venue_id,p_dancer_ids)) x
 join public.dancer_club_media(p_dancer_ids) m on m.dancer_id=(x->>'dancerId')::uuid
 and (m.photo_id=(x->>'photoId')::uuid or m.id=(x->>'videoId')::uuid or m.record->>'final_storage_path'=x->>'avatarPath')
 left join public.image_moderation_records r on m.source='upload' and r.id=m.id
 left join public.dancer_club_media_edits e on e.dancer_id=m.dancer_id and e.venue_id=p_venue_id and e.kind=m.kind and e.media_id=coalesce(m.photo_id,m.id)
 where private.editor_media_available(m.dancer_id,p_venue_id,m.source,m.id)
 ), visible as (
 select a.* from allowed a where not private.editor_media_removed(a.dancer_id,p_venue_id,a.kind,a.id,a.photo_id)
 and not exists(select 1 from allowed n where n.dancer_id=a.dancer_id and n.editor_replaces_photo_id=a.photo_id)
 ), mains as (
 select distinct on (dancer_id) dancer_id,photo_id from visible where photo_id is not null and (is_main or editor_is_main)
 order by dancer_id,is_main desc nulls last,created_at desc nulls last,id
 ) select coalesce(jsonb_agg(v.x||jsonb_build_object('isMain',coalesce(v.photo_id=m.photo_id,false),'isPinned',v.is_pinned)),'[]')
 from visible v left join mains m on m.dancer_id=v.dancer_id
$$;

create or replace function public.dancer_club_media_statuses(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with d as (select id from public.dancer_profiles where user_id=p_user_id),
 base as (select x from jsonb_array_elements(public.dancer_club_media_statuses_before_editor(p_user_id)) x
  where private.editor_media_available((select id from d),(x->>'venueId')::uuid,x->>'source',(x->>'id')::uuid)),
 drafts as (
  select r.id,r.image_id photo_id,'photo' kind,'upload' source,r.editor_venue_id venue_id,r.status from public.image_moderation_records r
  where r.user_id=p_user_id and r.editor_venue_id is not null and r.upload_context like 'profile_%'
  union all select v.id,null,'video','video',v.editor_venue_id,v.status from public.mydancr_tv_videos v
  where v.dancer_id in(select id from d) and v.editor_venue_id is not null and v.status not in ('hidden','removed','expired')
 ), items as (
  select x from base union all
  select jsonb_build_object('id',r.id,'photoId',r.photo_id,'kind',r.kind,'source',r.source,'venueId',v.id,'venueName',v.name,
   'status',case when r.status='rejected' then 'rejected' else 'pending' end)
  from drafts r join public.venues v on v.id=r.venue_id
  where not exists(select 1 from base b where b.x->>'id'=r.id::text and b.x->>'venueId'=v.id::text)
 ), published as materialized (
  select v.venue_id,p from (select distinct (x->>'venueId')::uuid venue_id from items) v,
  lateral jsonb_array_elements(public.club_public_media(v.venue_id,array[(select id from d)])) p
 ) select coalesce(jsonb_agg(x||jsonb_build_object(
 'hidden',private.editor_media_removed((select id from d),(x->>'venueId')::uuid,x->>'kind',(x->>'id')::uuid,(x->>'photoId')::uuid)
  or exists(select 1 from public.dancer_club_media(array[(select id from d)]) m
   join public.image_moderation_records r on m.source='upload' and r.id=m.id
   join public.club_media_permissions c on c.source=m.source and c.media_id=m.id and c.content_version=m.content_version
   where c.venue_id=(x->>'venueId')::uuid and c.decision='approved' and r.status='approved'
   and r.editor_venue_id=c.venue_id and r.editor_replaces_photo_id=(x->>'photoId')::uuid),
 'isMain',coalesce((p.p->>'isMain')::boolean,false),'isPinned',p.p->'isPinned')), '[]')
 from items left join published p on p.venue_id=(x->>'venueId')::uuid
 and coalesce(p.p->>'photoId',p.p->>'videoId')=coalesce(x->>'photoId',x->>'id')
$$;

create or replace function private.attach_media_batches(p_venue uuid default null,p_dancer uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
declare v record; d record; snapshot jsonb; batch uuid;
begin
 for v in select id,name from public.venues where is_active and (p_venue is null or id=p_venue) loop
  for d in select distinct dp.id,dp.stage_name,dp.status from public.dancer_profiles dp
   join public.venue_media_dancers(v.id) connected on connected.user_id=dp.user_id
   where dp.disabled_at is null and (p_dancer is null or dp.id=p_dancer)
  loop
   perform 1 from public.dancer_profiles where id=d.id for update;
   select jsonb_agg(s.item||jsonb_build_object('isMain',case
    when s.item->>'kind'<>'photo' then false
    when r.editor_venue_id=v.id and r.editor_is_main then true
    when exists(select 1 from public.dancer_club_media_edits e where e.dancer_id=d.id and e.venue_id=v.id and e.is_main and not e.removed)
    then exists(select 1 from public.dancer_club_media_edits e where e.dancer_id=d.id and e.venue_id=v.id and e.is_main and not e.removed
     and e.media_id=coalesce(r.image_id,(s.item->>'id')::uuid))
    else coalesce((s.item->>'isMain')::boolean,false) end) order by s.item->>'key') into snapshot
   from private.media_batch_snapshot(d.id) s
   left join public.image_moderation_records r on s.item->>'source'='upload' and r.id=(s.item->>'id')::uuid
   where (s.submitted or s.published)
    and private.editor_media_available(d.id,v.id,s.item->>'source',(s.item->>'id')::uuid)
    and not private.editor_media_removed(d.id,v.id,s.item->>'kind',(s.item->>'id')::uuid)
    and not exists(select 1 from public.club_media_permissions c where (s.published or not s.submitted) and d.status='approved' and c.venue_id=v.id
     and c.source=s.item->>'source' and c.media_id=(s.item->>'id')::uuid and c.content_version=s.item->>'version')
    and not exists(select 1 from public.dancer_media_batches b cross join lateral jsonb_array_elements(b.items) x
     where b.dancer_id=d.id and b.venue_id=v.id and x->>'key'=s.item->>'key' and x->>'version'=s.item->>'version');
   if snapshot is not null then
    insert into public.dancer_media_batches(dancer_id,venue_id,items) values(d.id,v.id,snapshot) returning id into batch;
    update public.dancer_media_batches set club_decisions=coalesce((
      select jsonb_object_agg(x->>'key',jsonb_build_object('decision',c.decision,'notes',coalesce(c.notes,''),'actor',c.reviewer_id))
      from jsonb_array_elements(snapshot) x join public.club_media_permissions c
       on c.venue_id=v.id and c.source=x->>'source' and c.media_id=(x->>'id')::uuid and c.content_version=x->>'version'
    ),'{}'::jsonb) where id=batch;
    perform private.emit_venue_email_event(v.id,'media-submission:'||batch,'venue_media_pending','Dancer media ready for review',
     d.stage_name||' submitted a batch of '||jsonb_array_length(snapshot)||' media items. Review the batch, then select Submit review.',
     '/dashboard/venue#venue-media-reviews');
   end if;
  end loop;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
