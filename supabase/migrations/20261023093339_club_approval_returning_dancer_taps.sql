begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Returning dancers retain their completed enrollment. Require a tap after removal,
-- while the separate club reentry block continues to require manager permission.
create or replace function public.guard_club_dancer_approval() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status <> 'active' then return new; end if;
  if exists(select 1 from public.venue_dancer_affiliations
    where venue_id=new.venue_id and dancer_id=new.dancer_id and status='active' and revoked_at is null) then
    return new;
  end if;
  if not exists(
    select 1 from public.club_dancer_approvals a join public.dancer_profiles d on d.id=a.dancer_id
    where a.venue_id=new.venue_id and a.dancer_id=new.dancer_id and a.status='approved'
      and (a.grandfathered or exists(select 1 from public.dancer_nfc_enrollments e
        where e.venue_id=a.venue_id and e.dancer_user_id=d.user_id
          and e.status in ('pending','completed') and e.tapped_at>a.reviewed_at and e.expires_at>clock_timestamp()
          and not exists(select 1 from public.venue_dancer_affiliations prior
            where prior.venue_id=a.venue_id and prior.dancer_id=a.dancer_id
              and prior.status='revoked' and prior.revoked_at>=e.tapped_at)))
  ) then raise exception 'CLUB_APPROVAL_AND_NEW_TAP_REQUIRED' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function public.guard_club_dancer_approval() from public,anon,authenticated;
commit;
