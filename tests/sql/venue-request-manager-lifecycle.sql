-- Run after the venue request manager migration. All fixtures roll back.
begin;
do $$
declare
  admin_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  rejected_id uuid := gen_random_uuid();
  disabled_id uuid := gen_random_uuid();
  request_id uuid;
  venue_id uuid;
  result jsonb;
  kind text;
  target_id uuid;
begin
  insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
  values (admin_id, admin_id || '@example.invalid', '{"mydancr_provisioned_role":"admin"}', '{}');
  foreach target_id in array array[manager_id,rejected_id,disabled_id] loop
    insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
    values (target_id, target_id || '@example.invalid', '{"mydancr_provisioned_role":"venue"}', '{}');
  end loop;
  update auth.users set email_confirmed_at=now() where id in (manager_id,rejected_id);
  update public.app_users set account_state='disabled' where id=disabled_id;
  foreach kind in array array['approved','rejected','legacy','disabled'] loop
    target_id := case kind when 'approved' then manager_id when 'rejected' then rejected_id when 'disabled' then disabled_id else null end;
    insert into public.venue_signup_requests(venue_name,street_address,city,state,postal_code,contact_name,contact_title,contact_email,contact_phone,request_ip_hash,requester_user_id,login_email)
    values ('Manager flow test ' || gen_random_uuid(),'123 Test Street','Test City','NV','89101','Test Manager','Owner','business@example.invalid','702-555-0123',repeat('a',64),target_id,case when target_id is not null then target_id || '@example.invalid' end)
    returning id into request_id;
    if exists (select 1 from public.venues where owner_user_id = target_id) then raise exception 'Pending manager already owns a venue'; end if;
    if kind='disabled' then
      begin
        perform public.review_venue_signup_request(request_id,admin_id,'approved',null,null,repeat('d',64),now()+interval '7 days');
        raise exception 'Disabled manager was approved';
      exception when insufficient_privilege then null;
      end;
      if not exists(select 1 from public.venue_signup_requests where id=request_id and status='pending' and matched_venue_id is null) then raise exception 'Failed approval did not roll back'; end if;
      continue;
    end if;
    result := public.review_venue_signup_request(request_id,admin_id,case when kind='rejected' then 'rejected' else 'approved' end,null,'Test decision',encode(extensions.digest(request_id::text,'sha256'),'hex'),now()+interval '7 days');
    venue_id := (result->'venue'->>'id')::uuid;
    if kind='rejected' then
      if venue_id is not null or exists(select 1 from public.venues where owner_user_id=target_id) then raise exception 'Rejected manager received venue access'; end if;
    elsif kind='approved' then
      if not exists(select 1 from public.venues where id=venue_id and owner_user_id=manager_id and is_active=false and published_at is null) then raise exception 'Approved manager did not receive private venue'; end if;
      if not exists(select 1 from public.venue_claim_codes where id=(result->'claim_code'->>'id')::uuid and used_by=manager_id and used_at is not null) then raise exception 'Approval code is still redeemable'; end if;
      begin
        perform public.review_venue_signup_request(request_id,admin_id,'approved',null,null,repeat('e',64),now()+interval '7 days');
        raise exception 'Request approved twice';
      exception when invalid_parameter_value then null;
      end;
    else
      if not exists(select 1 from public.venues where id=venue_id and owner_user_id is null) then raise exception 'Legacy approval changed ownership'; end if;
      if not exists(select 1 from public.venue_claim_codes where id=(result->'claim_code'->>'id')::uuid and used_at is null) then raise exception 'Legacy approval code was consumed'; end if;
    end if;
  end loop;
end;
$$;
rollback;
select 'Venue manager approval lifecycle passed; all fixtures rolled back' as result;
