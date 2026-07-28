begin;

update public.mydancr_tv_videos
set
  status = 'hidden',
  venue_featured = false,
  review_notes = case
    when review_notes is null or length(trim(review_notes)) = 0
      then 'Hidden automatically because MyDancr TV videos are now limited to 10 seconds.'
    else review_notes
  end,
  updated_at = now()
where duration_seconds > 10
  and status not in ('hidden', 'expired');

alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_duration_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_duration_check
  check (duration_seconds between 1 and 10)
  not valid;

drop policy if exists "public reads approved MyDancr TV videos" on public.mydancr_tv_videos;
create policy "public reads approved MyDancr TV videos"
  on public.mydancr_tv_videos
  for select
  using (
    status = 'approved'
    and duration_seconds between 1 and 10
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

commit;
