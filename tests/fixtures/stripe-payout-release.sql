CREATE OR REPLACE FUNCTION public.release_dancer_payout_batch(p_batch_id uuid, p_status text, p_failure_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_payout public.dancer_payout_batches%rowtype; v_final_status text;
begin
  v_final_status := case when p_status in ('canceled') then 'canceled' else 'failed' end;
  select * into v_payout from public.dancer_payout_batches where id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status not in ('requested', 'processing') then
    raise exception using errcode = '22023', message = 'Payout cannot be released from its current status.';
  end if;
  update public.commission_events set status = 'available', payout_batch_id = null, payment_provider = null,
    metadata = metadata || jsonb_build_object('released_payout_id', p_batch_id,
      'release_reason', left(coalesce(p_failure_message, ''), 500))
  where payout_batch_id = p_batch_id and status = 'payout_processing';
  update public.dancer_payout_batches set status = v_final_status,
    failed_at = case when v_final_status = 'failed' then now() else failed_at end,
    canceled_at = case when v_final_status = 'canceled' then now() else canceled_at end,
    failure_message = left(coalesce(p_failure_message, 'Payout was not completed.'), 500), updated_at = now()
  where id = p_batch_id;
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, after_state, reason)
  values ('system', 'release_payout_reservation', 'payout', p_batch_id::text,
    jsonb_build_object('status', v_final_status), left(coalesce(p_failure_message, ''), 500));
  return jsonb_build_object('id', p_batch_id, 'status', v_final_status);
end;
$function$
