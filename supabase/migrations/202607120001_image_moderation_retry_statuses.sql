-- Add durable retry state for automatic image moderation.

alter table public.image_moderation_records
  drop constraint if exists image_moderation_records_status_check;

alter table public.image_moderation_records
  add constraint image_moderation_records_status_check
  check (
    status in (
      'pending',
      'completed',
      'error',
      'moderating',
      'approved',
      'pending_review',
      'rejected',
      'moderation_retry',
      'moderation_error'
    )
  );

alter table public.image_moderation_records
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz null,
  add column if not exists locked_at timestamptz null,
  add column if not exists last_error_code text null,
  add column if not exists last_error_message text null,
  add column if not exists completed_at timestamptz null;

create index if not exists image_moderation_records_retry_due_idx
  on public.image_moderation_records(status, next_attempt_at)
  where status in ('moderation_retry', 'moderating');

