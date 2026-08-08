-- Allow each venue to publish a prioritized collection of real Club Deals.
-- Bottle-service offers must point to the venue's own live reservation flow;
-- MyDancr still issues the attributed QR pass before the customer continues.

alter table public.club_deals
  add column if not exists offer_type text not null default 'admission'
    check (offer_type in ('admission', 'drink', 'bottle_service', 'other')),
  add column if not exists booking_url text,
  add column if not exists sort_order integer not null default 0
    check (sort_order between 0 and 1000);

alter table public.club_deals
  drop constraint if exists club_deals_booking_url_check;

alter table public.club_deals
  add constraint club_deals_booking_url_check check (
    booking_url is null
    or booking_url ~* '^https://[^[:space:]]+$'
  );

create index if not exists club_deals_public_offer_order_idx
  on public.club_deals(venue_id, is_active, sort_order, created_at desc);

comment on column public.club_deals.offer_type is
  'Customer-facing fulfillment category used by the multi-offer Club Deals hub.';
comment on column public.club_deals.booking_url is
  'Venue-controlled HTTPS reservation destination. Required by the application before publishing bottle service.';
comment on column public.club_deals.sort_order is
  'Lower values appear first in the public Club Deals hub.';
