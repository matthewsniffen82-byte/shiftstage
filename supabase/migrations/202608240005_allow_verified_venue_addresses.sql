-- MyDancr-managed venue pages may use a verified public venue address.
-- Existing fictional demo addresses remain unchanged until an administrator
-- intentionally replaces them while preparing a venue's private page.

begin;

drop trigger if exists venues_enforce_mydancr_placeholder_address on public.venues;
drop function if exists public.enforce_mydancr_placeholder_venue_address();

comment on column public.venues.address is
  'Public venue address maintained by MyDancr and confirmed through the managed venue-page approval workflow.';

commit;
