-- Group the complete filtered queue before paging, including non-profile uploads.
create or replace function public.get_admin_media_dancers(
  p_actor uuid, p_stage text default 'staff', p_kind text default 'all',
  p_venue_id uuid default null, p_search text default '', p_hours integer default 0,
  p_offset integer default 0, p_counts_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  perform public.assert_admin_workspace_access(p_actor,'reviewer');
  if p_stage not in ('staff','club','processing','history') or p_kind not in ('all','photo','video')
    or p_offset < 0 or p_offset > 100000 or p_hours < 0 or p_hours > 8760 then
    raise exception 'Invalid media filters.' using errcode='22023';
  end if;
  with scoped as materialized (
    select m.*,
      case when dancer_id is not null then 'dancer:'||dancer_id
        when user_id is not null then 'user:'||user_id else 'upload:'||id end review_group
    from public.admin_media_workspace m where p_venue_id is null or venue_id=p_venue_id
  ), filtered as materialized (
    select * from scoped where stage=p_stage and (p_kind='all' or kind=p_kind)
      and (p_search='' or dancer_name ilike '%'||p_search||'%' or venue_name ilike '%'||p_search||'%')
      and (p_hours=0 or created_at<=now()-make_interval(hours=>p_hours))
  ), grouped as (
    select review_group, min(dancer_name) dancer_name, min(created_at) oldest,
      count(*) count, count(*) filter(where kind='photo') photo_count,
      count(*) filter(where kind='video') video_count
    from filtered group by review_group
  ), page as (
    select * from grouped where not p_counts_only order by oldest,review_group limit 12 offset p_offset
  )
  select jsonb_build_object(
    'dancerCount',(select count(*) from grouped), 'total',(select count(*) from filtered),
    'counts',jsonb_build_object('staff',(select count(*) from scoped where stage='staff'),
      'club',(select count(*) from scoped where stage='club'),'processing',(select count(*) from scoped where stage='processing')),
    'dancers',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('preview',(
      select to_jsonb(f) from filtered f where f.review_group=p.review_group
      order by (f.upload_context='profile_main') desc nulls last,(f.kind='photo') desc,f.created_at,f.queue_key limit 1
    )) order by p.oldest,p.review_group) from page p),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.get_admin_media_dancers(uuid,text,text,uuid,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.get_admin_media_dancers(uuid,text,text,uuid,text,integer,integer,boolean) to service_role;
