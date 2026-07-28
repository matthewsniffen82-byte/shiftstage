-- MyDancr TV: moderated dancer video submissions, venue controls, and privacy-safe analytics.

alter type public.notification_type add value if not exists 'tv_video_status';

create table if not exists public.mydancr_tv_videos (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  submitted_by uuid not null references public.app_users(id) on delete cascade,
  venue_id uuid references public.venues(id) on delete set null,
  shift_id uuid references public.shifts(id) on delete set null,
  caption text not null,
  storage_path text not null unique,
  storage_mime text not null,
  file_size_bytes bigint not null,
  duration_seconds numeric(7,2) not null,
  width integer not null,
  height integer not null,
  status text not null default 'uploading',
  venue_tag_status text not null default 'unlinked',
  venue_featured boolean not null default false,
  consent_confirmed boolean not null default false,
  rights_confirmed boolean not null default false,
  review_notes text,
  reviewed_by uuid references public.app_users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mydancr_tv_caption_check check (length(trim(caption)) between 1 and 500),
  constraint mydancr_tv_storage_mime_check check (storage_mime in ('video/mp4', 'video/webm')),
  constraint mydancr_tv_file_size_check check (file_size_bytes between 1 and 78643200),
  constraint mydancr_tv_duration_check check (duration_seconds between 1 and 90),
  constraint mydancr_tv_dimensions_check check (width between 240 and 4320 and height between width and 7680),
  constraint mydancr_tv_status_check check (
    status in ('uploading', 'submitted', 'approved', 'rejected', 'hidden', 'expired')
  ),
  constraint mydancr_tv_venue_tag_status_check check (
    venue_tag_status in ('unlinked', 'pending', 'confirmed', 'rejected')
  )
);

create index if not exists mydancr_tv_public_feed_idx
  on public.mydancr_tv_videos(status, published_at desc)
  where status = 'approved';
create index if not exists mydancr_tv_dancer_created_idx
  on public.mydancr_tv_videos(dancer_id, created_at desc);
create index if not exists mydancr_tv_venue_published_idx
  on public.mydancr_tv_videos(venue_id, published_at desc)
  where status = 'approved' and venue_tag_status = 'confirmed';
create index if not exists mydancr_tv_review_queue_idx
  on public.mydancr_tv_videos(status, submitted_at asc)
  where status = 'submitted';

create table if not exists public.mydancr_tv_events (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.mydancr_tv_videos(id) on delete cascade,
  viewer_id uuid references public.app_users(id) on delete set null,
  session_id text not null,
  event_type text not null,
  source text not null default 'tv_feed',
  occurred_on date not null default current_date,
  occurred_at timestamptz not null default now(),
  constraint mydancr_tv_event_session_check check (length(session_id) between 8 and 120),
  constraint mydancr_tv_event_type_check check (
    event_type in (
      'impression',
      'engaged_view',
      'completed',
      'profile_click',
      'venue_click',
      'shift_click',
      'follow',
      'going',
      'reminder',
      'share',
      'report'
    )
  ),
  constraint mydancr_tv_event_source_check check (
    source in ('tv_feed', 'home', 'dancer_profile', 'venue_page', 'shared_link')
  )
);

create unique index if not exists mydancr_tv_events_daily_unique_idx
  on public.mydancr_tv_events(video_id, event_type, session_id, occurred_on);
create index if not exists mydancr_tv_events_video_occurred_idx
  on public.mydancr_tv_events(video_id, occurred_at desc);

create or replace function public.validate_mydancr_tv_video_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_shift public.shifts%rowtype;
  link_changed boolean := false;
begin
  if new.shift_id is not null then
    select * into linked_shift from public.shifts where id = new.shift_id;
    if linked_shift.id is null or linked_shift.dancer_id <> new.dancer_id then
      raise exception 'The selected shift does not belong to this dancer.';
    end if;
    new.venue_id := linked_shift.venue_id;
    if tg_op = 'INSERT' then
      link_changed := true;
    else
      link_changed :=
        old.shift_id is distinct from new.shift_id
        or old.dancer_id is distinct from new.dancer_id
        or old.venue_id is distinct from new.venue_id;
    end if;
    if link_changed then
      new.venue_tag_status := case
        when linked_shift.location_status in ('location_confirmed', 'club_confirmed')
          then 'confirmed'
        else 'pending'
      end;
      new.venue_featured := false;
    end if;
  elsif new.venue_id is null then
    new.venue_tag_status := 'unlinked';
    new.venue_featured := false;
  elsif tg_op = 'INSERT' or old.venue_id is distinct from new.venue_id then
    new.venue_tag_status := 'pending';
    new.venue_featured := false;
  end if;

  if new.venue_tag_status <> 'confirmed' then
    new.venue_featured := false;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_mydancr_tv_video_links on public.mydancr_tv_videos;
create trigger validate_mydancr_tv_video_links
before insert or update of dancer_id, venue_id, shift_id, venue_tag_status, venue_featured
on public.mydancr_tv_videos
for each row execute function public.validate_mydancr_tv_video_links();

create or replace function public.record_mydancr_tv_review_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'submitted'
    and new.status in ('approved', 'rejected')
    and new.status is distinct from old.status
  then
    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    )
    values (
      new.submitted_by,
      'tv_video_status',
      'in_app',
      case
        when new.status = 'approved' then 'MyDancr TV video approved'
        else 'MyDancr TV video needs changes'
      end,
      case
        when new.status = 'approved' then 'Your video is live on MyDancr TV.'
        else coalesce(new.review_notes, 'Your video was not approved.')
      end,
      jsonb_build_object('videoId', new.id, 'status', new.status),
      coalesce(new.reviewed_at, now())
    );

    insert into public.admin_actions (
      admin_id,
      target_type,
      target_id,
      action,
      notes
    )
    values (
      new.reviewed_by,
      'mydancr_tv_video',
      new.id,
      new.status,
      new.review_notes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_mydancr_tv_review_decision on public.mydancr_tv_videos;
create trigger record_mydancr_tv_review_decision
after update of status on public.mydancr_tv_videos
for each row execute function public.record_mydancr_tv_review_decision();

alter table public.mydancr_tv_videos enable row level security;
alter table public.mydancr_tv_events enable row level security;

drop policy if exists "public reads approved MyDancr TV videos" on public.mydancr_tv_videos;
create policy "public reads approved MyDancr TV videos"
  on public.mydancr_tv_videos
  for select
  using (
    status = 'approved'
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

drop policy if exists "dancers read own MyDancr TV videos" on public.mydancr_tv_videos;
create policy "dancers read own MyDancr TV videos"
  on public.mydancr_tv_videos
  for select
  using (submitted_by = auth.uid() or public.is_admin());

-- Video mutations intentionally have no dancer RLS policy. Dancer changes pass
-- through the authenticated server API so moderation state cannot be forged.
drop policy if exists "dancers create own MyDancr TV videos" on public.mydancr_tv_videos;
drop policy if exists "dancers update own unpublished MyDancr TV videos" on public.mydancr_tv_videos;

drop policy if exists "venue owners read tagged MyDancr TV videos" on public.mydancr_tv_videos;
create policy "venue owners read tagged MyDancr TV videos"
  on public.mydancr_tv_videos
  for select
  using (
    exists (
      select 1
      from public.venues venue
      where venue.id = venue_id
        and venue.owner_user_id = auth.uid()
    )
  );

drop policy if exists "admins manage MyDancr TV videos" on public.mydancr_tv_videos;
create policy "admins manage MyDancr TV videos"
  on public.mydancr_tv_videos
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "dancers read own MyDancr TV analytics" on public.mydancr_tv_events;
create policy "dancers read own MyDancr TV analytics"
  on public.mydancr_tv_events
  for select
  using (
    exists (
      select 1
      from public.mydancr_tv_videos video
      join public.dancer_profiles dancer on dancer.id = video.dancer_id
      where video.id = video_id
        and dancer.user_id = auth.uid()
    )
    or public.is_admin()
  );

drop policy if exists "venue owners read MyDancr TV analytics" on public.mydancr_tv_events;
create policy "venue owners read MyDancr TV analytics"
  on public.mydancr_tv_events
  for select
  using (
    exists (
      select 1
      from public.mydancr_tv_videos video
      join public.venues venue on venue.id = video.venue_id
      where video.id = video_id
        and venue.owner_user_id = auth.uid()
    )
    or public.is_admin()
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mydancr-tv-videos',
  'mydancr-tv-videos',
  false,
  78643200,
  array['video/mp4', 'video/webm']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "dancers read own MyDancr TV files" on storage.objects;
create policy "dancers read own MyDancr TV files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'mydancr-tv-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "dancers upload own MyDancr TV files" on storage.objects;
create policy "dancers upload own MyDancr TV files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'mydancr-tv-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "dancers delete own MyDancr TV files" on storage.objects;
create policy "dancers delete own MyDancr TV files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'mydancr-tv-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "admins manage MyDancr TV files" on storage.objects;
create policy "admins manage MyDancr TV files"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'mydancr-tv-videos' and public.is_admin())
  with check (bucket_id = 'mydancr-tv-videos' and public.is_admin());
