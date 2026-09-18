-- Switch dancer age assurance to Veriff without enabling enforcement.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.dancer_age_verifications rename column workflow_id to provider_integration_id;
alter table public.dancer_age_verifications add column provider text not null default 'didit' check (provider in ('didit','veriff'));
alter table public.dancer_age_verifications alter column provider set default 'veriff';

create or replace function public.dancer_age_verification_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('required', coalesce((select enabled from public.dancer_age_verification_settings where singleton),true),
    'verified',exists(select 1 from public.dancer_age_verifications where user_id=auth.uid() and provider='veriff' and status='verified'));
$$;

drop function public.reserve_dancer_age_verification(uuid);
create function public.reserve_dancer_age_verification(p_user_id uuid, p_integration_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.dancer_age_verifications; v_now timestamptz := clock_timestamp();
begin
  if p_integration_id is null or not exists(select 1 from public.app_users where id=p_user_id and role='dancer' and account_state='active') then
    raise exception using errcode='42501', message='Active dancer account and integration required.';
  end if;
  insert into public.dancer_age_verifications(user_id,provider,provider_integration_id)
    values(p_user_id,'veriff',p_integration_id::text) on conflict do nothing;
  select * into v from public.dancer_age_verifications where user_id=p_user_id for update;
  if v.provider='veriff' and (v.status='verified' or (v.provider_integration_id=p_integration_id::text
    and (v.status='in_review' or (v.status in ('creating','pending') and v.expires_at>v_now)))) then
    return to_jsonb(v) || jsonb_build_object('reserved',false);
  end if;
  if v.attempt_window_at <= v_now-interval '24 hours' then v.attempt_count:=0; v.attempt_window_at:=v_now; end if;
  if v.attempt_count>=3 then raise exception using errcode='P0001',message='AGE_VERIFICATION_RETRY_LIMIT'; end if;
  update public.dancer_age_verifications set attempt_id=gen_random_uuid(), session_id=null,
    provider='veriff', provider_integration_id=p_integration_id::text,
    status='creating', verification_url=null, created_at=v_now, expires_at=v_now+interval '90 seconds',
    checked_at=null, verified_at=null, attempt_window_at=v.attempt_window_at, attempt_count=v.attempt_count+1
    where user_id=p_user_id returning * into v;
  return to_jsonb(v) || jsonb_build_object('reserved',true);
end;
$$;
revoke all on function public.reserve_dancer_age_verification(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_dancer_age_verification(uuid,uuid) to service_role;

create or replace function public.enforce_dancer_age_verification() returns trigger
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
    if new.status::text not in ('draft','posted') then return new; end if;
    select user_id into v_user_id from public.dancer_profiles where id=new.dancer_id;
  end if;
  perform 1 from public.dancer_age_verifications where user_id=v_user_id and provider='veriff' and status='verified' for share;
  if not found then raise exception using errcode='42501',message='Verify you are 18 or older before using dancer features.'; end if;
  return new;
end;
$$;

create or replace function public.hide_age_unverified_dancer() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status='verified' and (new.status<>'verified' or new.provider<>old.provider) then
    update public.dancer_profiles set is_public=false where user_id=new.user_id and is_public;
  end if;
  return new;
end;
$$;

create or replace function public.activate_dancer_age_verification() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  lock table public.dancer_profiles in share row exclusive mode;
  update public.dancer_age_verification_settings set enabled=true where singleton;
  update public.dancer_profiles d set is_public=false where is_public
    and not exists(select 1 from public.dancer_age_verifications a where a.user_id=d.user_id and a.provider='veriff' and a.status='verified');
end;
$$;

-- Preserve the current rollout setting. If enforcement was already on, an old
-- provider's result cannot leave a profile public after the provider switch.
update public.dancer_profiles d set is_public=false where is_public
  and (select enabled from public.dancer_age_verification_settings where singleton)
  and not exists(select 1 from public.dancer_age_verifications a where a.user_id=d.user_id and a.provider='veriff' and a.status='verified');
commit;
