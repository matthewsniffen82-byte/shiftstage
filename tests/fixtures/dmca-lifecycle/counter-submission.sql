-- Confirm counter-notice and case writes within their existing atomic transaction.
CREATE OR REPLACE FUNCTION public.submit_dmca_counter_notice_safely(p_user_id uuid, p_case_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_case public.dmca_cases%rowtype;
  v_counter public.dmca_counter_notices%rowtype;
  v_field record;
  v_legal_name text; v_email text; v_phone text; v_address text;
  v_location text; v_signature text;
  v_now timestamptz; v_day timestamptz; v_eligible timestamptz; v_deadline timestamptz;
  v_weekdays integer := 0;
  v_duplicate boolean := false;
begin
  if p_user_id is null or p_case_id is null or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'INVALID_COUNTER_NOTICE' using errcode='22023';
  end if;
  for v_field in select * from (values ('legalName',2,160),('email',5,320),('phone',7,50),
    ('address',10,1000),('removedMaterialLocation',8,2000),('signature',2,160)) as fields(name,minimum,maximum)
  loop
    if jsonb_typeof(p_details->v_field.name) is distinct from 'string'
      or char_length(btrim(p_details->>v_field.name)) not between v_field.minimum and v_field.maximum then
      raise exception 'INVALID_COUNTER_NOTICE' using errcode='22023';
    end if;
  end loop;
  if p_details->'mistakeBeliefConfirmed' is distinct from 'true'::jsonb
    or p_details->'perjuryConfirmed' is distinct from 'true'::jsonb
    or p_details->'jurisdictionConfirmed' is distinct from 'true'::jsonb
    or p_details->'serviceConfirmed' is distinct from 'true'::jsonb then
    raise exception 'COUNTER_NOTICE_CONFIRMATIONS_REQUIRED' using errcode='22023';
  end if;
  v_legal_name:=btrim(p_details->>'legalName'); v_email:=lower(btrim(p_details->>'email'));
  v_phone:=btrim(p_details->>'phone'); v_address:=btrim(p_details->>'address');
  v_location:=btrim(p_details->>'removedMaterialLocation'); v_signature:=btrim(p_details->>'signature');
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_COUNTER_NOTICE_EMAIL' using errcode='22023';
  end if;

  -- Match takedown/restoration case-first locking. Do not block an authenticated
  -- uploader's appeal merely because their application account is disabled.
  select * into v_case from public.dmca_cases where id=p_case_id and uploader_id=p_user_id for update;
  if not found then raise exception 'COUNTER_NOTICE_CASE_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_counter from public.dmca_counter_notices where case_id=p_case_id for update;
  if found then
    if row(v_counter.uploader_id,v_counter.legal_name,v_counter.email,v_counter.phone,v_counter.address,
      v_counter.removed_material_location,v_counter.signature,v_counter.mistake_belief_confirmed,
      v_counter.perjury_confirmed,v_counter.jurisdiction_confirmed,v_counter.service_confirmed)
      is distinct from row(p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,v_signature,true,true,true,true) then
      raise exception 'COUNTER_NOTICE_ALREADY_HAS_DIFFERENT_DETAILS' using errcode='23505';
    end if;
    if v_case.status='disabled' or v_case.counter_received_at is null
      or v_case.restore_eligible_at is null or v_case.restore_deadline_at is null then
      raise exception 'COUNTER_NOTICE_RECEIPT_UNCONFIRMED' using errcode='40001';
    end if;
    v_duplicate:=true;
  else
    if v_case.status<>'disabled' then raise exception 'COUNTER_NOTICE_CASE_NOT_ELIGIBLE' using errcode='22023'; end if;
    v_now:=clock_timestamp(); v_day:=v_now;
    -- Same UTC weekdays rule as the existing application helper, independent
    -- of the session timezone and daylight-saving interval length.
    while v_weekdays<14 loop
      v_day:=((v_day at time zone 'UTC')+interval '1 day') at time zone 'UTC';
      if extract(isodow from v_day at time zone 'UTC')<6 then
        v_weekdays:=v_weekdays+1;
        if v_weekdays=10 then v_eligible:=v_day; end if;
      end if;
    end loop;
    v_deadline:=v_day;
    insert into public.dmca_counter_notices(case_id,uploader_id,legal_name,email,phone,address,
      removed_material_location,mistake_belief_confirmed,perjury_confirmed,jurisdiction_confirmed,
      service_confirmed,signature,status,created_at,updated_at)
      values(p_case_id,p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,true,true,true,true,
        v_signature,'submitted',v_now,v_now) returning * into v_counter;
    if not found or v_counter.id is null or row(v_counter.case_id,v_counter.uploader_id,v_counter.legal_name,v_counter.email,
      v_counter.phone,v_counter.address,v_counter.removed_material_location,v_counter.signature,v_counter.status,
      v_counter.mistake_belief_confirmed,v_counter.perjury_confirmed,v_counter.jurisdiction_confirmed,v_counter.service_confirmed)
      is distinct from row(p_case_id,p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,v_signature,'submitted',true,true,true,true) then
      raise exception 'COUNTER_NOTICE_INSERT_UNCONFIRMED' using errcode='40001';
    end if;
    update public.dmca_cases set status='countered',counter_received_at=v_now,
      restore_eligible_at=v_eligible,restore_deadline_at=v_deadline,updated_at=v_now
      where id=p_case_id and uploader_id=p_user_id and status='disabled' returning * into v_case;
    if not found or row(v_case.id,v_case.uploader_id,v_case.status,v_case.counter_received_at,v_case.restore_eligible_at,v_case.restore_deadline_at)
      is distinct from row(p_case_id,p_user_id,'countered',v_now,v_eligible,v_deadline) then
      raise exception 'COUNTER_NOTICE_TRANSITION_UNCONFIRMED' using errcode='40001';
    end if;
  end if;
  return jsonb_build_object('duplicate',v_duplicate,
    'counter',jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'created_at',v_counter.created_at),
    'case',jsonb_build_object('id',v_case.id,'status',v_case.status,'counter_received_at',v_case.counter_received_at,
      'restore_eligible_at',v_case.restore_eligible_at,'restore_deadline_at',v_case.restore_deadline_at,
      'claimant_name',v_case.claimant_name,'claimant_email',v_case.claimant_email));
end;
$function$
;
