begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Apply after the accompanying server-route release. No rows are modified.
-- Permissive policies OR together: the legacy policy defeats the stricter one.
drop policy if exists "approved dancers are public" on public.dancer_profiles;

alter policy "Venue team reads own activity" on public.venue_activity_log using (
  exists (select 1 from public.venues v where v.id = venue_activity_log.venue_id and v.owner_user_id = auth.uid())
  or exists (select 1 from public.venue_team_members m where m.venue_id = venue_activity_log.venue_id and m.user_id = auth.uid() and m.status = 'active')
);
alter policy "Venue team reads own NFC support requests" on public.venue_nfc_support_requests using (
  exists (select 1 from public.venues v where v.id = venue_nfc_support_requests.venue_id and v.owner_user_id = auth.uid())
  or exists (select 1 from public.venue_team_members m where m.venue_id = venue_nfc_support_requests.venue_id and m.user_id = auth.uid() and m.status = 'active')
);
alter policy "Venue teams read own Club Deal requests" on public.venue_club_deal_requests using (
  exists (select 1 from public.venues v where v.id = venue_club_deal_requests.venue_id and v.owner_user_id = auth.uid())
  or exists (select 1 from public.venue_team_members m where m.venue_id = venue_club_deal_requests.venue_id and m.user_id = auth.uid() and m.status = 'active')
);

-- A row policy cannot hide legal names on otherwise public profile rows.
revoke select on public.dancer_profiles from anon, authenticated;
revoke select (real_name) on public.dancer_profiles from anon, authenticated;
grant select (id, user_id, stage_name, slug, city, status, verification_status,
  photo_review_status, approved_at, disabled_at, created_at, updated_at,
  is_public, dmca_suspended_at, avatar_storage_path, avatar_updated_at,
  venue_approved_at, venue_approved_by_user_id, venue_approved_venue_id, identity_saved_at)
on public.dancer_profiles to anon, authenticated;

create or replace view public.public_dancer_profiles
with (security_invoker = true, security_barrier = true) as
select dp.id, dp.stage_name, dp.slug, dp.city, dp.approved_at, ts.rank, ts.score, ts.trend
from public.dancer_profiles dp
left join public.trending_scores ts on ts.dancer_id = dp.id
where dp.status = 'approved' and dp.verification_status = 'approved'
  and dp.venue_approved_at is not null and dp.is_public = true and dp.disabled_at is null;
revoke all on public.public_dancer_profiles from anon, authenticated;
grant select on public.public_dancer_profiles to anon, authenticated;

-- Unused by application routes. Keep the object available for private analytics.
revoke all on public.dancer_monthly_impact from public, anon, authenticated;
grant select on public.dancer_monthly_impact to service_role;

drop policy if exists "Venue owners manage own club deals" on public.club_deals;
drop policy if exists "Venue owners read own club deals" on public.club_deals;
create policy "Venue owners read own club deals" on public.club_deals for select
  using (exists (select 1 from public.venues v where v.id = club_deals.venue_id and v.owner_user_id = auth.uid()));
revoke insert, update, delete on public.club_deals from anon, authenticated;

-- Server routes validate identity, affiliation, scheduling and message attribution.
revoke insert, update, delete on public.shifts from anon, authenticated;
revoke insert, update, delete on public.support_threads, public.support_messages from anon, authenticated;

-- Mirror only Auth's committed email; pending new_email is intentionally ignored.
create or replace function public.sync_verified_auth_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.app_users set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_verified_auth_email() from public, anon, authenticated;
drop trigger if exists sync_verified_auth_email on auth.users;
create trigger sync_verified_auth_email after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_verified_auth_email();

notify pgrst, 'reload schema';
commit;
