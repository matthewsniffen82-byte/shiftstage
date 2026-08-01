-- Keep each dancer profile to five current videos, including concurrent uploads.
create or replace function public.enforce_mydancr_tv_profile_video_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_video_count integer;
begin
  -- Serialize inserts for one dancer so two upload requests cannot both claim
  -- the final slot at the same time.
  perform pg_advisory_xact_lock(hashtextextended(new.dancer_id::text, 0));

  select count(*)
    into current_video_count
    from public.mydancr_tv_videos
   where dancer_id = new.dancer_id
     and status in ('uploading', 'moderating', 'submitted', 'approved', 'rejected');

  if current_video_count >= 5 then
    raise exception using
      errcode = 'check_violation',
      message = 'You can upload up to 5 profile videos. Remove one before adding another.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_mydancr_tv_profile_video_limit on public.mydancr_tv_videos;
create trigger enforce_mydancr_tv_profile_video_limit
before insert on public.mydancr_tv_videos
for each row execute function public.enforce_mydancr_tv_profile_video_limit();
