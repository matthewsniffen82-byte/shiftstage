-- A deal's active flag must not publish a withdrawn or unpublished venue's offer.
-- Existing explicit owner/admin policies still provide management/history access.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter policy "Active club deals are public" on public.club_deals
using (
  is_active = true
  and exists (
    select 1 from public.venues venue
    where venue.id = club_deals.venue_id
      and venue.is_active = true
      and venue.published_at is not null
  )
);

commit;
