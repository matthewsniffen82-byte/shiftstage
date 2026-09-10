-- Additive foundation; switch the signed provider caller only after deployment.
begin;

create or replace function public.flag_paid_payout_recovery_safely(
  p_payout_id uuid,
  p_provider_reference_id text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
set timezone = 'UTC'
as $$
declare
  v_payout public.dancer_payout_batches%rowtype;
  v_count integer;
  v_amount bigint;
  v_ids uuid[];
  v_expected jsonb;
  v_actual jsonb;
  v_audit_id bigint;
  v_has_audit boolean;
begin
  if p_payout_id is null or p_provider_reference_id is null
    or char_length(p_provider_reference_id) not between 3 and 255
    or p_provider_reference_id <> btrim(p_provider_reference_id)
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500
  then
    raise exception using errcode='22023',message='A valid payout, provider reference and recovery reason are required.';
  end if;
  select * into v_payout from public.dancer_payout_batches where id=p_payout_id for update;
  if not found then raise exception using errcode='P0002',message='Payout not found.';end if;
  if v_payout.status <> 'paid' or v_payout.payment_provider <> 'stripe'
    or v_payout.provider_reference_id is distinct from p_provider_reference_id
  then raise exception using errcode='40001',message='The paid provider payout could not be confirmed.';end if;

  perform 1 from public.commission_events where payout_batch_id=p_payout_id order by id for update;
  if exists(select 1 from public.commission_events where payout_batch_id=p_payout_id
    and (status<>'paid' or dancer_id is distinct from v_payout.dancer_id
      or currency is distinct from v_payout.currency or payment_provider is distinct from v_payout.payment_provider))
  then raise exception using errcode='40001',message='Paid payout earnings could not be confirmed.';end if;
  select count(*)::integer,coalesce(sum(amount_cents),0)::bigint,array_agg(id order by id),
    jsonb_agg(to_jsonb(e)||jsonb_build_object('recovery_required',true,
      'review_flag',coalesce(e.review_flag,'paid_payout_reversed_by_provider')) order by id)
    into v_count,v_amount,v_ids,v_expected
    from public.commission_events e where payout_batch_id=p_payout_id;
  if v_count=0 or v_amount<>v_payout.amount_cents then
    raise exception using errcode='40001',message='Paid payout total could not be confirmed.';
  end if;
  perform 1 from public.dancer_payout_items where payout_batch_id=p_payout_id order by id for update;
  if (select count(*) from public.dancer_payout_items where payout_batch_id=p_payout_id)<>v_count
    or exists(select 1 from public.dancer_payout_items i
      left join public.commission_events e on e.id=i.commission_event_id
      where i.payout_batch_id=p_payout_id and
        (e.payout_batch_id is distinct from p_payout_id or i.amount_cents is distinct from e.amount_cents))
  then raise exception using errcode='40001',message='Paid payout items could not be confirmed.';end if;

  select exists(select 1 from public.financial_audit_events
    where actor_type='provider' and action='paid_payout_recovery_required'
      and target_type='payout' and target_id=p_payout_id::text
      and metadata->>'provider_reference_id'=p_provider_reference_id
      and metadata->'automatic_debit_attempted'='false'::jsonb) into v_has_audit;
  select jsonb_agg(to_jsonb(e) order by id) into v_actual
    from public.commission_events e where payout_batch_id=p_payout_id;
  if v_has_audit and v_actual=v_expected then
    return jsonb_build_object('id',p_payout_id,'status','paid','providerReferenceId',p_provider_reference_id,
      'recoveryRequired',true,'earningCount',v_count,'duplicate',true);
  end if;

  update public.commission_events set recovery_required=true,
    review_flag=coalesce(review_flag,'paid_payout_reversed_by_provider')
    where id=any(v_ids);
  select jsonb_agg(to_jsonb(e) order by id) into v_actual
    from public.commission_events e where payout_batch_id=p_payout_id;
  if v_actual is distinct from v_expected then
    raise exception using errcode='40001',message='Payout recovery update could not be confirmed.';
  end if;
  insert into public.financial_audit_events(actor_type,action,target_type,target_id,reason,metadata)
    values('provider','paid_payout_recovery_required','payout',p_payout_id::text,btrim(p_reason),
      jsonb_build_object('provider_reference_id',p_provider_reference_id,'automatic_debit_attempted',false))
    returning id into v_audit_id;
  if v_audit_id is null or not exists(select 1 from public.financial_audit_events
    where id=v_audit_id and actor_type='provider' and action='paid_payout_recovery_required'
      and target_type='payout' and target_id=p_payout_id::text and reason=btrim(p_reason)
      and metadata=jsonb_build_object('provider_reference_id',p_provider_reference_id,'automatic_debit_attempted',false))
  then raise exception using errcode='40001',message='Payout recovery audit could not be confirmed.';end if;
  return jsonb_build_object('id',p_payout_id,'status','paid','providerReferenceId',p_provider_reference_id,
    'recoveryRequired',true,'earningCount',v_count,'duplicate',false);
end;
$$;

revoke all on function public.flag_paid_payout_recovery_safely(uuid,text,text) from public,anon,authenticated;
grant execute on function public.flag_paid_payout_recovery_safely(uuid,text,text) to service_role;

commit;
