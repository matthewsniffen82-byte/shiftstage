begin;

alter table public.venues
  add column if not exists page_review_status text not null default 'admin_draft',
  add column if not exists page_review_sent_at timestamptz,
  add column if not exists page_reviewed_at timestamptz,
  add column if not exists page_reviewed_by_user_id uuid references public.app_users(id) on delete set null,
  add column if not exists page_review_notes text;

alter table public.venues
  drop constraint if exists venues_page_review_status_check;

alter table public.venues
  add constraint venues_page_review_status_check check (
    page_review_status in (
      'admin_draft',
      'venue_review',
      'changes_requested',
      'venue_approved',
      'published'
    )
  );

update public.venues
set page_review_status = case
  when is_active = true then 'published'
  else 'admin_draft'
end
where page_review_status is null
   or (is_active = true and page_review_status <> 'published');

create index if not exists venues_page_review_status_idx
  on public.venues(page_review_status, updated_at desc);

comment on column public.venues.page_review_status is
  'MyDancr-managed venue page workflow: admin draft, venue review, changes requested, venue approved, or published.';
comment on column public.venues.page_review_sent_at is
  'When a MyDancr administrator most recently sent the private page to the connected venue account for review.';
comment on column public.venues.page_reviewed_at is
  'When the connected venue account most recently approved the page or requested changes.';
comment on column public.venues.page_reviewed_by_user_id is
  'Connected venue user who most recently approved the page or requested changes.';
comment on column public.venues.page_review_notes is
  'Venue change-request notes; cleared when the venue approves the page.';
comment on column public.venues.is_active is
  'True only after the connected venue approves the prepared page and a MyDancr administrator publishes it.';
comment on column public.venues.published_at is
  'Timestamp of the latest MyDancr administrator publication after venue approval.';

commit;
