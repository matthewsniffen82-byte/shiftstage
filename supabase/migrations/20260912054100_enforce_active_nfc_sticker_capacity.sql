-- Enforce the existing venue capacity across provisioning, enable and rotation.
-- Preserve all existing stickers, secrets, ownership and rotation history.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public.enforce_active_venue_nfc_capacity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  active_tag_count integer;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.venue_id = new.venue_id and old.status = 'active' then
      return new;
    end if;
  end if;
  if current_setting('transaction_isolation') = 'repeatable read' then
    raise exception using errcode = '25000',
      message = 'Active NFC sticker changes require Read Committed or Serializable isolation.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('mydancr:venue-active-nfc-slots:' || new.venue_id::text, 0)
  );
  -- A separate VOLATILE query refreshes Read Committed visibility after waiting.
  select count(*) into active_tag_count
  from public.nfc_tags
  where venue_id = new.venue_id and status = 'active';
  if active_tag_count > 25 then
    raise exception using errcode = '54000',
      message = 'This venue already has the maximum of 25 active NFC stickers.';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_active_venue_nfc_capacity()
  from public, anon, authenticated, service_role;

create trigger enforce_active_venue_nfc_capacity
  after insert or update of venue_id, status on public.nfc_tags
  for each row execute function public.enforce_active_venue_nfc_capacity();

commit;
