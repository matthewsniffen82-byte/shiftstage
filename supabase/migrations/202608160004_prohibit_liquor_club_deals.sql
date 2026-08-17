-- MyDancr Club Deals are referral offers for admission and other non-alcohol
-- benefits. Liquor promotions are prohibited at every write boundary.

begin;

create or replace function public.club_deal_is_liquor_related(
  p_offer_type text,
  p_deal_title text,
  p_deal_description text,
  p_deal_terms text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    lower(coalesce(p_offer_type, '')) in ('drink', 'bottle_service')
    or concat_ws(' ', p_deal_title, p_deal_description, p_deal_terms) ~*
      '(^|[^[:alnum:]_])(alcohol(ic)?|liquor|beer|wine|champagne|cocktails?|vodka|tequila|whisk(e)?y|bourbon|scotch|rum|gin|cognac|brandy|mezcal|lager|ale|hard[[:space:]]+seltzer|sake|bottle[[:space:]]+service|bar[[:space:]]+(tab|credit)|happy[[:space:]]+hour)([^[:alnum:]_]|$)'
    or concat_ws(' ', p_deal_title, p_deal_description, p_deal_terms) ~*
      '(^|[^[:alnum:]_])((free|complimentary|discounted|reduced|two[-[:space:]]?for[-[:space:]]?one|2[-[:space:]]?for[-[:space:]]?1)[[:space:]]+(alcoholic[[:space:]]+)?drinks?|drinks?[[:space:]]+(special|ticket|credit|voucher)|(free|complimentary|discounted|reduced)[[:space:]]+shots?)([^[:alnum:]_]|$)';
$$;

revoke all on function public.club_deal_is_liquor_related(text, text, text, text) from public;
grant execute on function public.club_deal_is_liquor_related(text, text, text, text) to authenticated, service_role;

update public.qr_redemptions redemption
set
  status = 'voided',
  voided_at = coalesce(voided_at, now()),
  audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object('void_reason', 'liquor_deals_prohibited')
where redemption.status = 'generated'
  and exists (
    select 1
    from public.club_deals deal
    where deal.id = redemption.club_deal_id
      and public.club_deal_is_liquor_related(
        deal.offer_type,
        deal.deal_title,
        deal.deal_description,
        deal.deal_terms
      )
  );

update public.club_deals deal
set
  is_active = false,
  offer_type = 'other',
  booking_url = null,
  updated_at = now()
where public.club_deal_is_liquor_related(
  deal.offer_type,
  deal.deal_title,
  deal.deal_description,
  deal.deal_terms
);

alter table public.club_deals
  drop constraint if exists club_deals_offer_type_check;

alter table public.club_deals
  add constraint club_deals_offer_type_check
  check (offer_type in ('admission', 'other'));

alter table public.club_deals
  drop constraint if exists club_deals_liquor_free_check;

-- Historical alcohol offers stay inactive for financial/audit history. The
-- unvalidated constraint still rejects every new or updated prohibited row.
alter table public.club_deals
  add constraint club_deals_liquor_free_check
  check (not public.club_deal_is_liquor_related(
    offer_type,
    deal_title,
    deal_description,
    deal_terms
  )) not valid;

comment on constraint club_deals_liquor_free_check on public.club_deals is
  'Rejects new or updated Club Deals containing alcohol, liquor promotions, drink specials, or bottle service.';

commit;
