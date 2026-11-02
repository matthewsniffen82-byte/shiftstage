begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function public.dancer_media_editor_context(p_actor uuid,p_venue uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d public.dancer_profiles; active_venue uuid; target uuid; setup boolean; clubs jsonb;
begin
 perform private.media_batch_authorize(p_actor,'dancer',null);
 select * into d from public.dancer_profiles where user_id=p_actor;
 setup:=d.approved_at is null and d.status<>'approved';
 select s.venue_id into active_venue from public.shifts s where s.dancer_id=d.id and s.status='posted'
  and s.checked_in_at is not null and s.checked_out_at is null and s.location_status='club_confirmed'
  and s.location_verification_expires_at>now() order by s.checked_in_at desc limit 1;
 -- Explicit selection is a media destination, not a check-in change.
 target:=coalesce(p_venue,active_venue);
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'slug',to_jsonb(v)->>'slug') order by v.name),'[]') into clubs
 from public.venues v where v.is_active and exists(select 1 from public.venue_media_dancers(v.id) m where m.user_id=p_actor);
 if target is not null and not exists(select 1 from jsonb_array_elements(clubs) c where c->>'id'=target::text) then
  raise exception 'Choose one of your connected clubs.' using errcode='42501';end if;
 return jsonb_build_object('dancerId',d.id,'venueId',target,'onboarding',setup,'clubs',clubs);
end $$;

create or replace function public.get_media_batches(p_actor uuid,p_role text,p_venue uuid default null,p_dancer uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; own_dancer uuid; drafts integer:=0; draft_items jsonb:='[]'; processing integer:=0;
begin
 perform private.media_batch_authorize(p_actor,p_role,p_venue,p_dancer);
 if p_role='dancer' then
  select id into own_dancer from public.dancer_profiles where user_id=p_actor;
  select count(*),coalesce(jsonb_agg(item order by item->>'key'),'[]') into drafts,draft_items from private.media_batch_snapshot(own_dancer) where not submitted and not published
   and (p_venue is null or private.editor_media_origin(item->>'source',(item->>'id')::uuid) is null or private.editor_media_origin(item->>'source',(item->>'id')::uuid)=p_venue)
   and (p_venue is null or not private.editor_media_removed(own_dancer,p_venue,item->>'kind',(item->>'id')::uuid));
 select count(*) into processing from (
   select r.id from public.image_moderation_records r where r.user_id=p_actor and r.upload_context like 'profile_%'
    and r.status in ('pending','moderating','moderation_retry') and (p_venue is null or r.editor_venue_id is null or r.editor_venue_id=p_venue)
    and (p_venue is null or not private.editor_media_removed(own_dancer,p_venue,'photo',r.id,r.image_id))
   union all select v.id from public.mydancr_tv_videos v where v.dancer_id=own_dancer
    and (v.status in ('uploading','moderating') or v.upload_validation_pending) and v.status not in ('removed','hidden','expired','rejected')
    and (p_venue is null or v.editor_venue_id is null or v.editor_venue_id=p_venue)
    and (p_venue is null or not private.editor_media_removed(own_dancer,p_venue,'video',v.id))
  ) preparing;
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
 return jsonb_build_object('batches',result,'draftCount',drafts,'draftItems',draft_items,'processingCount',processing,'waitingForClub',p_role='dancer' and exists(
  select 1 from public.dancer_media_submissions s cross join lateral jsonb_array_elements(s.items) x where s.dancer_id=own_dancer
   and (p_venue is null or private.editor_media_origin(x->>'source',(x->>'id')::uuid) is null or private.editor_media_origin(x->>'source',(x->>'id')::uuid)=p_venue)
   and (p_venue is null or not private.editor_media_removed(own_dancer,p_venue,x->>'kind',(x->>'id')::uuid))
   and not exists(select 1 from public.dancer_media_batches b cross join lateral jsonb_array_elements(b.items) y
    where b.dancer_id=own_dancer and y->>'key'=x->>'key' and y->>'version'=x->>'version')));
end $$;

alter function public.dancer_club_media_statuses(uuid) rename to dancer_club_media_statuses_before_workspace;
alter function public.dancer_club_media_statuses_before_workspace(uuid) set schema private;
create function public.dancer_club_media_statuses(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with d as (select id from public.dancer_profiles where user_id=p_user_id),
 snapshot as materialized (select * from private.media_batch_snapshot((select id from d)))
 select coalesce(jsonb_agg(x||jsonb_build_object('submissionState',case
   when x->>'status'='rejected' then 'needs_changes'
   when x->>'status'='approved' and coalesce(s.published,false) then 'approved'
   when not coalesce(s.published,false) and not coalesce(s.submitted,false) then 'draft'
   else 'pending' end,
   'isMain',case when not coalesce(s.published,false) and x->>'source'='upload' then coalesce(r.editor_is_main,false)
     else coalesce((x->>'isMain')::boolean,false) end)), '[]')
 from jsonb_array_elements(private.dancer_club_media_statuses_before_workspace(p_user_id)) x
 left join snapshot s on s.item->>'id'=x->>'id' and s.item->>'kind'=x->>'kind'
 left join public.image_moderation_records r on x->>'source'='upload' and r.id=(x->>'id')::uuid
$$;
revoke all on function public.dancer_club_media_statuses(uuid),private.dancer_club_media_statuses_before_workspace(uuid) from public,anon,authenticated;
grant execute on function public.dancer_club_media_statuses(uuid),private.dancer_club_media_statuses_before_workspace(uuid) to service_role;
commit;
