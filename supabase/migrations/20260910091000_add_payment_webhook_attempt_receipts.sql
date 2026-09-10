-- Additive rollout: callers switch only after this service-only function is verified.
-- Keep the existing claim function and its ten-minute lease/retry semantics intact.
begin;

create or replace function public.claim_payment_webhook_attempt(
  p_payment_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_object_id text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
set timezone = 'UTC'
as $$
declare
  v_claimed boolean;
  v_event public.payment_provider_webhook_events%rowtype;
begin
  if p_payment_provider is null then
    raise exception using errcode = '22023', message = 'A valid provider webhook event is required.';
  end if;

  v_claimed := public.claim_payment_provider_webhook(
    p_payment_provider, p_provider_event_id, p_event_type, p_object_id
  );
  -- The nested insert/update retains its lock until this transaction ends.
  -- Returning ownership in that same transaction avoids a claim-then-read race.
  select * into v_event from public.payment_provider_webhook_events
  where payment_provider = p_payment_provider
    and provider_event_id = pg_catalog.btrim(p_provider_event_id)
  for update;

  if not found or v_claimed is null
    or (v_claimed and v_event.processing_status <> 'processing')
  then
    raise exception using errcode = '40001', message = 'Provider event claim could not be confirmed.';
  end if;
  if v_event.event_type is distinct from pg_catalog.btrim(p_event_type)
    or v_event.object_id is distinct from nullif(pg_catalog.btrim(coalesce(p_object_id, '')), '')
  then
    raise exception using errcode = '40001', message = 'Provider event identity changed.';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_event.id,
    'paymentProvider', v_event.payment_provider,
    'eventId', v_event.provider_event_id,
    'eventType', v_event.event_type,
    'objectId', v_event.object_id,
    'claimed', v_claimed,
    'status', v_event.processing_status,
    'attemptCount', v_event.attempt_count,
    'processingStartedAt', v_event.processing_started_at
  );
end;
$$;

revoke all on function public.claim_payment_webhook_attempt(text,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_payment_webhook_attempt(text,text,text,text) to service_role;

commit;
