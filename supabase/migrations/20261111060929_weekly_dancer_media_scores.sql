-- Only the server reads these inputs. Count publications, never pending uploads or avatars.
alter function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz)
  rename to get_venue_performance_before_media_scores;

create function public.get_venue_performance_analytics(p_venue_id uuid, p_since timestamptz, p_until timestamptz,
  p_tonight_since timestamptz, p_tonight_until timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with base as materialized (
    select public.get_venue_performance_before_media_scores(p_venue_id,p_since,p_until,p_tonight_since,p_tonight_until) report
  ), activity as materialized (
    select (item->>'id')::uuid id, item from base, jsonb_array_elements(report#>'{performance,dancers}') item
  ), cohort as (
    select id from activity union select dancer_id from public.venue_dancer_affiliations
    where venue_id=p_venue_id and status='active'
  ), recent_photos as materialized (
    select p.id,p.dancer_id from public.dancer_photos p join cohort c on c.id=p.dancer_id
    where p.review_status='approved' and p.retention_removed_at is null
      and p.created_at >= greatest(p_since,p_until - interval '168 hours') and p.created_at < p_until
  ), photos as (
    select p.dancer_id,count(distinct p.id) n from recent_photos p join
      jsonb_array_elements(public.club_approved_media(p_venue_id,array(select distinct dancer_id from recent_photos))) m
      on (m->>'photoId')::uuid=p.id and (m->>'dancerId')::uuid=p.dancer_id group by p.dancer_id
  ), videos as (
    select v.dancer_id,count(*) n from public.mydancr_tv_videos v join cohort c on c.id=v.dancer_id
    join public.dancer_profiles d on d.id=c.id
    where v.status='approved' and v.retention_removed_at is null and v.duration_seconds between 1 and 30
      and v.published_at >= greatest(p_since,p_until - interval '168 hours') and v.published_at < p_until
      and (v.expires_at is null or v.expires_at > p_until)
      and d.status='approved' and d.verification_status='approved' and d.is_public and d.disabled_at is null
    group by v.dancer_id
  ), enriched as (
    select d.id, coalesce(a.item,jsonb_build_object('id',d.id,'name',d.stage_name,'internal','{}'::jsonb,
      'external','{}'::jsonb,'vip','{}'::jsonb)) || jsonb_build_object('media',jsonb_build_object(
        'videos',coalesce(v.n,0),'photos',coalesce(p.n,0))) item
    from cohort c join public.dancer_profiles d on d.id=c.id left join activity a on a.id=c.id
    left join photos p on p.dancer_id=c.id left join videos v on v.dancer_id=c.id
    where a.id is not null or p.n>0 or v.n>0
  )
  select jsonb_set(report,'{performance,dancers}',coalesce(
    (select jsonb_agg(item order by item->>'name',id) from enriched),'[]'::jsonb)) from base;
$$;
revoke all on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_venue_performance_analytics(uuid,timestamptz,timestamptz,timestamptz,timestamptz)
  to service_role;
