-- Keep every live customer offer simple and immediately understandable.
-- Historical inactive deals remain unchanged for reporting and redemption audit.

begin;

update public.club_deals
set
  deal_title = case
    when concat_ws(' ', deal_title, deal_description) ~* '(priority|skip[ -]?the[ -]?line|guest[ -]?list)'
      then 'Skip the line'
    else 'Half-off admission'
  end,
  deal_description = case
    when concat_ws(' ', deal_title, deal_description) ~* '(priority|skip[ -]?the[ -]?line|guest[ -]?list)'
      then 'Use the venue''s designated priority admission line after cashier confirmation.'
    else 'Receive 50% off the venue''s standard general-admission cover charge after cashier confirmation.'
  end,
  deal_terms = case
    when concat_ws(' ', deal_title, deal_description) ~* '(priority|skip[ -]?the[ -]?line|guest[ -]?list)'
      then 'One redemption per guest. Priority access does not guarantee immediate admission and remains subject to venue capacity, age requirements, dress code, and house rules.'
    else 'One redemption per guest. Discount applies to the standard general-admission cover only. Subject to venue capacity, age requirements, dress code, and house rules.'
  end,
  offer_type = 'admission',
  booking_url = null,
  updated_at = now()
where is_active = true;

alter table public.club_deals
  drop constraint if exists club_deals_active_supported_offer_check;

alter table public.club_deals
  add constraint club_deals_active_supported_offer_check check (
    not is_active
    or (
      deal_title in ('Half-off admission', 'Skip the line')
      and offer_type = 'admission'
      and booking_url is null
    )
  );

comment on constraint club_deals_active_supported_offer_check on public.club_deals is
  'Live Club Deals are limited to Half-off admission or Skip the line.';

commit;
