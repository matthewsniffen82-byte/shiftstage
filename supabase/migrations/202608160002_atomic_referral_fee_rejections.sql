-- Reject fee change requests and write their admin audit record atomically.

create or replace function public.reject_admin_venue_referral_fee_request(
  p_admin_id uuid,
  p_request_id uuid,
  p_decision_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.venue_referral_fee_change_requests;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1
    from public.app_users account
    where account.id = p_admin_id
      and account.role = 'admin'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active MyDancr admin account required.';
  end if;
  if char_length(trim(coalesce(p_decision_note, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'A decision note between 3 and 500 characters is required.';
  end if;

  update public.venue_referral_fee_change_requests
  set status = 'rejected',
      reviewed_by_admin_user_id = p_admin_id,
      reviewed_at = v_now,
      decision_note = trim(p_decision_note),
      updated_at = v_now
  where id = p_request_id
    and status = 'pending'
  returning * into v_request;
  if not found then
    raise exception using errcode = '22023', message = 'This fee change request is no longer pending.';
  end if;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_referral_fee_request',
    v_request.id,
    'reject_referral_fee_change',
    trim(p_decision_note)
  );

  return v_request.id;
end;
$$;

revoke all on function public.reject_admin_venue_referral_fee_request(uuid, uuid, text) from public;
grant execute on function public.reject_admin_venue_referral_fee_request(uuid, uuid, text) to service_role;
