begin;

-- Removing an offer preserves its financial records and request history.
alter table public.club_deals add column if not exists removed_at timestamptz;
alter table public.club_deals add constraint club_deals_removed_are_inactive
  check (removed_at is null or not is_active);

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
  update public.club_deals set is_active = false, removed_at = coalesce(removed_at, now()), updated_at = now()
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
