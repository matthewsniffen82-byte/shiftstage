-- Store the approved dancer avatar separately from profile-card and gallery media.
-- Replacements are moderated in image_moderation_records before this live path changes.

alter table public.dancer_profiles
  add column if not exists avatar_storage_path text null,
  add column if not exists avatar_updated_at timestamptz null;

comment on column public.dancer_profiles.avatar_storage_path is
  'Approved face avatar used by circular dancer identity surfaces. Stored in dancer-photos.';

comment on column public.dancer_profiles.avatar_updated_at is
  'Timestamp of the most recent approved avatar replacement or removal.';
