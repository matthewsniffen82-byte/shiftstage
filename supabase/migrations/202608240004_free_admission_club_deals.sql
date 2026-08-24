-- Add the negotiated Free admission offer without weakening the admission-only,
-- liquor-free Club Deal boundary. MyDancr remains the only publisher.

begin;

alter table public.club_deals
  drop constraint if exists club_deals_active_supported_offer_check;

alter table public.club_deals
  add constraint club_deals_active_supported_offer_check check (
    not is_active
    or (
      deal_title in ('Half-off admission', 'Skip the line', 'Free admission')
      and offer_type = 'admission'
      and booking_url is null
    )
  );

comment on constraint club_deals_active_supported_offer_check on public.club_deals is
  'Live Club Deals are limited to the MyDancr-approved admission offer catalog.';

alter table public.venue_club_deal_requests
  drop constraint if exists venue_club_deal_requests_offer_key_check,
  drop constraint if exists venue_club_deal_requests_offer_title_check;

alter table public.venue_club_deal_requests
  add constraint venue_club_deal_requests_offer_key_check
    check (offer_key in ('half_off_admission', 'skip_the_line', 'free_admission')),
  add constraint venue_club_deal_requests_offer_title_check
    check (offer_title in ('Half-off admission', 'Skip the line', 'Free admission'));

commit;
