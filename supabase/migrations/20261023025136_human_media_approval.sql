begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.image_moderation_records
  add column club_reviewed_by uuid references public.app_users(id),
  add column club_reviewed_at timestamptz,
  add column club_review_venue_id uuid references public.venues(id),
  add column club_review_notes text;
alter table public.mydancr_tv_videos
  add column club_reviewed_by uuid references public.app_users(id),
  add column club_reviewed_at timestamptz,
  add column club_review_venue_id uuid references public.venues(id),
  add column club_review_notes text;

-- This is a separate stage: the club never writes a publication decision.
create or replace function public.review_club_dancer_media(
  p_actor_id uuid,p_venue_id uuid,p_kind text,p_id uuid,p_expected_updated_at timestamptz,p_notes text default ''
) returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare v_owner uuid; r public.image_moderation_records%rowtype; v public.mydancr_tv_videos%rowtype;
begin
  if p_venue_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or length(coalesce(p_notes,''))>4000 then raise exception 'MEDIA_REVIEW_INVALID' using errcode='22023';end if;
  if p_kind='photo' then select user_id into v_owner from public.image_moderation_records where id=p_id and upload_context like 'profile_%';
  elsif p_kind='video' then select submitted_by into v_owner from public.mydancr_tv_videos where id=p_id;
  else raise exception 'MEDIA_REVIEW_INVALID' using errcode='22023';end if;
  if v_owner is null then raise exception 'MEDIA_REVIEW_MISSING' using errcode='P0002';end if;
  -- Same lock order as final photo publication.
  perform 1 from public.dancer_profiles where user_id=v_owner for update;
  perform public.assert_dancer_media_reviewer(p_actor_id,v_owner,p_venue_id);
  if p_kind='photo' then
    select * into r from public.image_moderation_records where id=p_id for update;
    if r.updated_at is distinct from p_expected_updated_at or r.decision<>'review' or r.status<>'pending_review'
      or r.category_flags->'file_checks_passed' is distinct from 'true'::jsonb or r.club_reviewed_at is not null then
      raise exception 'MEDIA_REVIEW_CHANGED' using errcode='40001';end if;
    update public.image_moderation_records set club_reviewed_by=p_actor_id,club_reviewed_at=clock_timestamp(),
      club_review_venue_id=p_venue_id,club_review_notes=nullif(btrim(p_notes),''),updated_at=clock_timestamp()
      where id=p_id returning * into r;
    return to_jsonb(r);
  end if;
  select * into v from public.mydancr_tv_videos where id=p_id for update;
  if v.updated_at is distinct from p_expected_updated_at or v.status<>'submitted' or v.upload_validation_pending
    or v.moderation_details->'fileChecksPassed' is distinct from 'true'::jsonb or v.club_reviewed_at is not null then
    raise exception 'MEDIA_REVIEW_CHANGED' using errcode='40001';end if;
  update public.mydancr_tv_videos set club_reviewed_by=p_actor_id,club_reviewed_at=clock_timestamp(),
    club_review_venue_id=p_venue_id,club_review_notes=nullif(btrim(p_notes),''),updated_at=clock_timestamp()
    where id=p_id returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.guard_dancer_media_decision()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_owner uuid; v_ready boolean; v_publishing boolean; v_source_changed boolean;
begin
  if tg_table_name='image_moderation_records' then
    if new.upload_context not like 'profile_%' then return new;end if;
    if tg_op='INSERT' then
      if new.decision='approved' or new.club_reviewed_at is not null or new.club_reviewed_by is not null then
        raise exception 'MEDIA_HUMAN_REVIEW_REQUIRED' using errcode='42501';end if;
      return new;
    end if;
    v_owner:=new.user_id;
    v_ready:=old.decision='review' and old.status='pending_review'
      and old.category_flags->'file_checks_passed'='true'::jsonb;
    v_publishing:=new.decision='approved' and old.decision is distinct from 'approved';
    v_source_changed:=new.user_id is distinct from old.user_id or new.temporary_storage_path is distinct from old.temporary_storage_path
      or (new.upload_context is distinct from old.upload_context and not v_publishing)
      or new.replacement_photo_id is distinct from old.replacement_photo_id;
  else
    if tg_op='INSERT' then
      if new.status='approved' or new.club_reviewed_at is not null or new.club_reviewed_by is not null then
        raise exception 'MEDIA_HUMAN_REVIEW_REQUIRED' using errcode='42501';end if;
      return new;
    end if;
    v_owner:=new.submitted_by;
    v_ready:=old.status='submitted' and not old.upload_validation_pending
      and old.moderation_details->'fileChecksPassed'='true'::jsonb;
    v_publishing:=new.status='approved' and old.status is distinct from 'approved';
    v_source_changed:=new.submitted_by is distinct from old.submitted_by or new.storage_path is distinct from old.storage_path
      or new.storage_mime is distinct from old.storage_mime or new.caption is distinct from old.caption
      or new.width is distinct from old.width or new.height is distinct from old.height
      or new.duration_seconds is distinct from old.duration_seconds;
  end if;
  if v_source_changed and old.club_reviewed_at is not null then
    if v_publishing then raise exception 'MEDIA_REVIEW_CHANGED' using errcode='40001';end if;
    new.club_reviewed_by:=null;new.club_reviewed_at:=null;new.club_review_venue_id:=null;new.club_review_notes:=null;
  elsif (new.club_reviewed_by,new.club_reviewed_at,new.club_review_venue_id,new.club_review_notes)
    is distinct from (old.club_reviewed_by,old.club_reviewed_at,old.club_review_venue_id,old.club_review_notes) then
    if current_user not in ('service_role','postgres') or v_ready is not true or old.club_reviewed_at is not null
      or new.club_reviewed_by is null or new.club_reviewed_at is null or new.club_review_venue_id is null then
      raise exception 'MEDIA_REVIEW_CHANGED' using errcode='40001';end if;
    perform public.assert_dancer_media_reviewer(new.club_reviewed_by,v_owner,new.club_review_venue_id);
  end if;
  if v_publishing then
    if v_ready is not true or old.club_reviewed_at is null or old.club_reviewed_by is null or old.club_review_venue_id is null
      or v_source_changed then raise exception 'MEDIA_HUMAN_REVIEW_REQUIRED' using errcode='40001';end if;
    perform 1 from public.app_users where id=new.reviewed_by and role='admin' and account_state='active' for share;
    if not found then raise exception 'MEDIA_FINAL_REVIEW_FORBIDDEN' using errcode='42501';end if;
    -- Final reviewer and club reviewer remain separately recorded.
    if new.reviewed_at is null then raise exception 'MEDIA_HUMAN_REVIEW_REQUIRED' using errcode='40001';end if;
  elsif new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by then
    perform public.assert_dancer_media_reviewer(new.reviewed_by,v_owner);
    if old.club_reviewed_at is not null and not exists(select 1 from public.app_users where id=new.reviewed_by and role='admin' and account_state='active') then
      raise exception 'MEDIA_FINAL_REVIEW_FORBIDDEN' using errcode='42501';end if;
  end if;
  return new;
end $$;
create trigger dancer_photo_human_review_insert before insert on public.image_moderation_records for each row execute function public.guard_dancer_media_decision();
create trigger dancer_video_human_review_insert before insert on public.mydancr_tv_videos for each row execute function public.guard_dancer_media_decision();

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
        and r.status='pending_review' and r.temporary_storage_path is not null and r.club_reviewed_at is null
        and r.category_flags->'file_checks_passed'='true'::jsonb
    union all
    select v.id,v.created_at,'video',d.stage_name,to_jsonb(v) from public.mydancr_tv_videos v
      join dancers d on d.id=v.dancer_id where v.status='submitted' and not v.upload_validation_pending
        and v.club_reviewed_at is null and v.moderation_details->'fileChecksPassed'='true'::jsonb
  ), page as (select * from pending order by created_at,id limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset))
  select jsonb_build_object('count',(select count(*) from pending),'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'kind',kind,'stageName',stage_name,'record',record) order by created_at,id) from page),'[]'::jsonb)) into result;
  return result;
end $$;

-- Existing normalized private photos are ready for human review, regardless of
-- the old AI recommendation. Do not revive rejected or already published media.
update public.image_moderation_records set category_flags=category_flags||'{"file_checks_passed":true}'::jsonb,
  reason_codes='["human_review_required"]',provider='human',provider_model='human-review-v1',updated_at=clock_timestamp()
  where upload_context like 'profile_%' and decision='review' and status='pending_review' and temporary_storage_path is not null;
-- Recover old failed/in-flight jobs through file preparation only in the new app.
update public.image_moderation_records set status='moderation_retry',attempt_count=0,next_attempt_at=now(),locked_at=null,
  updated_at=clock_timestamp(),provider='human',provider_model='human-review-v1'
  where upload_context like 'profile_%' and decision='review' and status in ('pending','moderating','moderation_retry','moderation_error','error')
    and temporary_storage_path is not null;
update public.mydancr_tv_videos set status='moderating',moderation_attempt_count=0,moderation_started_at=now()-interval '1 hour',
  moderation_completed_at=null,moderation_details='{}',moderation_decision=null,updated_at=clock_timestamp()
  where status in ('moderating','submitted') and club_reviewed_at is null;

revoke all on function public.review_club_dancer_media(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.review_club_dancer_media(uuid,uuid,text,uuid,timestamptz,text) to service_role;
comment on function public.review_club_dancer_media(uuid,uuid,text,uuid,timestamptz,text) is 'Service-only club signoff; never publishes media. Final approval requires an active MyDancr admin.';
commit;
