begin;
alter table public.venue_signup_requests drop constraint venue_signup_requests_status_check;
alter table public.venue_signup_requests add constraint venue_signup_requests_status_check
  check (status in ('awaiting_email_confirmation','pending','approved','rejected'));
alter table public.venue_signup_requests drop constraint venue_signup_requests_review_pair_check;
alter table public.venue_signup_requests add constraint venue_signup_requests_review_pair_check check (
  (status in ('awaiting_email_confirmation','pending') and reviewed_at is null and reviewed_by is null)
  or (status in ('approved','rejected') and reviewed_at is not null and reviewed_by is not null)
);
drop index public.venue_signup_requests_pending_duplicate_idx;
create unique index venue_signup_requests_pending_duplicate_idx on public.venue_signup_requests
  (lower(venue_name),lower(street_address),lower(contact_email))
  where status in ('awaiting_email_confirmation','pending');

-- The identity provider confirms ownership of the email before the request
-- enters the existing pending queue and its counts.
create or replace function public.confirm_venue_request_email()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.email_confirmed_at is not null then
    update public.venue_signup_requests set status='pending'
      where requester_user_id=new.id and status='awaiting_email_confirmation';
  end if;
  return new;
end;
$$;
create trigger venue_request_email_confirmed after update of email_confirmed_at on auth.users
  for each row when (new.email_confirmed_at is not null and old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function public.confirm_venue_request_email();
revoke all on function public.confirm_venue_request_email() from public,anon,authenticated;

create or replace function public.require_venue_request_email_confirmation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='approved' and new.requester_user_id is not null and not exists (
    select 1 from auth.users where id=new.requester_user_id and email_confirmed_at is not null
  ) then
    raise exception using errcode='42501',message='The manager must confirm their email before club approval.';
  end if;
  return new;
end;
$$;
create trigger venue_request_require_email_confirmation before update of status on public.venue_signup_requests
  for each row execute function public.require_venue_request_email_confirmation();
revoke all on function public.require_venue_request_email_confirmation() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
