begin;

-- Public listing is separate from page approval. No affiliations, schedules,
-- dancer approval, or videos are changed when the last deal is paused.
create or replace function public.has_active_club_deal(public.venues)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.club_deals d
    where d.venue_id = $1.id and d.is_active
      and d.payout_type = 'flat' and d.payout_amount_cents > 0
      and d.offer_type = 'admission'
      and d.deal_title in ('Half-off admission', 'Skip the line', 'Free admission')
  );
$$;
revoke all on function public.has_active_club_deal(public.venues) from public;
grant execute on function public.has_active_club_deal(public.venues) to anon, authenticated, service_role;
create index if not exists club_deals_active_venue_listing_idx
  on public.club_deals (venue_id) where is_active and payout_type = 'flat' and payout_amount_cents > 0;

alter table public.venue_club_deal_requests
  add column if not exists request_type text not null default 'add' check (request_type in ('add', 'remove')),
  add column if not exists target_deal_id uuid references public.club_deals(id) on delete set null;

-- Keep offer identity constrained; the request type distinguishes removal.
create or replace function public.approve_venue_deal_removal(
  p_request_id uuid, p_venue_id uuid, p_admin_user_id uuid
)
returns public.venue_club_deal_requests
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.venue_club_deal_requests;
begin
  if not exists (select 1 from public.app_users where id = p_admin_user_id and role = 'admin' and account_state = 'active') then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select * into v_request from public.venue_club_deal_requests
    where id = p_request_id and venue_id = p_venue_id for update;
  if not found or v_request.request_type <> 'remove' or v_request.status not in ('pending', 'under_review') then
    raise exception 'This deal removal request is no longer available for review.';
  end if;
  if v_request.target_deal_id is null then
    raise exception 'The requested Club Deal no longer exists.';
  end if;
  update public.club_deals set is_active = false, updated_at = now()
    where id = v_request.target_deal_id and venue_id = p_venue_id;
  if not found then raise exception 'Club Deal not found for this venue.'; end if;
  update public.venue_club_deal_requests
    set status = 'approved', linked_deal_id = v_request.target_deal_id,
      reviewed_by_admin_user_id = p_admin_user_id, reviewed_at = now(),
      decision_note = 'Removal approved. This Club Deal is no longer available to guests.', updated_at = now()
    where id = v_request.id returning * into v_request;
  return v_request;
end;
$$;
revoke all on function public.approve_venue_deal_removal(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_venue_deal_removal(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
