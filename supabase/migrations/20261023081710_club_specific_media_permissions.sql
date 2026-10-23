begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

-- Platform publication is unchanged. These decisions govern one club's display
-- of an exact upload version, including already published and legacy media.
create table public.club_media_permissions (
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  source text not null check(source in ('upload','photo','avatar','video')),
  media_id uuid not null,
  content_version text not null,
  decision text not null check(decision in ('approved','rejected')),
  reviewer_id uuid references public.app_users(id),
  notes text check(length(notes)<=4000),
  provenance text not null default 'review' check(provenance in ('review','existing_display')),
  revision uuid not null default gen_random_uuid(),
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key(venue_id,source,media_id)
);
create index club_media_permissions_dancer_idx on public.club_media_permissions(dancer_id,venue_id);
create index club_media_permissions_reviewer_idx on public.club_media_permissions(reviewer_id);
alter table public.club_media_permissions enable row level security;
revoke all on public.club_media_permissions from public,anon,authenticated;
grant select,insert,update,delete on public.club_media_permissions to service_role;
create policy club_media_permissions_service on public.club_media_permissions to service_role using(true) with check(true);

create function public.dancer_club_media(p_dancer_ids uuid[])
returns table(id uuid,dancer_id uuid,user_id uuid,stage_name text,kind text,source text,
  content_version text,created_at timestamptz,is_main boolean,photo_id uuid,record jsonb)
language sql stable security invoker set search_path='' as $$
  with dancers as materialized(select d.* from public.dancer_profiles d where d.id=any(p_dancer_ids)),
  uploads as materialized(
    select r.*,d.id dancer_id,d.stage_name from public.image_moderation_records r join dancers d on d.user_id=r.user_id
    where r.upload_context like 'profile_%' and (
      (r.decision='review' and r.status='pending_review' and r.temporary_storage_path is not null
        and r.category_flags->'file_checks_passed'='true'::jsonb)
      or (r.decision='approved' and r.status='approved' and (
        exists(select 1 from public.dancer_photos p where p.id=r.image_id and p.dancer_id=d.id
          and p.review_status='approved' and p.storage_path=r.final_storage_path)
        or (r.upload_context='profile_avatar' and r.final_storage_path=d.avatar_storage_path)))))
  select r.id,r.dancer_id,r.user_id,r.stage_name,'photo','upload',
    md5(jsonb_build_array(r.user_id,r.temporary_storage_path,r.replacement_photo_id,r.upload_context='profile_avatar')::text),
    r.created_at,r.upload_context like 'profile_main%',r.image_id,to_jsonb(r)
  from uploads r
  union all
  select p.id,d.id,d.user_id,d.stage_name,'photo','photo',md5(p.storage_path),p.created_at,p.is_primary,p.id,
    jsonb_build_object('id',p.id,'user_id',d.user_id,'decision','approved','status','approved',
      'upload_context',case when p.is_primary then 'profile_main' else 'profile_gallery' end,
      'final_storage_path',p.storage_path,'updated_at',p.created_at)
  from public.dancer_photos p join dancers d on d.id=p.dancer_id
  where p.review_status='approved' and not exists(select 1 from uploads r where r.image_id=p.id and r.decision='approved')
  union all
  select d.id,d.id,d.user_id,d.stage_name,'photo','avatar',md5(d.avatar_storage_path),d.created_at,false,null::uuid,
    jsonb_build_object('id',d.id,'user_id',d.user_id,'decision','approved','status','approved','upload_context','profile_avatar',
      'final_storage_path',d.avatar_storage_path,'updated_at',d.updated_at)
  from dancers d where nullif(d.avatar_storage_path,'') is not null
    and not exists(select 1 from uploads r where r.upload_context='profile_avatar' and r.decision='approved' and r.final_storage_path=d.avatar_storage_path)
  union all
  select v.id,d.id,d.user_id,d.stage_name,'video','video',
    md5(jsonb_build_array(v.submitted_by,v.storage_path,v.storage_mime,v.caption,v.width,v.height,v.duration_seconds)::text),
    v.created_at,false,null::uuid,to_jsonb(v)
  from public.mydancr_tv_videos v join dancers d on d.id=v.dancer_id
  where (v.status='submitted' and not v.upload_validation_pending and v.moderation_details->'fileChecksPassed'='true'::jsonb)
    or v.status='approved'
$$;

-- Existing club presentations keep their current published media. This never
-- grants permission at a future affiliation or for replacement bytes/captions.
insert into public.club_media_permissions(venue_id,dancer_id,source,media_id,content_version,decision,provenance)
select distinct a.venue_id,m.dancer_id,m.source,m.id,m.content_version,'approved','existing_display'
from public.venue_dancer_affiliations a
cross join lateral public.dancer_club_media(array[a.dancer_id]) m
where a.status='active' and a.revoked_at is null and m.record->>'status'='approved'
on conflict do nothing;
-- Preserve a recorded club sign-off even while platform publication is pending.
insert into public.club_media_permissions(venue_id,dancer_id,source,media_id,content_version,decision,reviewer_id,notes)
select (m.record->>'club_review_venue_id')::uuid,m.dancer_id,m.source,m.id,m.content_version,'approved',
  (m.record->>'club_reviewed_by')::uuid,m.record->>'club_review_notes'
from public.dancer_club_media(array(select id from public.dancer_profiles)) m
where m.record->>'club_reviewed_at' is not null and m.record->>'club_review_venue_id' is not null
on conflict(venue_id,source,media_id) do update set reviewer_id=excluded.reviewer_id,provenance='review';

create function public.get_club_media_queue(p_actor_id uuid,p_venue_id uuid,p_dancer_id uuid default null,
  p_offset integer default 0,p_limit integer default 12,p_status text default 'pending')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_dancer_media_reviewer(p_actor_id,null,p_venue_id);
  if p_status not in ('pending','all') then raise exception 'MEDIA_REVIEW_INVALID' using errcode='22023';end if;
  with dancers as materialized(select distinct d.id,d.stage_name from public.dancer_profiles d
    join public.venue_media_dancers(p_venue_id) s on s.user_id=d.user_id),
  media as materialized(
    select m.*,case when a.content_version=m.content_version then a.decision else 'pending' end club_status,
      a.revision::text decision_version
    from public.dancer_club_media(array(select id from dancers)) m
    left join public.club_media_permissions a on a.venue_id=p_venue_id and a.source=m.source and a.media_id=m.id),
  chosen as materialized(select * from media where p_status='all' or club_status='pending'),
  grouped as(select dancer_id,stage_name,count(*) n,min(created_at) oldest,
    count(*) filter(where kind='photo') photos,count(*) filter(where kind='video') videos from chosen group by dancer_id,stage_name),
  dp as(select * from grouped order by oldest,dancer_id limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset)),
  mp as(select * from chosen where dancer_id=p_dancer_id order by is_main desc,created_at,id,source
    limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset))
  select jsonb_build_object('count',(select count(*) from media where club_status='pending'),
    'dancerCount',(select count(*) from grouped),'uploadCount',(select count(*) from chosen where dancer_id=p_dancer_id),
    'dancer',(select jsonb_build_object('id',id,'stageName',stage_name) from dancers where id=p_dancer_id),
    'dancers',coalesce((select jsonb_agg(jsonb_build_object('id',dancer_id,'stageName',stage_name,'count',n,
      'photoCount',photos,'videoCount',videos) order by oldest,dancer_id) from dp),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'source',source,'dancerId',dancer_id,
      'stageName',stage_name,'record',record,'contentVersion',content_version,'decisionVersion',decision_version,
      'clubStatus',club_status) order by is_main desc,created_at,id,source) from mp),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.set_club_media_permission(p_actor_id uuid,p_venue_id uuid,p_dancer_id uuid,p_source text,
  p_id uuid,p_content_version text,p_decision_version text,p_decision text,p_notes text default '')
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare m record; a public.club_media_permissions%rowtype; owner_id uuid; result jsonb;
begin
  if p_decision is null or p_source is null or p_venue_id is null or p_actor_id is null or p_decision not in ('approved','rejected') or p_source not in ('upload','photo','avatar','video')
    or p_content_version is null or length(coalesce(p_notes,''))>4000 then
    raise exception 'MEDIA_REVIEW_INVALID' using errcode='22023';end if;
  -- Serialize with gallery publication and independent decisions for this dancer.
  select user_id into owner_id from public.dancer_profiles where id=p_dancer_id for update;
  if not found then raise exception 'MEDIA_REVIEW_MISSING' using errcode='P0002';end if;
  perform public.assert_dancer_media_reviewer(p_actor_id,owner_id,p_venue_id);
  if p_source='upload' then perform 1 from public.image_moderation_records where id=p_id for update;
  elsif p_source='video' then perform 1 from public.mydancr_tv_videos where id=p_id for update;
  elsif p_source='photo' then perform 1 from public.dancer_photos where id=p_id for update;end if;
  select * into m from public.dancer_club_media(array[p_dancer_id]) where id=p_id and source=p_source;
  if not found or m.content_version is distinct from p_content_version then
    raise exception 'MEDIA_REVIEW_CHANGED' using errcode='40001';end if;
  select * into a from public.club_media_permissions where venue_id=p_venue_id and source=p_source and media_id=p_id for update;
  if a.revision::text is distinct from p_decision_version then raise exception 'MEDIA_REVIEW_CHANGED' using errcode='40001';end if;
  insert into public.club_media_permissions(venue_id,dancer_id,source,media_id,content_version,decision,reviewer_id,notes)
  values(p_venue_id,p_dancer_id,p_source,p_id,p_content_version,p_decision,p_actor_id,nullif(btrim(p_notes),''))
  on conflict(venue_id,source,media_id) do update set content_version=excluded.content_version,decision=excluded.decision,
    reviewer_id=excluded.reviewer_id,notes=excluded.notes,provenance='review',revision=gen_random_uuid(),reviewed_at=clock_timestamp()
  returning * into a;
  -- Any club may nominate a private upload for the separate platform review.
  -- Other clubs still retain their own pending/rejected decisions after that.
  if p_decision='approved' and m.record->>'club_reviewed_at' is null and m.record->>'status' in ('pending_review','submitted') then
    perform public.review_club_dancer_media(p_actor_id,p_venue_id,m.kind,p_id,(m.record->>'updated_at')::timestamptz,p_notes);
  end if;
  return to_jsonb(a)||jsonb_build_object('platformApproved',m.record->>'status'='approved');
end $$;

-- Batch allowlists for server-rendered cards, galleries and all media endpoints.
-- No browser role can call this or inspect private pending uploads.
create function public.club_public_media(p_venue_id uuid,p_dancer_ids uuid[])
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('dancerId',m.dancer_id,'photoId',m.photo_id,
    'videoId',case when m.kind='video' then m.id end,
    'avatarPath',case when m.record->>'upload_context'='profile_avatar' then m.record->>'final_storage_path' end)), '[]'::jsonb)
  from public.dancer_club_media(p_dancer_ids) m join public.club_media_permissions a
    on a.venue_id=p_venue_id and a.source=m.source and a.media_id=m.id and a.dancer_id=m.dancer_id
      and a.content_version=m.content_version and a.decision='approved'
  where m.record->>'status'='approved'
$$;

create function public.dancer_club_media_statuses(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with d as(select id from public.dancer_profiles where user_id=p_user_id),
  clubs as(select v.id,v.name from public.venues v where exists(select 1 from public.venue_media_dancers(v.id) s where s.user_id=p_user_id))
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'photoId',m.photo_id,'kind',m.kind,'source',m.source,
    'venueId',c.id,'venueName',c.name,'status',case when a.content_version=m.content_version then a.decision else 'pending' end,
    'reason',case when a.content_version=m.content_version then a.notes end)), '[]'::jsonb)
  from public.dancer_club_media(array(select id from d)) m cross join clubs c
  left join public.club_media_permissions a on a.venue_id=c.id and a.source=m.source and a.media_id=m.id
$$;

revoke all on function public.dancer_club_media(uuid[]),public.get_club_media_queue(uuid,uuid,uuid,integer,integer,text),
  public.set_club_media_permission(uuid,uuid,uuid,text,uuid,text,text,text,text),public.club_public_media(uuid,uuid[]),
  public.dancer_club_media_statuses(uuid) from public,anon,authenticated;
grant execute on function public.dancer_club_media(uuid[]),public.get_club_media_queue(uuid,uuid,uuid,integer,integer,text),
  public.set_club_media_permission(uuid,uuid,uuid,text,uuid,text,text,text,text),public.club_public_media(uuid,uuid[]),
  public.dancer_club_media_statuses(uuid) to service_role;
commit;
