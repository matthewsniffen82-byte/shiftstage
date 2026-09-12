-- Record an already acknowledged email delivery and retain its original receipt.
create function public.confirm_dmca_counter_forwarding(p_counter_id uuid,p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' set timezone='UTC'
as $function$
declare
 v_case public.dmca_cases%rowtype;
 v_counter public.dmca_counter_notices%rowtype;
 v_now timestamptz;
begin
 if p_counter_id is null or p_case_id is null then raise exception 'INVALID_COUNTER_FORWARDING_IDENTITY' using errcode='22023';end if;
 select * into v_case from public.dmca_cases where id=p_case_id for update;
 if not found then raise exception 'COUNTER_FORWARDING_CASE_MISSING' using errcode='P0002';end if;
 select * into v_counter from public.dmca_counter_notices where id=p_counter_id and case_id=p_case_id for update;
 if not found or v_counter.uploader_id is distinct from v_case.uploader_id then raise exception 'COUNTER_FORWARDING_IDENTITY_CHANGED' using errcode='40001';end if;
 v_now:=clock_timestamp();
 if v_counter.status in('forwarded','completed') and v_counter.forwarded_to_claimant_at is not null
   and isfinite(v_counter.forwarded_to_claimant_at) and v_counter.forwarded_to_claimant_at<=v_now then
  return jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'forwarded_to_claimant_at',v_counter.forwarded_to_claimant_at);
 end if;
 if v_case.status not in('countered','court_hold','closed') or v_counter.status<>'submitted' or v_counter.forwarded_to_claimant_at is not null then
  raise exception 'COUNTER_FORWARDING_STATE_CHANGED' using errcode='40001';
 end if;
 update public.dmca_counter_notices set status='forwarded',forwarded_to_claimant_at=v_now,updated_at=v_now
  where id=p_counter_id and case_id=p_case_id and status='submitted' and forwarded_to_claimant_at is null returning * into v_counter;
 if not found or v_counter.id is distinct from p_counter_id or v_counter.case_id is distinct from p_case_id
  or v_counter.uploader_id is distinct from v_case.uploader_id or v_counter.status<>'forwarded'
  or v_counter.forwarded_to_claimant_at is distinct from v_now or v_counter.updated_at is distinct from v_now then
  raise exception 'COUNTER_FORWARDING_WRITE_UNCONFIRMED' using errcode='40001';
 end if;
 return jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'forwarded_to_claimant_at',v_counter.forwarded_to_claimant_at);
end;
$function$;
revoke all on function public.confirm_dmca_counter_forwarding(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_dmca_counter_forwarding(uuid,uuid) to service_role;
