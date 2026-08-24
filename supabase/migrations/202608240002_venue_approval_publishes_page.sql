begin;

comment on column public.venues.is_active is
  'True after the connected venue approves the complete MyDancr-managed page; approval publishes that exact reviewed version.';
comment on column public.venues.published_at is
  'Timestamp when the connected venue approved and published the complete MyDancr-managed page.';

-- Reconcile pages approved under the short-lived two-step workflow, but only
-- when the same server-required public fields, media, and live offer exist.
update public.venues as venue
set
  is_active = true,
  published_at = coalesce(venue.page_reviewed_at, now()),
  page_review_status = 'published',
  page_review_notes = null,
  updated_at = now()
where venue.page_review_status = 'venue_approved'
  and nullif(btrim(venue.name), '') is not null
  and nullif(btrim(venue.address), '') is not null
  and nullif(btrim(venue.city), '') is not null
  and nullif(btrim(venue.state), '') is not null
  and nullif(btrim(venue.phone), '') is not null
  and venue.opens_at is not null
  and venue.closes_at is not null
  and venue.logo_storage_path is not null
  and venue.cover_image_storage_path is not null
  and exists (
    select 1
    from public.club_deals as deal
    where deal.venue_id = venue.id
      and deal.is_active = true
  );

commit;
