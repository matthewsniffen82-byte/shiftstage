-- Require the expected case version and commit administrator decisions with their audit.
create function public.transition_dmca_admin_case(
  p_case_id uuid,p_admin_id uuid,p_action text,p_expected_status text,
  p_expected_updated_at timestamptz,p_notes text default null
)returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' set timezone='UTC'
as $function$
declare
  v_case public.dmca_cases%rowtype;
  v_status text;
  v_notes text:=nullif(btrim(coalesce(p_notes,'')),'');
  v_now timestamptz;
  v_rows integer;
  v_court_received boolean;
  v_court_notes text;
begin
  if p_admin_id is null or not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then
    raise exception 'DMCA_ADMIN_REQUIRED' using errcode='42501';
  end if;
  if p_case_id is null or p_action is null or p_action not in('request_information','reject','record_court_action','close')
    or p_expected_status is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or length(coalesce(p_notes,''))>4000 then
    raise exception 'INVALID_DMCA_ADMIN_TRANSITION' using errcode='22023';
  end if;
  select * into v_case from public.dmca_cases where id=p_case_id for update;
  if not found then raise exception 'DMCA_CASE_NOT_FOUND' using errcode='P0002';end if;
  if v_case.status is distinct from p_expected_status or v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'DMCA_CASE_CHANGED' using errcode='40001';
  end if;
  -- Match the existing administrator panel's offered state/action pairs.
  if p_action in('request_information','reject') and v_case.status not in('submitted','needs_information')
    or p_action='record_court_action' and (v_case.status<>'countered' or v_notes is null)
    or p_action='close' and v_case.status<>'court_hold' then
    raise exception 'DMCA_ACTION_NOT_AVAILABLE' using errcode='22023';
  end if;
  v_status:=case p_action when 'request_information'then'needs_information' when'reject'then'rejected'
    when'record_court_action'then'court_hold' else'closed'end;
  v_now:=clock_timestamp();
  v_court_received:=case when p_action='record_court_action'then true else v_case.court_filing_received end;
  v_court_notes:=case when p_action='record_court_action'then v_notes else v_case.court_filing_notes end;
  update public.dmca_cases set status=v_status,reviewed_by=p_admin_id,reviewed_at=v_now,updated_at=v_now,
    admin_notes=v_notes,court_filing_received=case when p_action='record_court_action'then true else court_filing_received end,
    court_filing_notes=case when p_action='record_court_action'then v_notes else court_filing_notes end
    where id=p_case_id returning * into v_case;
  if not found or row(v_case.id,v_case.status,v_case.reviewed_by,v_case.reviewed_at,v_case.updated_at,v_case.admin_notes,v_case.court_filing_received,v_case.court_filing_notes)
    is distinct from row(p_case_id,v_status,p_admin_id,v_now,v_now,v_notes,v_court_received,v_court_notes) then
    raise exception 'DMCA_CASE_WRITE_UNCONFIRMED' using errcode='40001';end if;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_admin_id,'dmca_case',p_case_id,'dmca_'||p_action,v_notes);
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'DMCA_AUDIT_WRITE_UNCONFIRMED' using errcode='40001';end if;
  return jsonb_build_object('caseId',v_case.id,'status',v_case.status,'updatedAt',v_case.updated_at);
end;
$function$;
revoke all on function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamptz,text)from public,anon,authenticated,service_role;
grant execute on function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamptz,text)to service_role;
