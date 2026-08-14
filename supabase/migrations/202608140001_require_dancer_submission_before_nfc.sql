begin;

create or replace function public.require_submitted_dancer_profile_for_active_affiliation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_status public.dancer_status;
  v_profile_disabled_at timestamptz;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select dancer.status, dancer.disabled_at
  into v_profile_status, v_profile_disabled_at
  from public.dancer_profiles dancer
  where dancer.id = new.dancer_id;

  if not found
    or v_profile_disabled_at is not null
    or v_profile_status not in ('pending_review', 'approved')
  then
    raise exception using
      errcode = '42501',
      message = 'Submit your completed profile before using dressing-room NFC.';
  end if;

  return new;
end;
$$;

drop trigger if exists venue_affiliation_requires_submitted_profile
  on public.venue_dancer_affiliations;

create trigger venue_affiliation_requires_submitted_profile
before insert or update of status on public.venue_dancer_affiliations
for each row
execute function public.require_submitted_dancer_profile_for_active_affiliation();

revoke all on function public.require_submitted_dancer_profile_for_active_affiliation() from public;

commit;
