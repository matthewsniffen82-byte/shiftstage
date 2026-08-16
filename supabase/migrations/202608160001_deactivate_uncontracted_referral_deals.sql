-- A published Club Deal must have an active MyDancr-controlled referral-fee
-- agreement. Legacy test deals with sub-dollar fees cannot be converted into
-- a signed term without an admin decision, so fail closed until one is set.

update public.club_deals deal
set is_active = false,
    updated_at = now()
where deal.is_active = true
  and not exists (
    select 1
    from public.venue_referral_fee_terms term
    where term.venue_id = deal.venue_id
      and term.superseded_at is null
      and term.effective_from <= now()
      and (term.effective_until is null or term.effective_until > now())
  );
