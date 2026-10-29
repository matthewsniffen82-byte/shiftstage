begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.image_moderation_records add column editor_venue_id uuid references public.venues(id),
 add column editor_is_main boolean not null default false,
 add column editor_replaces_photo_id uuid;
alter table public.mydancr_tv_videos add column editor_venue_id uuid references public.venues(id);
create index image_media_editor_venue on public.image_moderation_records(editor_venue_id,user_id) where editor_venue_id is not null;
create index video_media_editor_venue on public.mydancr_tv_videos(editor_venue_id,dancer_id) where editor_venue_id is not null;
create table public.dancer_club_media_edits (
 dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete cascade,
 kind text not null check(kind in ('photo','video')), media_id uuid not null,
 removed boolean not null default false, is_main boolean not null default false, is_pinned boolean,
 updated_at timestamptz not null default now(), primary key(dancer_id,venue_id,kind,media_id)
);
create index dancer_club_media_edits_venue on public.dancer_club_media_edits(venue_id,dancer_id);
create unique index dancer_club_media_edits_main on public.dancer_club_media_edits(dancer_id,venue_id) where is_main and not removed;
alter table public.dancer_club_media_edits enable row level security;
revoke all on public.dancer_club_media_edits from public,anon,authenticated;
grant all on public.dancer_club_media_edits to service_role;
create policy dancer_club_media_edits_service on public.dancer_club_media_edits to service_role using(true) with check(true);

-- A requested club is accepted only while off shift. An active check-in wins,
-- and stale requests for a different club fail instead of silently retargeting.
create function public.dancer_media_editor_context(p_actor uuid,p_venue uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d public.dancer_profiles; active_venue uuid; target uuid; setup boolean; clubs jsonb;
begin
 perform private.media_batch_authorize(p_actor,'dancer',null);
 select * into d from public.dancer_profiles where user_id=p_actor;
 setup:=d.approved_at is null and d.status<>'approved';
 select s.venue_id into active_venue from public.shifts s where s.dancer_id=d.id and s.status='posted'
  and s.checked_in_at is not null and s.checked_out_at is null and s.location_status='club_confirmed'
  and s.location_verification_expires_at>now() order by s.checked_in_at desc limit 1;
 if active_venue is not null and p_venue is not null and active_venue<>p_venue then
  raise exception 'Your check-in changed. Open the current club editor and try again.' using errcode='40001';end if;
 target:=coalesce(active_venue,p_venue);
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name) order by v.name),'[]') into clubs
 from public.venues v where v.is_active and exists(select 1 from public.venue_media_dancers(v.id) m where m.user_id=p_actor);
 if target is not null and not exists(select 1 from jsonb_array_elements(clubs) c where c->>'id'=target::text) then
  raise exception 'Choose one of your connected clubs.' using errcode='42501';end if;
 return jsonb_build_object('dancerId',d.id,'venueId',target,'onboarding',setup,'clubs',clubs);
end $$;

create function private.editor_media_origin(p_source text,p_id uuid) returns uuid
language sql stable security invoker set search_path='' as $$
 select editor_venue_id from public.image_moderation_records where p_source='upload' and id=p_id
 union all select editor_venue_id from public.mydancr_tv_videos where p_source='video' and id=p_id
$$;
create function private.editor_media_removed(p_dancer uuid,p_venue uuid,p_kind text,p_id uuid,p_photo uuid default null) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.dancer_club_media_edits e where e.dancer_id=p_dancer and e.venue_id=p_venue
 and e.kind=p_kind and e.media_id in (p_id,coalesce(p_photo,(select image_id from public.image_moderation_records where p_kind='photo' and id=p_id))) and e.removed)
$$;

alter function public.club_public_media(uuid,uuid[]) rename to club_public_media_before_editor;
create function public.club_public_media(p_venue_id uuid,p_dancer_ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 with allowed as (
 select x,m.id,m.source,m.photo_id,m.dancer_id,m.kind,r.editor_is_main,r.editor_replaces_photo_id,r.created_at,
 e.is_main,e.is_pinned from jsonb_array_elements(public.club_public_media_before_editor(p_venue_id,p_dancer_ids)) x
 join public.dancer_club_media(p_dancer_ids) m on m.dancer_id=(x->>'dancerId')::uuid
 and (m.photo_id=(x->>'photoId')::uuid or m.id=(x->>'videoId')::uuid or m.record->>'final_storage_path'=x->>'avatarPath')
 left join public.image_moderation_records r on m.source='upload' and r.id=m.id
 left join public.dancer_club_media_edits e on e.dancer_id=m.dancer_id and e.venue_id=p_venue_id and e.kind=m.kind and e.media_id=coalesce(m.photo_id,m.id)
 where (private.editor_media_origin(m.source,m.id) is null or private.editor_media_origin(m.source,m.id)=p_venue_id)
 ), visible as (
 select a.* from allowed a where not private.editor_media_removed(a.dancer_id,p_venue_id,a.kind,a.id,a.photo_id)
 and not exists(select 1 from allowed n where n.dancer_id=a.dancer_id and n.editor_replaces_photo_id=a.photo_id)
 ), mains as (
 select distinct on (dancer_id) dancer_id,photo_id from visible where photo_id is not null and (is_main or editor_is_main)
 order by dancer_id,is_main desc nulls last,created_at desc nulls last,id
 ) select coalesce(jsonb_agg(v.x||jsonb_build_object('isMain',coalesce(v.photo_id=m.photo_id,false),'isPinned',v.is_pinned)),'[]')
 from visible v left join mains m on m.dancer_id=v.dancer_id
$$;

alter function public.dancer_club_media_statuses(uuid) rename to dancer_club_media_statuses_before_editor;
create function public.dancer_club_media_statuses(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with d as (select id from public.dancer_profiles where user_id=p_user_id),
 base as (select x from jsonb_array_elements(public.dancer_club_media_statuses_before_editor(p_user_id)) x
  where (private.editor_media_origin(x->>'source',(x->>'id')::uuid) is null or private.editor_media_origin(x->>'source',(x->>'id')::uuid)=(x->>'venueId')::uuid)),
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

create function public.edit_dancer_club_media(p_actor uuid,p_venue uuid,p_kind text,p_id uuid,p_action text,p_pinned boolean default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ctx jsonb; d uuid; v uuid; item jsonb; published boolean;
begin
 ctx:=public.dancer_media_editor_context(p_actor,p_venue);d:=(ctx->>'dancerId')::uuid;v:=(ctx->>'venueId')::uuid;
 if v is null then raise exception 'Choose a club before editing media.' using errcode='22023';end if;
 perform 1 from public.dancer_profiles where id=d for update;
 select x into item from jsonb_array_elements(public.dancer_club_media_statuses(p_actor)) x
 where x->>'venueId'=v::text and x->>'kind'=p_kind and (x->>'id'=p_id::text or x->>'photoId'=p_id::text) limit 1;
 if item is null then raise exception 'This media does not belong to this club.' using errcode='42501';end if;
 if p_action not in ('remove','main','pin') or (p_action='main' and p_kind<>'photo') then raise exception 'Invalid media action.' using errcode='22023';end if;
 if p_action<>'remove' and not exists(select 1 from jsonb_array_elements(public.club_public_media(v,array[d])) x
 where coalesce(x->>'photoId',x->>'videoId')=p_id::text) then raise exception 'Choose approved media for this club.' using errcode='22023';end if;
 if p_action='main' then update public.dancer_club_media_edits set is_main=false where dancer_id=d and venue_id=v and is_main;end if;
 insert into public.dancer_club_media_edits(dancer_id,venue_id,kind,media_id,removed,is_main,is_pinned)
 values(d,v,p_kind,p_id,p_action='remove',p_action='main',case when p_action='pin' then p_pinned end)
 on conflict(dancer_id,venue_id,kind,media_id) do update set removed=case when p_action='remove' then true else dancer_club_media_edits.removed end,
 is_main=case when p_action='main' then true when p_action='remove' then false else dancer_club_media_edits.is_main end,
 is_pinned=case when p_action='pin' then p_pinned else dancer_club_media_edits.is_pinned end,updated_at=now();
 return jsonb_build_object('id',p_id,'venueId',v,'isPinned',p_pinned,'clubOnly',true);
end $$;

create function public.submit_dancer_club_media_batch(p_actor uuid,p_venue uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ctx jsonb;d uuid;v uuid;snapshot jsonb;submission uuid;
begin
 ctx:=public.dancer_media_editor_context(p_actor,p_venue);d:=(ctx->>'dancerId')::uuid;v:=(ctx->>'venueId')::uuid;
 if v is null then raise exception 'Choose a club before submitting media.' using errcode='22023';end if;
 perform 1 from public.dancer_profiles where id=d for update;
 if exists(select 1 from public.image_moderation_records r where r.user_id=p_actor and r.editor_venue_id=v and r.status in ('pending','moderating','moderation_retry')
 and not private.editor_media_removed(d,v,'photo',r.id,r.image_id))
 or exists(select 1 from public.mydancr_tv_videos t where t.dancer_id=d and t.editor_venue_id=v and (t.status in ('uploading','moderating') or t.upload_validation_pending)
 and not private.editor_media_removed(d,v,'video',t.id))
 then raise exception 'Wait for media processing to finish before submitting.' using errcode='22023';end if;
 select jsonb_agg(s.item order by s.item->>'key') into snapshot from private.media_batch_snapshot(d) s
 where not s.submitted and not s.published and (private.editor_media_origin(s.item->>'source',(s.item->>'id')::uuid)=v
 or private.editor_media_origin(s.item->>'source',(s.item->>'id')::uuid) is null)
 and not private.editor_media_removed(d,v,s.item->>'kind',(s.item->>'id')::uuid);
 if snapshot is not null then
  update public.image_moderation_records set editor_venue_id=v where editor_venue_id is null and id in(select (x->>'id')::uuid from jsonb_array_elements(snapshot) x where x->>'source'='upload');
  update public.mydancr_tv_videos set editor_venue_id=v where editor_venue_id is null and id in(select (x->>'id')::uuid from jsonb_array_elements(snapshot) x where x->>'source'='video');
  insert into public.dancer_media_submissions(dancer_id,items) values(d,snapshot) returning id into submission;
 end if;
 perform private.attach_media_batches(v,d);
 return jsonb_build_object('submitted',coalesce(jsonb_array_length(snapshot),0),'submissionId',submission,'venueId',v);
end $$;

revoke all on function public.dancer_media_editor_context(uuid,uuid),public.edit_dancer_club_media(uuid,uuid,text,uuid,text,boolean),
 public.submit_dancer_club_media_batch(uuid,uuid),public.club_public_media(uuid,uuid[]),public.dancer_club_media_statuses(uuid),
 private.editor_media_origin(text,uuid),private.editor_media_removed(uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.dancer_media_editor_context(uuid,uuid),public.edit_dancer_club_media(uuid,uuid,text,uuid,text,boolean),
 public.submit_dancer_club_media_batch(uuid,uuid),public.club_public_media(uuid,uuid[]),public.dancer_club_media_statuses(uuid),
 private.editor_media_origin(text,uuid),private.editor_media_removed(uuid,uuid,text,uuid,uuid) to service_role;

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
   select jsonb_agg(s.item order by s.item->>'key') into snapshot from private.media_batch_snapshot(d.id) s
   where (s.submitted or s.published)
    and (private.editor_media_origin(s.item->>'source',(s.item->>'id')::uuid) is null or private.editor_media_origin(s.item->>'source',(s.item->>'id')::uuid)=v.id)
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

create or replace function public.get_media_batches(p_actor uuid,p_role text,p_venue uuid default null,p_dancer uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; own_dancer uuid; drafts integer:=0;
begin
 perform private.media_batch_authorize(p_actor,p_role,p_venue,p_dancer);
 if p_role='dancer' then
  select id into own_dancer from public.dancer_profiles where user_id=p_actor;
  select count(*) into drafts from private.media_batch_snapshot(own_dancer) where not submitted and not published
   and (p_venue is null or private.editor_media_origin(item->>'source',(item->>'id')::uuid) is null or private.editor_media_origin(item->>'source',(item->>'id')::uuid)=p_venue)
   and (p_venue is null or not private.editor_media_removed(own_dancer,p_venue,item->>'kind',(item->>'id')::uuid));
 elsif p_role='venue' then perform private.attach_media_batches(p_venue,p_dancer);end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at),'[]') into result from (
  select b.id,b.dancer_id,b.venue_id,b.state,b.revision,b.created_at,b.result,d.stage_name,v.name venue_name,
   jsonb_array_length(b.items) item_count from public.dancer_media_batches b
   join public.dancer_profiles d on d.id=b.dancer_id join public.venues v on v.id=b.venue_id
   where (p_dancer is null or b.dancer_id=p_dancer)
    and case p_role when 'dancer' then b.dancer_id=own_dancer and (p_venue is null or b.venue_id=p_venue)
      when 'venue' then b.venue_id=p_venue and b.state='club' else b.state='admin' and (p_venue is null or b.venue_id=p_venue) end
   order by case when p_role='dancer' then b.created_at end desc,b.created_at,b.id limit 100
 ) q;
 return jsonb_build_object('batches',result,'draftCount',drafts,'waitingForClub',p_role='dancer' and exists(
  select 1 from public.dancer_media_submissions s cross join lateral jsonb_array_elements(s.items) x where s.dancer_id=own_dancer
   and not exists(select 1 from public.dancer_media_batches b cross join lateral jsonb_array_elements(b.items) y
    where b.dancer_id=own_dancer and y->>'key'=x->>'key' and y->>'version'=x->>'version')));
end $$;

create or replace function public.get_media_batch(p_actor uuid,p_role text,p_batch uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b public.dancer_media_batches; rows jsonb;
begin
 select * into b from public.dancer_media_batches where id=p_batch;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,p_role,b.venue_id,b.dancer_id);
 if p_role='admin' and b.state='club' then raise exception 'Club must submit this review first.' using errcode='42501';end if;
 select jsonb_agg(x||jsonb_build_object('record',m.record,
  'withdrawn',m.id is null or private.editor_media_removed(b.dancer_id,b.venue_id,x->>'kind',(x->>'id')::uuid,m.photo_id),'resolved',m.record->>'status'='approved',
  'club',b.club_decisions->(x->>'key'),'admin',b.admin_decisions->(x->>'key')) order by x->>'isMain' desc,x->>'key') into rows
 from jsonb_array_elements(b.items) x left join public.dancer_club_media(array[b.dancer_id]) m
 on m.id=(x->>'id')::uuid and m.source=x->>'source' and m.content_version=x->>'version';
 return to_jsonb(b)||jsonb_build_object('items',rows);
end $$;

create or replace function public.submit_club_media_batch(p_actor uuid,p_batch uuid,p_revision uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.dancer_media_batches; x jsonb; m record; decision jsonb; permission text;
begin
 perform 1 from public.dancer_profiles where id=(select dancer_id from public.dancer_media_batches where id=p_batch) for update;
 select * into b from public.dancer_media_batches where id=p_batch for update;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,'venue',b.venue_id,b.dancer_id);
 if b.state<>'club' then return jsonb_build_object('id',b.id,'state',b.state);end if;
 if b.revision<>p_revision then raise exception 'This batch changed. Refresh before submitting.' using errcode='40001';end if;
 perform set_config('mydancr.media_batch',b.id::text,true);
 for x in select value from jsonb_array_elements(b.items) loop
  select * into m from public.dancer_club_media(array[b.dancer_id]) where id=(x->>'id')::uuid and source=x->>'source' and content_version=x->>'version';
  if not found then continue;end if;
  if private.editor_media_removed(b.dancer_id,b.venue_id,m.kind,m.id,m.photo_id) then continue;end if;
  decision:=b.club_decisions->(x->>'key');
  if decision->>'decision' is null then raise exception 'Review every item before submitting.' using errcode='22023';end if;
  select revision::text into permission from public.club_media_permissions where venue_id=b.venue_id and source=m.source and media_id=m.id;
  perform public.set_club_media_permission(p_actor,b.venue_id,b.dancer_id,m.source,m.id,m.content_version,permission,decision->>'decision',decision->>'notes');
 end loop;
 update public.dancer_media_batches set state='admin',revision=gen_random_uuid(),club_submitted_by=p_actor,club_submitted_at=now() where id=b.id;
 perform private.media_batch_admin_email(b.id,(select stage_name from public.dancer_profiles where id=b.dancer_id));
 return jsonb_build_object('id',b.id,'state','admin');
end $$;

create or replace function public.submit_admin_media_batch(p_actor uuid,p_batch uuid,p_revision uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.dancer_media_batches; d public.dancer_profiles; x jsonb; m record; r public.image_moderation_records;
 choice jsonb; rejected jsonb:='[]'; v_result jsonb; ready boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||(select dp.user_id::text from public.dancer_profiles dp join public.dancer_media_batches mb on mb.dancer_id=dp.id where mb.id=p_batch),0));
 select * into d from public.dancer_profiles where id=(select dancer_id from public.dancer_media_batches where id=p_batch) for update;
 select * into b from public.dancer_media_batches where id=p_batch for update;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,'admin',b.venue_id,b.dancer_id);
 if b.state='completed' then return jsonb_build_object('id',b.id,'state',b.state,'result',b.result);end if;
 if b.state<>'admin' or b.revision<>p_revision then raise exception 'This batch changed. Refresh before submitting.' using errcode='40001';end if;
 if d.disabled_at is not null or d.status not in ('pending_review','approved') or not exists(select 1 from public.app_users where id=d.user_id and account_state='active') then
  raise exception 'This dancer account is not eligible for publication.' using errcode='42501';end if;
 perform set_config('mydancr.media_batch',b.id::text,true);
 for x in select value from jsonb_array_elements(b.items) order by value->>'isMain' desc,value->>'key' loop
  if x->>'source'='upload' then perform 1 from public.image_moderation_records where id=(x->>'id')::uuid for update;
  elsif x->>'source'='video' then perform 1 from public.mydancr_tv_videos where id=(x->>'id')::uuid for update;end if;
  select * into m from public.dancer_club_media(array[b.dancer_id]) where id=(x->>'id')::uuid and source=x->>'source' and content_version=x->>'version';
  if not found then continue;end if;
  if private.editor_media_removed(b.dancer_id,b.venue_id,m.kind,m.id,m.photo_id) then continue;end if;
  if b.club_decisions->(x->>'key')->>'decision'='rejected' then
   rejected:=rejected||jsonb_build_array(jsonb_build_object('targetType',m.kind,'targetId',m.id,'isMain',m.is_main,'reviewScope','club'));continue;
  end if;
  if m.record->>'status'='approved' then continue;end if;
  choice:=b.admin_decisions->(x->>'key');
  if choice->>'decision' is null then raise exception 'Review every item before submitting.' using errcode='22023';end if;
  if choice->>'decision'='rejected' then
   rejected:=rejected||jsonb_build_array(jsonb_build_object('targetType',m.kind,'targetId',m.id,'isMain',m.is_main,'reviewScope','platform'));
   if m.source='upload' then
    update public.image_moderation_records set decision='rejected',status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_decision='rejected',review_notes=nullif(choice->>'notes',''),updated_at=clock_timestamp() where id=m.id;
   else update public.mydancr_tv_videos set status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_notes=nullif(choice->>'notes',''),published_at=null,expires_at=null,venue_featured=false where id=m.id;end if;
  elsif m.source='upload' then
   select * into r from public.image_moderation_records where id=m.id for update;
   if r.category_flags->>'publication_prepared' is distinct from 'true' or r.final_storage_path is null then
    raise exception 'Finish preparing this photo before submitting.' using errcode='22023';end if;
   if r.upload_context='profile_avatar' then
    perform public.publish_approved_dancer_avatar(r.id,r.updated_at,r.final_storage_path,r.reason_codes,r.category_flags,r.category_scores,r.provider_flagged,p_actor,choice->>'notes',d.avatar_storage_path,d.avatar_updated_at);
   else
    perform public.publish_approved_dancer_gallery_photo(r.id,r.updated_at,r.final_storage_path,r.reason_codes,r.category_flags,r.category_scores,r.provider_flagged,null,p_actor,choice->>'notes');
   end if;
  elsif m.source='video' then
   if (m.record->>'duration_seconds')::numeric>30 or m.record->'moderation_details'->'preparedPublication'->>'storagePath' is distinct from m.record->>'storage_path' then
    raise exception 'Finish preparing this video before submitting.' using errcode='22023';end if;
   update public.mydancr_tv_videos set status='approved',reviewed_by=p_actor,reviewed_at=now(),review_notes=nullif(choice->>'notes',''),published_at=now(),expires_at=now()+interval '90 days' where id=m.id;
  end if;
 end loop;
 update public.dancer_media_batches set state='completed',revision=gen_random_uuid(),admin_submitted_by=p_actor,completed_at=now() where id=b.id;
 select count(*)>=3 and coalesce(bool_or(is_primary),false) into ready from public.dancer_photos where dancer_id=d.id and review_status='approved';
 ready:=ready and exists(select 1 from public.mydancr_tv_videos where dancer_id=d.id and status='approved' and distribution_scope='profile_and_feed');
 if ready then perform public.finalize_pending_dancer_nfc_enrollment(d.user_id,null,'{}');end if;
 v_result:=private.dancer_media_review_outcome(d.user_id,rejected);
 update public.dancer_media_batches set result=v_result||jsonb_build_object('batchId',b.id) where id=b.id;
 insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload)
 values(d.user_id,v_result->>'title',v_result->>'body',v_result||jsonb_build_object('kind','dancer_media_batch_result','batchId',b.id,'dancerId',d.id,'items',rejected));
 return jsonb_build_object('id',b.id,'state','completed','result',v_result);
end $$;
notify pgrst,'reload schema';
commit;
