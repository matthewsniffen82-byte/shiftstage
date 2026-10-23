begin;

-- Paginate dancers before their uploads. Existing review and publication rules
-- remain authoritative; this read-only queue never publishes or changes media.
create or replace function public.get_venue_dancer_media_grid(
  p_actor_id uuid, p_venue_id uuid, p_dancer_id uuid default null,
  p_offset integer default 0, p_limit integer default 12
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_dancer_media_reviewer(p_actor_id,null,p_venue_id);
  with dancers as materialized (
    select distinct d.id,d.user_id,d.stage_name from public.dancer_profiles d
    join public.venue_media_dancers(p_venue_id) s on s.user_id=d.user_id
  ), pending as materialized (
    select r.id,d.id dancer_id,d.stage_name,r.created_at,'photo'::text kind,
      r.upload_context like 'profile_main%' is_main
    from public.image_moderation_records r join dancers d on d.user_id=r.user_id
    where r.decision='review' and r.upload_context like 'profile_%'
      and r.status='pending_review' and r.temporary_storage_path is not null
      and r.club_reviewed_at is null and r.category_flags->'file_checks_passed'='true'::jsonb
    union all
    select v.id,d.id,d.stage_name,v.created_at,'video',false
    from public.mydancr_tv_videos v join dancers d on d.id=v.dancer_id
    where v.status='submitted' and not v.upload_validation_pending
      and v.club_reviewed_at is null and v.moderation_details->'fileChecksPassed'='true'::jsonb
  ), grouped as (
    select dancer_id,stage_name,count(*) upload_count,min(created_at) oldest,
      count(*) filter(where kind='photo') photo_count,
      count(*) filter(where kind='video') video_count
    from pending group by dancer_id,stage_name
  ), dancer_page as (
    select * from grouped where p_dancer_id is null order by oldest,dancer_id
    limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset)
  ), covers as (
    select distinct on(p.dancer_id) p.* from pending p join dancer_page d using(dancer_id)
    order by p.dancer_id,p.is_main desc,p.kind,p.created_at,p.id
  ), media_page as (
    select * from pending where dancer_id=p_dancer_id
    order by is_main desc,created_at,id,kind
    limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset)
  ), requested as (
    select * from covers union all select * from media_page
  ), records as (
    select p.*,case when p.kind='photo' then to_jsonb(r) else to_jsonb(v) end record
    from requested p
    left join public.image_moderation_records r on p.kind='photo' and r.id=p.id
    left join public.mydancr_tv_videos v on p.kind='video' and v.id=p.id
  )
  select jsonb_build_object(
    'count',(select count(*) from pending),
    'dancerCount',(select count(*) from grouped),
    'uploadCount',(select count(*) from pending where dancer_id=p_dancer_id),
    'dancer',(select jsonb_build_object('id',id,'stageName',stage_name) from dancers where id=p_dancer_id),
    'dancers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.dancer_id,'stageName',d.stage_name,'count',d.upload_count,
      'photoCount',d.photo_count,'videoCount',d.video_count,'kind',r.kind,'record',r.record
    ) order by d.oldest,d.dancer_id) from dancer_page d join records r on r.dancer_id=d.dancer_id),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'kind',kind,'dancerId',dancer_id,'stageName',stage_name,'record',record
    ) order by is_main desc,created_at,id,kind) from records where p_dancer_id is not null),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.get_venue_dancer_media_grid(uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.get_venue_dancer_media_grid(uuid,uuid,uuid,integer,integer) to service_role;
comment on function public.get_venue_dancer_media_grid(uuid,uuid,uuid,integer,integer) is
  'Service-only, venue-authorized pending media grouped by dancer; selected dancer reads remain venue-scoped.';
commit;
