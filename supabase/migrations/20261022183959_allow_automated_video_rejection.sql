-- Automatic rejection must settle without impersonating a club reviewer.
-- Publication and all human decisions retain the existing reviewer checks.
begin;
create or replace function public.guard_dancer_media_decision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='image_moderation_records' then
    if new.upload_context not like 'profile_%' then return new;end if;
    if new.decision='approved' and old.decision is distinct from 'approved' then
      if old.status in('pending','moderating','moderation_retry') then raise exception 'MEDIA_AI_STILL_RUNNING' using errcode='40001';end if;
      perform public.assert_dancer_media_reviewer(new.reviewed_by,new.user_id);
    elsif new.review_decision='rejected' and new.reviewed_by is not null and old.review_decision is distinct from 'rejected' then
      perform public.assert_dancer_media_reviewer(new.reviewed_by,new.user_id);
    end if;
  elsif old.status in('uploading','moderating','submitted') and new.status in('approved','rejected') and old.status is distinct from new.status then
    if new.status='approved' and (old.status<>'submitted' or old.upload_validation_pending) then
      raise exception 'MEDIA_AI_STILL_RUNNING' using errcode='40001';
    end if;
    if current_user='service_role' and old.status='moderating' and new.status='rejected'
      and old.reviewed_by is null and new.reviewed_by is null and new.reviewed_at is null
      and new.moderation_decision='rejected' and new.moderation_completed_at is not null
      and cardinality(new.moderation_reason_codes)>0
      and old.moderation_details->>'workerId' is not null
      and new.published_at is null and new.expires_at is null and not new.venue_featured
    then
      return new;
    end if;
    perform public.assert_dancer_media_reviewer(new.reviewed_by,new.submitted_by);
  end if;
  return new;
end $$;
revoke all on function public.guard_dancer_media_decision() from public,anon,authenticated;
grant execute on function public.guard_dancer_media_decision() to service_role;

-- The club queue contains only completed, successful automatic checks.
create or replace function public.get_venue_dancer_media_review(p_actor_id uuid,p_venue_id uuid,p_offset integer default 0,p_limit integer default 12)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_dancer_media_reviewer(p_actor_id,null,p_venue_id);
  with dancers as materialized (select d.id,d.user_id,d.stage_name from public.dancer_profiles d
    join public.venue_media_dancers(p_venue_id) s on s.user_id=d.user_id),
  pending as (
    select r.id,r.created_at,'photo'::text kind,d.stage_name,to_jsonb(r) record from public.image_moderation_records r
      join dancers d on d.user_id=r.user_id where r.decision='review' and r.upload_context like 'profile_%'
        and r.status='pending_review' and r.temporary_storage_path is not null
        and r.category_flags->'ai_recommended_approval'='true'::jsonb
        and r.category_flags->'ai_recommended_rejection' is distinct from 'true'::jsonb
    union all
    select v.id,v.created_at,'video',d.stage_name,to_jsonb(v) from public.mydancr_tv_videos v
      join dancers d on d.id=v.dancer_id where v.status='submitted'
        and v.moderation_decision='approved' and not v.upload_validation_pending
  ), page as (select * from pending order by created_at,id limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset))
  select jsonb_build_object('count',(select count(*) from pending),'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'kind',kind,'stageName',stage_name,'record',record) order by created_at,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.get_venue_dancer_media_review(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.get_venue_dancer_media_review(uuid,uuid,integer,integer) to service_role;
commit;
