begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Contact details stay separate from public admission-pass receipts and analytics.
create table public.venue_guest_list_entries (
  pass_id uuid primary key references public.qr_redemptions(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  guest_name text not null check (char_length(guest_name) between 2 and 100 and guest_name !~ '[[:cntrl:]]'),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or (char_length(email)<=254 and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')),
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index venue_guest_list_recent on public.venue_guest_list_entries(venue_id,created_at desc,pass_id);
alter table public.venue_guest_list_entries enable row level security;
revoke all on public.venue_guest_list_entries from public,anon,authenticated;
grant select,insert on public.venue_guest_list_entries to service_role;

create function public.issue_guest_list_admission_pass(
  p_token text,p_deal_id uuid,p_session_id uuid,p_customer_id uuid,p_source text,
  p_dancer_id uuid,p_shift_id uuid,p_arrival_method text,p_video_id uuid,
  p_guest_name text,p_phone text,p_email text,p_consent boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt jsonb; pass public.qr_redemptions; entry public.venue_guest_list_entries;
begin
  if p_consent is distinct from true or p_guest_name is null or char_length(trim(p_guest_name)) not between 2 and 100
    or p_guest_name ~ '[[:cntrl:]]' or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$'
    or (nullif(trim(p_email),'') is not null and (char_length(p_email)>254 or p_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')) then
    raise exception using errcode='22023',message='Enter your guest-list details and agree to share them with the club.';
  end if;
  receipt := public.issue_video_admission_pass(p_token,p_deal_id,p_session_id,p_customer_id,p_source,p_dancer_id,p_shift_id,p_arrival_method,p_video_id);
  select * into strict pass from public.qr_redemptions where redemption_token=receipt->>'token';
  insert into public.venue_guest_list_entries(pass_id,venue_id,guest_name,phone,email)
    values(pass.id,pass.venue_id,trim(p_guest_name),p_phone,nullif(trim(p_email),'')) on conflict(pass_id) do nothing;
  select * into strict entry from public.venue_guest_list_entries where pass_id=pass.id;
  if entry.guest_name is distinct from trim(p_guest_name) or entry.phone is distinct from p_phone
    or entry.email is distinct from nullif(trim(p_email),'') then
    raise exception using errcode='22023',message='You already have a guest-list entry for this pass. Use the same guest details to reopen it.';
  end if;
  return receipt || jsonb_build_object('guestListJoined',true);
end $$;
revoke all on function public.issue_guest_list_admission_pass(text,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.issue_guest_list_admission_pass(text,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,text,text,boolean) to service_role;
commit;
