begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Both channels now use the shared main photo. Keep historical attribution intact.
create or replace function public.refresh_dancer_hair_color_periods(p_dancer_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_channel text; v_photo uuid; v_path text; v_analysis uuid; v_current uuid; v_current_analysis uuid; v_time timestamptz;
begin
  -- Photo writers already take this profile-before-photo lock. Serialize both channels.
  perform id from public.dancer_profiles where id=p_dancer_id for update;
  if not found then return; end if;
  v_time := clock_timestamp();
  foreach v_channel in array array['external','internal'] loop
    v_photo := null; v_path := null; v_analysis := null; v_current := null;
    select p.id,p.storage_path into v_photo,v_path
    from public.dancer_photos p
    where p.dancer_id=p_dancer_id and p.review_status='approved' and nullif(p.storage_path,'') is not null
      and (v_channel='internal' or p.is_primary)
    order by p.is_primary desc,p.sort_order,p.id limit 1;
    if v_photo is not null then
      insert into public.dancer_photo_hair_analysis(dancer_id,photo_id,storage_path)
        values(p_dancer_id,v_photo,v_path) on conflict(photo_id,storage_path) do nothing;
      select id into v_analysis from public.dancer_photo_hair_analysis where photo_id=v_photo and storage_path=v_path;
    end if;
    select id,analysis_id into v_current,v_current_analysis from public.dancer_hair_color_periods
      where dancer_id=p_dancer_id and channel=v_channel and ended_at is null for update;
    if v_current is not null and v_current_analysis is not distinct from v_analysis then continue; end if;
    update public.dancer_hair_color_periods set ended_at=v_time where id=v_current;
    insert into public.dancer_hair_color_periods(dancer_id,channel,analysis_id,started_at) values(p_dancer_id,v_channel,v_analysis,v_time);
  end loop;
end $$;
revoke all on function public.refresh_dancer_hair_color_periods(uuid) from public,anon,authenticated;
grant execute on function public.refresh_dancer_hair_color_periods(uuid) to service_role;


-- Start corrected internal periods now, without rewriting past events or deleting photos.
do $$
declare dancer record;
begin
  for dancer in select dancer_id from public.dancer_internal_main_photos order by dancer_id loop
    perform public.refresh_dancer_hair_color_periods(dancer.dancer_id);
  end loop;
end $$;

commit;
