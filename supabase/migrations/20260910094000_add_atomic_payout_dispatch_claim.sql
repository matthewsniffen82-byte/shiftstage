-- Additive foundation. Switch the worker only after the function is deployed.
-- An uncertain existing dispatch must be reconciled, never claimed for sending again.
begin;

create or replace function public.claim_dancer_payout_dispatch(p_payout_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
set timezone = 'UTC'
as $$
declare
  v_before public.dancer_payout_batches%rowtype;
  v_after public.dancer_payout_batches%rowtype;
  v_mark jsonb;
  v_key text;
begin
  if p_payout_id is null then
    raise exception using errcode = '22023', message = 'A payout ID is required.';
  end if;
  select * into v_before from public.dancer_payout_batches where id = p_payout_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payout not found.';
  end if;
  if v_before.status <> 'requested' then
    return pg_catalog.jsonb_build_object('id',v_before.id,'status',v_before.status,'claimed',false);
  end if;
  if v_before.is_test or v_before.currency <> 'usd' or v_before.payment_provider = 'bitsafe' then
    raise exception using errcode = '22023', message = 'This payout cannot be dispatched.';
  end if;
  if v_before.provider_reference_id is not null or v_before.external_reference is not null
    or v_before.stripe_transfer_id is not null or v_before.processing_at is not null
    or v_before.paid_at is not null or v_before.failed_at is not null or v_before.canceled_at is not null
    or v_before.metadata @> '{"dispatch_review_required":true}'::jsonb
  then
    raise exception using errcode = '40001', message = 'Payout requires reconciliation before dispatch.';
  end if;

  v_key := 'mydancr-payout-' || p_payout_id::text;
  v_mark := public.mark_dancer_payout_processing(p_payout_id,v_key);
  select * into v_after from public.dancer_payout_batches where id = p_payout_id;
  if not found or v_mark is null
    or v_mark->>'id' is distinct from p_payout_id::text
    or v_mark->>'status' is distinct from 'processing'
    or v_after.status <> 'processing' or v_after.processing_at is null
    or v_after.provider_reference_id is distinct from v_key
    or v_after.external_reference is distinct from v_key
    or (v_before.payment_provider = 'stripe' and v_after.stripe_transfer_id is distinct from v_key)
    or (pg_catalog.to_jsonb(v_after) - array['status','processing_at','provider_reference_id','external_reference','stripe_transfer_id','failure_message','metadata','updated_at'])
       is distinct from (pg_catalog.to_jsonb(v_before) - array['status','processing_at','provider_reference_id','external_reference','stripe_transfer_id','failure_message','metadata','updated_at'])
  then
    raise exception using errcode = '40001', message = 'Payout dispatch claim could not be confirmed.';
  end if;
  return pg_catalog.jsonb_build_object(
    'id',v_after.id,'status',v_after.status,'claimed',true,
    'dancerId',v_after.dancer_id,'amountCents',v_after.amount_cents,
    'currency',v_after.currency,'paymentProvider',v_after.payment_provider,'dispatchKey',v_key
  );
end;
$$;

revoke all on function public.claim_dancer_payout_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.claim_dancer_payout_dispatch(uuid) to service_role;

commit;
