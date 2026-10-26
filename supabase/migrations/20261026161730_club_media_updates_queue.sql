begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Initial profile/media review keeps using get_club_media_queue. Later uploads
-- are a separate queue for approved, currently affiliated dancers. Filter before
-- counting and paging so join requests never displace updates or inflate badges.
create function public.get_club_media_updates_queue(p_actor_id uuid,p_venue_id uuid,p_dancer_id uuid default null,
  p_offset integer default 0,p_limit integer default 12,p_status text default 'pending')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_dancer_media_reviewer(p_actor_id,null,p_venue_id);
  if p_status is null or p_status not in ('pending','all') then raise exception 'MEDIA_REVIEW_INVALID' using errcode='22023';end if;
  with dancers as materialized(select distinct d.id,d.stage_name from public.dancer_profiles d
    join public.venue_media_dancers(p_venue_id) s on s.user_id=d.user_id
    where exists(select 1 from public.club_dancer_approvals a
      where a.venue_id=p_venue_id and a.dancer_id=d.id and a.status='approved')
      and exists(select 1 from public.venue_dancer_affiliations a
        where a.venue_id=p_venue_id and a.dancer_id=d.id and a.status='active' and a.revoked_at is null)),
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

revoke all on function public.get_club_media_updates_queue(uuid,uuid,uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function public.get_club_media_updates_queue(uuid,uuid,uuid,integer,integer,text) to service_role;
notify pgrst, 'reload schema';
commit;
