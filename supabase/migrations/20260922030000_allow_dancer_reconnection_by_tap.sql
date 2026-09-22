begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A fresh dressing-room tap can restore a removed roster connection. Keep the
-- legacy field false for compatibility with versions still reading it during
-- deployment; it no longer controls access or needs a club permission action.
create or replace function public.guard_dancer_venue_reentry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.reentry_blocked := false;
  if new.status <> 'active' then return new; end if;
  perform id from public.venues where id = new.venue_id for share;
  if exists (select 1 from public.venue_participation_ends where venue_id = new.venue_id) then
    raise exception 'This club is no longer on MyDancr.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_dancer_venue_reentry() from public, anon, authenticated, service_role;

-- Clear permission holds without restoring affiliations or starting check-ins.
update public.venue_dancer_affiliations set reentry_blocked = false where reentry_blocked;
drop function public.allow_dancer_venue_retap(uuid, uuid);

notify pgrst, 'reload schema';
commit;
