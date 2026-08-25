begin;

-- A profile is a content library: allow up to fifty current profile videos
-- while retaining the per-dancer advisory lock that prevents concurrent
-- uploads from claiming the same final slot.
create or replace function public.enforce_mydancr_tv_profile_video_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_video_count integer;
begin
  if new.distribution_scope = 'feed_only' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.dancer_id::text, 0));

  select count(*)
    into current_video_count
    from public.mydancr_tv_videos
   where dancer_id = new.dancer_id
     and distribution_scope = 'profile_and_feed'
     and status in ('uploading', 'moderating', 'submitted', 'approved', 'rejected');

  if current_video_count >= 50 then
    raise exception using
      errcode = 'check_violation',
      message = 'You can upload up to 50 profile videos. Remove one before adding another.';
  end if;

  return new;
end;
$$;

commit;
