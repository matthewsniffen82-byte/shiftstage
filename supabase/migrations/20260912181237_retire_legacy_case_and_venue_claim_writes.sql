-- Retire direct copyright lifecycle writes after checked callers and native
-- transactions have deployed. Preserve claimant inserts and read/history access.
begin;
revoke insert,update,delete on public.dmca_cases,public.dmca_counter_notices,public.dmca_strikes from public,anon,authenticated;
revoke update,delete on public.dmca_cases from service_role;
revoke insert,update,delete on public.dmca_counter_notices,public.dmca_strikes from service_role;
do $column_permissions$
declare v_column record;
begin
 for v_column in select c.relname,a.attname from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
  where c.relnamespace='public'::regnamespace and c.relname in('dmca_cases','dmca_counter_notices','dmca_strikes')and a.attnum>0 and not a.attisdropped
 loop
  execute pg_catalog.format('revoke insert(%I),update(%I)on public.%I from public,anon,authenticated',v_column.attname,v_column.attname,v_column.relname);
  if v_column.relname='dmca_cases'then
   execute pg_catalog.format('revoke update(%I)on public.%I from service_role',v_column.attname,v_column.relname);
  else
   execute pg_catalog.format('revoke insert(%I),update(%I)on public.%I from service_role',v_column.attname,v_column.attname,v_column.relname);
  end if;
 end loop;
end;
$column_permissions$;
-- Current review endpoint is retired with HTTP 410. Keep its history and all
-- current venue-request/credential functions; remove this obsolete writer only.
revoke execute on function public.review_venue_ownership_claim(uuid,uuid,text,text) from public,anon,authenticated,service_role;

commit;
