begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Keep the decision available for feedback, while removing the media from the
-- rejecting club's inventory. Other clubs retain their own decisions.
do $$
declare
  definition text;
  signature regprocedure;
  original text;
begin
  signature := 'public.dancer_club_media_statuses(uuid)'::regprocedure;
  definition := pg_get_functiondef(signature);
  original := $s$jsonb_build_object('submissionState',case$s$;
  if strpos(definition, original) = 0 then raise exception 'Unexpected media status definition'; end if;
  execute replace(definition, original, $s$jsonb_build_object(
    'hidden', coalesce((x->>'hidden')::boolean,false) or x->>'status' = 'rejected',
    'submissionState',case$s$);

  foreach signature in array array[
    'public.get_club_media_queue(uuid,uuid,uuid,integer,integer,text)'::regprocedure,
    'public.get_club_media_updates_queue(uuid,uuid,uuid,integer,integer,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    original := $s$where p_status='all' or club_status='pending'$s$;
    if strpos(definition, original) = 0 then raise exception 'Unexpected queue definition for %', signature; end if;
    execute replace(definition, original, $s$where club_status <> 'rejected' and (p_status='all' or club_status='pending')$s$);
  end loop;
end $$;

-- The reviewer's final rejection frees the slot in the same transaction.
create or replace function public.enforce_mydancr_tv_profile_video_limit()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.distribution_scope <> 'profile_and_feed'
    or new.status not in ('uploading','moderating','submitted','approved','rejected')
    or (new.status = 'rejected' and new.reviewed_at is not null) then return new; end if;
  if tg_op = 'UPDATE' and old.dancer_id = new.dancer_id and old.distribution_scope = 'profile_and_feed'
    and old.status in ('uploading','moderating','submitted','approved','rejected')
    and (old.status <> 'rejected' or old.reviewed_at is null) then return new; end if;
  if current_setting('transaction_isolation') = 'repeatable read' then
    raise exception using errcode = '25000', message = 'Profile video reservations require Read Committed or Serializable isolation.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:profile-video-slots:' || new.dancer_id::text, 0));
  if (select count(*) from public.mydancr_tv_videos where dancer_id = new.dancer_id
    and distribution_scope = 'profile_and_feed' and status in ('uploading','moderating','submitted','approved','rejected')
    and (status <> 'rejected' or reviewed_at is null)) > 50 then
    raise exception using errcode = '23514', message = 'You can upload up to 50 profile videos. Remove one before adding another.';
  end if;
  return new;
end $$;

create or replace trigger enforce_mydancr_tv_profile_video_limit
  after insert or update of dancer_id, distribution_scope, status, reviewed_at on public.mydancr_tv_videos
  for each row execute function public.enforce_mydancr_tv_profile_video_limit();

-- Review headers can show an unpublished main photo. Check the club's final
-- decision for that exact version before signing the photo or its avatar.
create function public.club_rejected_review_photos(p_venue uuid, p_dancers uuid[])
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('media_id', m.id, 'photo_id', m.photo_id,
    'storage_path', m.record->>'final_storage_path')), '[]'::jsonb)
  from public.dancer_club_media(p_dancers) m
  join public.club_media_permissions c on c.venue_id = p_venue and c.source = m.source
    and c.media_id = m.id and c.content_version = m.content_version
  where m.kind = 'photo' and c.decision = 'rejected'
$$;
revoke all on function public.club_rejected_review_photos(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.club_rejected_review_photos(uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
