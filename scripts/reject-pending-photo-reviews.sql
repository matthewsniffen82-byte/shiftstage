-- Run once after deploying binary photo decisions. Safe to repeat.
-- Only completed, unpublished photo reviews change. Preserve provider evidence,
-- private source files and any existing approved avatar/main/gallery photos.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

with rejected as (
  update public.image_moderation_records
  set decision = 'rejected',
      status = 'rejected',
      reason_codes = coalesce(reason_codes, '[]'::jsonb) || '["photo_approval_not_confirmed"]'::jsonb,
      next_attempt_at = null,
      locked_at = null,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where decision = 'review'
    and status in ('pending_review', 'completed')
    and review_decision is null
    and image_id is null
    and final_storage_path is null
    and (upload_context in ('profile_avatar', 'profile_main', 'profile_gallery')
      or upload_context ~ '^profile_(main|gallery):[0-9]+$')
  returning id
)
select count(*) as photos_rejected from rejected;

commit;
