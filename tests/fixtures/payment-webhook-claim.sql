CREATE OR REPLACE FUNCTION public.claim_payment_provider_webhook(p_payment_provider text, p_provider_event_id text, p_event_type text, p_object_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_event_id uuid;
begin
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other')
    or nullif(trim(coalesce(p_provider_event_id, '')), '') is null
    or nullif(trim(coalesce(p_event_type, '')), '') is null
  then
    raise exception using errcode = '22023', message = 'A valid provider webhook event is required.';
  end if;

  insert into public.payment_provider_webhook_events (
    payment_provider, provider_event_id, event_type, object_id
  ) values (
    p_payment_provider, trim(p_provider_event_id), trim(p_event_type), nullif(trim(coalesce(p_object_id, '')), '')
  )
  on conflict (payment_provider, provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is not null then return true; end if;

  -- A failed delivery may retry immediately. A processing delivery is leased
  -- for ten minutes so concurrent duplicates cannot run, while a process crash
  -- cannot strand the provider event forever.
  update public.payment_provider_webhook_events
  set processing_status = 'processing', failure_reason = null, processed_at = null,
      processing_started_at = clock_timestamp(), attempt_count = attempt_count + 1
  where payment_provider = p_payment_provider
    and provider_event_id = trim(p_provider_event_id)
    and (
      processing_status = 'failed'
      or (processing_status = 'processing' and processing_started_at <= clock_timestamp() - interval '10 minutes')
    )
  returning id into v_event_id;
  return v_event_id is not null;
end;
$function$

