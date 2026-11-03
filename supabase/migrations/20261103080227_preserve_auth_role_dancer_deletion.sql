begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function public.protect_admission_pass()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare
  compared_dancer_id uuid;
  compared_shift_id uuid;
begin
  if new.admission_pass_version=1 and current_user in ('anon','authenticated') then
    raise exception using errcode='42501',message='Use the authorized admission pass workflow.';
  end if;
  if tg_op='INSERT' then return new;end if;

  -- ON DELETE SET NULL releases attribution after its parent is deleted.
  -- Auth's internal deletion role cannot SELECT application tables. At nested
  -- trigger depth it may clear FK references, but receives no new privileges.
  -- Preserve the issued pass and admission history without permitting a direct
  -- edit to attribution while the referenced dancer or shift still exists.
  compared_dancer_id := new.dancer_id;
  compared_shift_id := new.shift_id;
  if pg_trigger_depth()>1 then
    if new.dancer_id is null and old.dancer_id is not null
      and (current_user='supabase_auth_admin'
        or not exists(select 1 from public.dancer_profiles where id=old.dancer_id)) then
      compared_dancer_id := old.dancer_id;
    end if;
    if new.shift_id is null and old.shift_id is not null
      and (current_user='supabase_auth_admin'
        or not exists(select 1 from public.shifts where id=old.shift_id)) then
      compared_shift_id := old.shift_id;
    end if;
  end if;

  if row(new.admission_pass_version,new.arrival_method,new.expires_at,new.venue_id,new.club_deal_id,new.customer_id,new.session_id,new.redemption_token,new.source_type,compared_dancer_id,compared_shift_id,new.audit)
    is distinct from row(old.admission_pass_version,old.arrival_method,old.expires_at,old.venue_id,old.club_deal_id,old.customer_id,old.session_id,old.redemption_token,old.source_type,old.dancer_id,old.shift_id,old.audit)
    and (old.admission_pass_version is not null or new.admission_pass_version is not null) then
    raise exception using errcode='42501',message='Issued pass details cannot be changed.';
  end if;
  if old.admission_pass_version=1 and old.status='redeemed' and
    row(new.status,new.redeemed_at,new.redeemed_by_user_id,new.arrival_verified_at)
      is distinct from row(old.status,old.redeemed_at,old.redeemed_by_user_id,old.arrival_verified_at) then
    raise exception using errcode='42501',message='Recorded admission cannot be changed.';
  end if;
  return new;
end $$;

revoke all on function public.protect_admission_pass() from public,anon,authenticated;
commit;
