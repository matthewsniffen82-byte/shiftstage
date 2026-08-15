begin;

alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_duration_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_duration_check
  check (duration_seconds between 1 and 30)
  not valid;

-- Restore videos that the immediately preceding 10-second policy hid, but only
-- when automated or human moderation had already approved them. Videos that
-- were rejected, expired, or hidden for another reason remain unavailable.
update public.mydancr_tv_videos
set
  status = 'approved',
  published_at = coalesce(reviewed_at, now()),
  review_notes = case
    when review_notes = 'Hidden automatically because MyDancr TV videos are limited to 10 seconds.'
      then 'Restored automatically after MyDancr TV increased its limit to 30 seconds.'
    else review_notes
  end,
  updated_at = now()
where status = 'hidden'
  and moderation_decision = 'approved'
  and published_at is null
  and expires_at is null
  and duration_seconds > 10
  and duration_seconds <= 30;

drop policy if exists "public reads approved MyDancr TV videos" on public.mydancr_tv_videos;
create policy "public reads approved MyDancr TV videos" on public.mydancr_tv_videos for select using (
  status = 'approved'
  and duration_seconds between 1 and 30
  and published_at is not null
  and published_at <= now()
  and (expires_at is null or expires_at > now())
  and exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_id
      and dancer.status = 'approved'
      and dancer.verification_status = 'approved'
      and dancer.photo_review_status = 'approved'
      and dancer.approved_at is not null
      and dancer.disabled_at is null
      and dancer.is_public = true
  )
);

notify pgrst, 'reload schema';
commit;
