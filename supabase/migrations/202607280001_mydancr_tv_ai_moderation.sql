-- Durable automated moderation for MyDancr TV video uploads.

alter table public.mydancr_tv_videos
  add column if not exists moderation_decision text,
  add column if not exists moderation_reason_codes text[] not null default '{}'::text[],
  add column if not exists moderation_category_scores jsonb not null default '{}'::jsonb,
  add column if not exists moderation_provider_flagged boolean not null default false,
  add column if not exists moderation_frame_count integer not null default 0,
  add column if not exists moderation_model text,
  add column if not exists moderation_details jsonb not null default '{}'::jsonb,
  add column if not exists moderation_attempt_count integer not null default 0,
  add column if not exists moderation_started_at timestamptz,
  add column if not exists moderation_completed_at timestamptz;

alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_status_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_status_check check (
    status in ('uploading', 'moderating', 'submitted', 'approved', 'rejected', 'hidden', 'expired')
  );

alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_moderation_decision_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_moderation_decision_check check (
    moderation_decision is null or moderation_decision in ('approved', 'review', 'rejected')
  );

alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_moderation_frame_count_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_moderation_frame_count_check check (
    moderation_frame_count between 0 and 10
  );

alter table public.mydancr_tv_videos
  drop constraint if exists mydancr_tv_moderation_attempt_count_check;

alter table public.mydancr_tv_videos
  add constraint mydancr_tv_moderation_attempt_count_check check (
    moderation_attempt_count between 0 and 10
  );

create index if not exists mydancr_tv_stale_moderation_idx
  on public.mydancr_tv_videos(moderation_started_at asc)
  where status = 'moderating';

create or replace function public.record_mydancr_tv_review_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('submitted', 'moderating')
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
      jsonb_build_object(
        'videoId', new.id,
        'status', new.status,
        'moderationDecision', new.moderation_decision
      ),
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
      case
        when new.reviewed_by is null then 'ai_' || new.status
        else new.status
      end,
      coalesce(
        new.review_notes,
        array_to_string(new.moderation_reason_codes, ', ')
      )
    );
  end if;
  return new;
end;
$$;
