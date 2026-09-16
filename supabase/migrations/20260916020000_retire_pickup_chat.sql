begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Retire the conversation service. Preserve historical records and their
-- immutability; contact-form receipts remain in club_shuttle_requests.
drop trigger if exists pickup_nfc_arrival on public.qr_redemptions;
create or replace function public.pickup_guard_enabled() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.club_pickup_enabled then
    raise exception using errcode='42501', message='Pickup chat has been retired.';
  end if;
  return new;
end $$;
update public.venues set club_pickup_enabled=false where club_pickup_enabled;

do $$ declare f record; t record; begin
  -- These two read-only helpers also authorize the contact-form manager inbox.
  for f in select p.oid::regprocedure as signature, p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'pickup\_%' escape '\' or p.proname='club_pickup_available') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role', f.signature);
    if f.proname in ('pickup_actor_role','pickup_manageable_venues') then
      execute format('grant execute on function %s to authenticated', f.signature);
    end if;
  end loop;
  for t in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname like 'pickup\_%' escape '\' and c.relkind in ('r','S') loop
    execute format('revoke all on %s public.%I from public,anon,authenticated,service_role',
      case when t.relkind='S' then 'sequence' else 'table' end, t.relname);
  end loop;
  for t in select pubname, schemaname, tablename from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename in ('pickup_requests','pickup_messages') loop
    execute format('alter publication %I drop table %I.%I', t.pubname, t.schemaname, t.tablename);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
