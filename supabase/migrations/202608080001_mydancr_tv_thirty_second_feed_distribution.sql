begin;

alter table public.mydancr_tv_videos
  add column if not exists distribution_scope text not null default 'profile_and_feed';

alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_distribution_scope_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_distribution_scope_check
  check (distribution_scope in ('profile_and_feed', 'feed_only'));

alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_duration_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_duration_check
  check (duration_seconds between 1 and 30)
  not valid;

alter table public.mydancr_tv_videos
  validate constraint mydancr_tv_duration_check;

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

  if current_video_count >= 5 then
    raise exception using
      errcode = 'check_violation',
      message = 'You can upload up to 5 profile videos. Remove one before adding another.';
  end if;

  return new;
end;
$$;

drop policy if exists "public reads approved MyDancr TV videos" on public.mydancr_tv_videos;
create policy "public reads approved MyDancr TV videos"
  on public.mydancr_tv_videos
  for select
  using (
    status = 'approved'
    and duration_seconds between 1 and 30
    and published_at is not null
    and published_at <= now()
    and (expires_at is null or expires_at > now())
    and exists (
      select 1
      from public.dancer_profiles dancer
      where dancer.id = dancer_id
        and dancer.status = 'approved'
        and dancer.verification_status = 'approved'
        and dancer.photo_review_status = 'approved'
        and dancer.approved_at is not null
        and dancer.disabled_at is null
        and dancer.is_public = true
    )
  );

create index if not exists mydancr_tv_profile_distribution_idx
  on public.mydancr_tv_videos(dancer_id, created_at desc)
  where distribution_scope = 'profile_and_feed';

commit;
