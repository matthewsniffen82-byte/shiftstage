CREATE OR REPLACE FUNCTION public.complete_dancer_payout_batch(p_batch_id uuid, p_transfer_id text, p_paid_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_payout public.dancer_payout_batches%rowtype;
begin
  if char_length(trim(coalesce(p_transfer_id, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A valid provider payout reference is required.';
  end if;
  select * into v_payout from public.dancer_payout_batches where id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status <> 'processing' then
    raise exception using errcode = '22023', message = 'Only a processing payout can be marked paid.';
  end if;
  update public.dancer_payout_batches set status = 'paid', provider_reference_id = trim(p_transfer_id),
    external_reference = trim(p_transfer_id), paid_at = p_paid_at, failure_message = null, updated_at = now()
  where id = p_batch_id;
  update public.commission_events set status = 'paid', paid_at = p_paid_at
  where payout_batch_id = p_batch_id and status = 'payout_processing';
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, after_state)
  values ('provider', 'payout_paid', 'payout', p_batch_id::text,
    jsonb_build_object('status', 'paid', 'provider_reference_id', trim(p_transfer_id), 'paid_at', p_paid_at));
  return jsonb_build_object('id', p_batch_id, 'status', 'paid', 'provider_reference_id', trim(p_transfer_id));
end;
$function$
