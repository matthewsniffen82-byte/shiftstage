-- Dancer-only age assurance. Enable only after the live Didit workflow is configured.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.dancer_age_verification_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into public.dancer_age_verification_settings(singleton, enabled) values(true, false);
create table public.dancer_age_verifications (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  attempt_id uuid not null default gen_random_uuid(),
  session_id uuid unique,
  workflow_id text,
  status text not null default 'not_started' check (status in ('not_started','creating','pending','in_review','verified','declined','expired')),
  verification_url text check (verification_url is null or length(verification_url) <= 2048),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  checked_at timestamptz,
  verified_at timestamptz,
  attempt_window_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  check (status <> 'verified' or (session_id is not null and workflow_id is not null and verified_at is not null))
);
alter table public.dancer_age_verification_settings enable row level security;
alter table public.dancer_age_verifications enable row level security;
revoke all on public.dancer_age_verification_settings, public.dancer_age_verifications from public, anon, authenticated;
grant select, insert, update, delete on public.dancer_age_verification_settings, public.dancer_age_verifications to service_role;

create function public.dancer_age_verification_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('required', coalesce((select enabled from public.dancer_age_verification_settings where singleton),true),
    'verified',exists(select 1 from public.dancer_age_verifications where user_id=auth.uid() and status='verified'));
$$;
revoke all on function public.dancer_age_verification_access() from public, anon;
grant execute on function public.dancer_age_verification_access() to authenticated;

create function public.reserve_dancer_age_verification(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.dancer_age_verifications; v_now timestamptz := clock_timestamp();
begin
  if not exists(select 1 from public.app_users where id=p_user_id and role='dancer' and account_state='active') then
    raise exception using errcode='42501', message='Active dancer account required.';
  end if;
  insert into public.dancer_age_verifications(user_id) values(p_user_id) on conflict do nothing;
  select * into v from public.dancer_age_verifications where user_id=p_user_id for update;
  if v.status='verified' or v.status='in_review' or (v.status in ('creating','pending') and v.expires_at>v_now) then
    return to_jsonb(v) || jsonb_build_object('reserved',false);
  end if;
  if v.attempt_window_at <= v_now-interval '24 hours' then v.attempt_count:=0; v.attempt_window_at:=v_now; end if;
  if v.attempt_count>=3 then raise exception using errcode='P0001',message='AGE_VERIFICATION_RETRY_LIMIT'; end if;
  update public.dancer_age_verifications set attempt_id=gen_random_uuid(), session_id=null, workflow_id=null,
    status='creating', verification_url=null, created_at=v_now, expires_at=v_now+interval '90 seconds',
    checked_at=null, verified_at=null, attempt_window_at=v.attempt_window_at, attempt_count=v.attempt_count+1
    where user_id=p_user_id returning * into v;
  return to_jsonb(v) || jsonb_build_object('reserved',true);
end;
$$;
revoke all on function public.reserve_dancer_age_verification(uuid) from public, anon, authenticated;
grant execute on function public.reserve_dancer_age_verification(uuid) to service_role;

create function public.enforce_dancer_age_verification() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user_id uuid; v_required boolean;
begin
  select enabled into v_required from public.dancer_age_verification_settings where singleton;
  if v_required is false then return new; end if;
  if tg_table_name='dancer_profiles' then
    if not new.is_public and (tg_op='UPDATE' and new.status is not distinct from old.status
      or new.status::text not in ('pending_review','approved')) then return new; end if;
    v_user_id:=new.user_id;
  else
    -- Ending/cancelling a shift must remain available to unverified dancers.
    if new.status::text not in ('draft','posted') then return new; end if;
    select user_id into v_user_id from public.dancer_profiles where id=new.dancer_id;
  end if;
  perform 1 from public.dancer_age_verifications where user_id=v_user_id and status='verified' for share;
  if not found then raise exception using errcode='42501',message='Verify you are 18 or older before using dancer features.'; end if;
  return new;
end;
$$;
revoke all on function public.enforce_dancer_age_verification() from public, anon, authenticated;
create trigger enforce_dancer_age_verification before insert or update on public.dancer_profiles
  for each row execute function public.enforce_dancer_age_verification();
create trigger enforce_dancer_shift_age_verification before insert or update on public.shifts
  for each row execute function public.enforce_dancer_age_verification();

-- Revocation cannot leave an already public profile discoverable.
create function public.hide_age_unverified_dancer() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status='verified' and new.status<>'verified' then
    update public.dancer_profiles set is_public=false where user_id=new.user_id and is_public;
  end if;
  return new;
end;
$$;
revoke all on function public.hide_age_unverified_dancer() from public, anon, authenticated;
create trigger hide_age_unverified_dancer after update on public.dancer_age_verifications
  for each row execute function public.hide_age_unverified_dancer();

create function public.activate_dancer_age_verification() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Existing accounts also verify; no automatic grandfathering or fabricated approvals.
  lock table public.dancer_profiles in share row exclusive mode;
  update public.dancer_age_verification_settings set enabled=true where singleton;
  update public.dancer_profiles d set is_public=false where is_public
    and not exists(select 1 from public.dancer_age_verifications a where a.user_id=d.user_id and a.status='verified');
end;
$$;
revoke all on function public.activate_dancer_age_verification() from public, anon, authenticated;
grant execute on function public.activate_dancer_age_verification() to service_role;
commit;
