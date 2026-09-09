-- All fixtures are rolled back. Run after the email confirmation migration.
begin;
do $$
declare
  manager_id uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid();
  request_id uuid;
  result jsonb;
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(manager_id,manager_id||'@example.invalid','{"mydancr_provisioned_role":"venue"}','{}'),
    (admin_id,admin_id||'@example.invalid','{"mydancr_provisioned_role":"admin"}','{}');
  insert into public.venue_signup_requests(venue_name,street_address,city,state,postal_code,contact_name,contact_title,contact_email,contact_phone,request_ip_hash,requester_user_id,login_email,status)
  values('Email confirmation test '||gen_random_uuid(),'123 Test Street','Las Vegas','NV','89101','Test Manager','Owner',manager_id||'@example.invalid','7025550123',repeat('a',64),manager_id,manager_id||'@example.invalid','awaiting_email_confirmation') returning id into request_id;
  if exists(select 1 from public.venue_signup_requests where id=request_id and status='pending') then raise exception 'Unconfirmed request reached approval queue'; end if;
  begin
    perform public.review_venue_signup_request(request_id,admin_id,'approved',null,null,repeat('b',64),now()+interval '7 days');
    raise exception 'Unconfirmed request was approved';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.venue_signup_requests set status='approved' where id=request_id;
    raise exception 'Direct approval bypassed email confirmation';
  exception when insufficient_privilege then null;
  end;
  update auth.users set email_confirmed_at=now() where id=manager_id;
  if not exists(select 1 from public.venue_signup_requests where id=request_id and status='pending') then raise exception 'Confirmed request did not enter pending queue'; end if;
  if exists(select 1 from public.venues where owner_user_id=manager_id) then raise exception 'Email confirmation granted venue management'; end if;
  result:=public.review_venue_signup_request(request_id,admin_id,'approved',null,null,repeat('c',64),now()+interval '7 days');
  if not exists(select 1 from public.venues where id=(result->'venue'->>'id')::uuid and owner_user_id=manager_id and is_active=false) then raise exception 'Approved confirmed manager did not receive private venue'; end if;
end;
$$;
rollback;
select 'Email confirmation must precede pending review and approval; fixtures rolled back' as result;
