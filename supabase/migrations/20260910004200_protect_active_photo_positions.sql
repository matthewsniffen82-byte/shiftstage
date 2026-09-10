-- Preserve rejected history and legacy non-primary position zero.
-- Do not repair duplicates by deleting or moving existing photos.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create unique index dancer_photos_one_active_primary_idx
  on public.dancer_photos(dancer_id)
  where is_primary and review_status in ('approved', 'pending');

create unique index dancer_photos_one_active_gallery_position_idx
  on public.dancer_photos(dancer_id, sort_order)
  where not is_primary and sort_order > 0 and review_status in ('approved', 'pending');

commit;
