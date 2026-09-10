-- Read-only release check. Run using the trusted linked database CLI.
-- Does not invoke application functions, grant access, or repair the schema.
-- The seven browser interfaces were reviewed separately for role/ownership rules.
-- A changed interface must be reviewed and its native tests updated before this
-- allowlist changes. Service-only functions need no entry in this list.
begin isolation level repeatable read read only;
set local statement_timeout = '20s';
set local search_path = pg_catalog, public, pg_temp;

do $function_security$
declare
  v_role text;
  v_schema text;
  v_interface record;
  v_oid oid;
  v_anon oid[] := '{}';
  v_authenticated oid[] := '{}';
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'Function security check must remain read-only';
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if to_regrole(v_role) is null then raise exception 'Required API role is missing'; end if;
    if exists(select 1 from pg_roles where rolname=v_role and (rolsuper or rolcreaterole or rolcreatedb or rolcanlogin)) then
      raise exception 'Unexpected API role capabilities';
    end if;
    if (select rolbypassrls from pg_roles where rolname=v_role) is distinct from (v_role='service_role') then
      raise exception 'Unexpected API row-security capabilities';
    end if;
    foreach v_schema in array array['public','auth'] loop
      if has_schema_privilege(v_role,v_schema,'CREATE') then raise exception 'API role can create in a trusted function schema'; end if;
    end loop;
  end loop;

  for v_interface in select * from (values
    ('public.current_user_role()',true,true,'4c4ef252da393e4bf294cbb87a6671da'),
    ('public.is_admin()',true,true,'aa75a61376ef5a45ec72cb30fb0eb229'),
    ('public.has_active_club_deal(public.venues)',true,true,'d695658ec212784c67b16cdb5fbc584b'),
    ('public.mydancr_placeholder_venue_address(text,text)',true,true,'89a47d26b02c5c4f8fbd8d62746e51c3'),
    ('public.club_deal_is_liquor_related(text,text,text,text)',false,true,'35306ccee7c39d837d4df307e863203b'),
    ('public.settle_deal_revenue_event(uuid,text,text)',false,true,'7e8ceefbca38b6cff1699bfb458844cc'),
    ('public.void_generated_deal_redemption(uuid,text)',false,true,'24f6800dc2e788f604088acf25e10105')
  ) interfaces(signature,anonymous,authenticated,fingerprint) loop
    v_oid := to_regprocedure(v_interface.signature);
    if v_oid is null then raise exception 'Reviewed browser function is missing'; end if;
    if md5(pg_get_functiondef(v_oid)) <> v_interface.fingerprint then
      raise exception 'Browser function definition needs security review' using detail=v_interface.signature;
    end if;
    if has_function_privilege('anon',v_oid,'EXECUTE') is distinct from v_interface.anonymous
       or has_function_privilege('authenticated',v_oid,'EXECUTE') is distinct from v_interface.authenticated then
      raise exception 'Reviewed browser function permissions changed' using detail=v_interface.signature;
    end if;
    if v_interface.anonymous then v_anon := array_append(v_anon,v_oid); end if;
    if v_interface.authenticated then v_authenticated := array_append(v_authenticated,v_oid); end if;
  end loop;

  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and
    ((has_function_privilege('anon',p.oid,'EXECUTE') and not(p.oid=any(v_anon)))
    or (has_function_privilege('authenticated',p.oid,'EXECUTE') and not(p.oid=any(v_authenticated))))) then
    raise exception 'Unexpected browser-callable public function';
  end if;
  -- Check effective membership, not only direct function ACL entries.
  foreach v_role in array array['anon','authenticated'] loop
    if pg_has_role(v_role,'service_role','MEMBER') or exists(
      select 1 from pg_proc p where p.pronamespace='public'::regnamespace
      and pg_has_role(v_role,p.proowner,'MEMBER')) then
      raise exception 'Browser role can assume privileged function ownership';
    end if;
  end loop;
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
    and not exists(select 1 from pg_options_to_table(p.proconfig) option
      where option.option_name='search_path' and option.option_value in
        ('""','public','public, pg_temp','public, auth','pg_catalog','pg_catalog, public','pg_catalog, pg_temp'))) then
    raise exception 'Privileged function has an unreviewed search path';
  end if;
end;
$function_security$;

select jsonb_build_object('ok',true,'read_only',current_setting('transaction_read_only'),
  'captured_at',clock_timestamp(),
  'public_functions',(select count(*) from pg_proc where pronamespace='public'::regnamespace),
  'security_definers',(select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef),
  'anonymous_interfaces',4,'authenticated_interfaces',7,
  'application_functions_invoked',false) function_security;
rollback;
