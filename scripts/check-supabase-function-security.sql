-- Read-only release check. Run using the trusted linked database CLI.
-- Does not invoke application functions, grant access, or repair the schema.
-- Reviewed against catalog definitions on 2026-11-04. See the matching fixture
-- and review notes in tests/fixtures/public-function-boundaries-review.txt.
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
    ('public.accept_dancer_agreement(text,boolean)',false,true,'3e209995b8c38716c1335671e15bee9e'),
    ('public.audit_admin_media_review()',true,true,'7a732d7aeb7a6b74fad2bf196dc2fe2c'),
    ('public.club_deal_is_liquor_related(text,text,text,text)',false,true,'35306ccee7c39d837d4df307e863203b'),
    ('public.confirm_admission_pass(text,boolean)',false,true,'9712c01a53fa727f92d478d966f579b4'),
    ('public.current_user_role()',true,true,'4c4ef252da393e4bf294cbb87a6671da'),
    ('public.dancer_age_verification_access()',false,true,'c51b4eb6ccd8688f846033240b1a4402'),
    ('public.dancer_agreement_access()',false,true,'c974a600a2e4d601295bd9f0e3d0fe35'),
    ('public.get_venue_admission_metrics(uuid,timestamp with time zone,timestamp with time zone)',false,true,'6c743be634eb6b0ef414b464ecd30c67'),
    ('public.guard_admin_workspace_role()',true,true,'e0b508da9661c63d07f333a5598a4b47'),
    ('public.has_active_club_deal(public.venues)',true,true,'11d4c57efb60b486ca089cd3e93198ae'),
    ('public.is_admin()',true,true,'d79dc3e92f32eef1447defabfc094d29'),
    ('public.is_current_dancer_owner(uuid)',true,true,'1ada5b28f7f99d2dbb4655239a6fe3b8'),
    ('public.is_current_venue_owner(uuid)',true,true,'f0ecf762a11f80813cd20f9a553f8580'),
    ('public.mydancr_placeholder_venue_address(text,text)',true,true,'89a47d26b02c5c4f8fbd8d62746e51c3'),
    ('public.pickup_actor_role()',false,true,'a1ba579a67b552c81da898c3d2a18112'),
    ('public.pickup_manageable_venues()',false,true,'c12807ab47170170bddc58ccdf1ab460'),
    ('public.settle_deal_revenue_event(uuid,text,text)',false,false,'cebf533cbed90ad547fad777c407ef38'),
    ('public.staff_session_security()',false,true,'8bbcc698084b3a38c6f1a4f3fe6aa011'),
    ('public.valid_venue_weekly_hours(jsonb)',false,true,'c318507134ab7f562da1b9ea9f4ee557'),
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
    if v_interface.signature='public.settle_deal_revenue_event(uuid,text,text)' then
      -- Retired means inaccessible even to application service credentials.
      -- Pin the owner-only ACL as well as the inert invoker body above.
      if not exists(select 1 from pg_proc p where p.oid=v_oid
        and pg_get_userbyid(p.proowner)='postgres'
        and p.proacl::text[] = array['postgres=X/postgres']::text[]) then
        raise exception 'Retired billing function permissions changed';
      end if;
    end if;
    -- These actor-bound boolean helpers intentionally support ownership policies
    -- for all API roles. Pin their owner, settings and complete explicit ACL;
    -- effective permissions alone would also accept PUBLIC/inherited grants.
    if v_interface.signature in ('public.is_current_dancer_owner(uuid)','public.is_current_venue_owner(uuid)') then
      if not exists(select 1 from pg_proc p where p.oid=v_oid
        and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='s'
        and p.proconfig=array['search_path=""']::text[]
        and p.prorettype='boolean'::regtype and p.pronargs=1
        and p.proargtypes='2950'::oidvector) then
        raise exception 'Reviewed ownership helper security properties changed' using detail=v_interface.signature;
      end if;
      if (select array_agg(pg_get_userbyid(a.grantee)::text || ':' || pg_get_userbyid(a.grantor)::text || ':' || a.privilege_type || ':' || a.is_grantable::text
          order by pg_get_userbyid(a.grantee)::text) from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid=v_oid)
        is distinct from array['anon:postgres:EXECUTE:false','authenticated:postgres:EXECUTE:false','postgres:postgres:EXECUTE:false','service_role:postgres:EXECUTE:false']::text[] then
        raise exception 'Reviewed ownership helper explicit grants changed' using detail=v_interface.signature;
      end if;
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
  'anonymous_interfaces',(select count(*) from pg_proc where pronamespace='public'::regnamespace and has_function_privilege('anon',oid,'EXECUTE')),
  'authenticated_interfaces',(select count(*) from pg_proc where pronamespace='public'::regnamespace and has_function_privilege('authenticated',oid,'EXECUTE')),
  'application_functions_invoked',false) function_security;
rollback;
