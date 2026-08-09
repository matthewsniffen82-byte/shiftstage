begin;

create or replace function public.enforce_active_affiliation_for_posted_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.status = 'posted'
    and not exists (
      select 1
      from public.venue_dancer_affiliations affiliation
      join public.venues venue on venue.id = affiliation.venue_id
      where affiliation.dancer_id = new.dancer_id
        and affiliation.venue_id = new.venue_id
        and affiliation.status = 'active'
        and affiliation.revoked_at is null
        and venue.is_active = true
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Venue manager approval is required before this dancer can post a shift at this venue.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_active_affiliation_for_posted_shift on public.shifts;
create trigger enforce_active_affiliation_for_posted_shift
before insert or update on public.shifts
for each row execute function public.enforce_active_affiliation_for_posted_shift();

revoke all on function public.enforce_active_affiliation_for_posted_shift() from public, anon, authenticated;

comment on function public.enforce_active_affiliation_for_posted_shift()
is 'Prevents dancers from posting shifts at venues without an active manager-approved affiliation.';

notify pgrst, 'reload schema';

commit;
