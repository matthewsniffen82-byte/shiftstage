-- Keep idempotency fallback receipts scoped to the authenticated caller's dancer.
-- No payout rows, provider behavior, signature or privileges change.
begin;

CREATE OR REPLACE FUNCTION public.request_dancer_payout(p_user_id uuid, p_request_key text, p_payment_provider text, p_is_test boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
declare
  v_dancer_id uuid;
  v_account public.dancer_payout_accounts%rowtype;
  v_settings public.payout_settings%rowtype;
  v_payout_id uuid;
  v_amount bigint;
  v_count integer;
  v_earning_ids uuid[];
  v_duplicate jsonb;
begin
  if char_length(trim(coalesce(p_request_key, ''))) < 12 then
    raise exception using errcode = '22023', message = 'A valid idempotency key is required.';
  end if;
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other') then
    raise exception using errcode = '22023', message = 'Unsupported payout provider.';
  end if;

  -- Lock the dancer row before inspecting idempotency or active batches. This
  -- serializes simultaneous cash-out requests even before a payout row exists.
  select id into v_dancer_id from public.dancer_profiles where user_id = p_user_id for update;
  if v_dancer_id is null then
    raise exception using errcode = '42501', message = 'Dancer account required.';
  end if;
  select * into v_settings from public.payout_settings where id = 'default' for share;
  if v_settings.payout_mode not in ('manual_cashout', 'both') then
    raise exception using errcode = '22023', message = 'Manual cash out is not enabled.';
  end if;

  select jsonb_build_object('id', id, 'status', status, 'amount_cents', amount_cents,
    'currency', currency, 'is_test', is_test, 'duplicate', true)
    into v_duplicate
  from public.dancer_payout_batches
  where request_key = trim(p_request_key) and dancer_id = v_dancer_id;
  if v_duplicate is not null then return v_duplicate; end if;

  if not p_is_test then
    select * into v_account from public.dancer_payout_accounts
    where dancer_id = v_dancer_id and payment_provider = p_payment_provider;
    if not found or v_account.onboarding_status <> 'complete'
      or v_account.payout_eligibility <> 'eligible'
      or v_account.verification_status <> 'verified'
    then
      raise exception using errcode = '22023', message = 'Payout setup and verification must be completed first.';
    end if;
  end if;

  perform 1 from public.dancer_payout_batches
  where dancer_id = v_dancer_id and currency = 'usd' and status in ('requested', 'processing')
  for update;
  if found then
    raise exception using errcode = '23505', message = 'A payout request is already active.';
  end if;

  with locked_earnings as (
    select id, amount_cents
    from public.commission_events
    where dancer_id = v_dancer_id and status = 'available' and payout_batch_id is null
      and held_at is null and review_flag is null and currency = 'usd'
    order by created_at, id
    for update
  )
  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint, array_agg(id order by id)
    into v_count, v_amount, v_earning_ids
  from locked_earnings;

  if v_count = 0 or v_amount < v_settings.minimum_payout_cents then
    raise exception using errcode = '22023', message = 'Available earnings do not meet the minimum cash-out amount.';
  end if;

  insert into public.dancer_payout_batches (
    dancer_id, status, currency, amount_cents, payment_provider, request_key, is_test,
    requested_at, metadata
  ) values (
    v_dancer_id, 'requested', 'usd', v_amount::integer, p_payment_provider,
    trim(p_request_key), p_is_test, clock_timestamp(),
    jsonb_build_object('requested_by_user_id', p_user_id, 'source', 'manual_cashout')
  ) returning id into v_payout_id;

  insert into public.dancer_payout_items (payout_batch_id, commission_event_id, amount_cents)
  select v_payout_id, id, amount_cents from public.commission_events
  where id = any(v_earning_ids);

  update public.commission_events
  set status = 'payout_processing', payout_batch_id = v_payout_id,
      payment_provider = p_payment_provider
  where id in (
    select commission_event_id from public.dancer_payout_items where payout_batch_id = v_payout_id
  );

  insert into public.financial_audit_events (
    actor_user_id, actor_type, action, target_type, target_id, after_state, metadata
  ) values (
    p_user_id, 'dancer', 'request_cash_out', 'payout', v_payout_id::text,
    jsonb_build_object('status', 'requested', 'amount_cents', v_amount, 'currency', 'usd'),
    jsonb_build_object('is_test', p_is_test, 'request_key', trim(p_request_key))
  );

  return jsonb_build_object('id', v_payout_id, 'status', 'requested',
    'amount_cents', v_amount, 'currency', 'usd', 'is_test', p_is_test);
exception when unique_violation then
  select jsonb_build_object('id', id, 'status', status, 'amount_cents', amount_cents,
    'currency', currency, 'is_test', is_test, 'duplicate', true)
    into v_duplicate from public.dancer_payout_batches
    where request_key = trim(p_request_key) and dancer_id = v_dancer_id;
  if v_duplicate is not null then return v_duplicate; end if;
  raise;
end;
$function$;

commit;
