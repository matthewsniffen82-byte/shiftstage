begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Keep assigned numbers, including historical links for the same physical table.
-- Lock out concurrent provisioning until the backfill and constraint are in place.
lock table public.internal_roster_links in share row exclusive mode;
create function pg_temp.roster_numbered_label(old_label text) returns text
language sql immutable strict as $$
  select 'Table ' || digits from (
    select ltrim(coalesce(substring(lower(old_label) from 'table[[:space:]#:-]*([0-9]+)'),
                          substring(old_label from '([0-9]+)')), '0') as digits
  ) n where length(digits) between 1 and 54;
$$;
update public.internal_roster_links
set label = pg_temp.roster_numbered_label(label), updated_at = now()
where kind = 'table' and label !~ '^Table [1-9][0-9]*$'
  and pg_temp.roster_numbered_label(label) is not null;

-- Legacy names with no usable number get the first free number at that club.
do $$
declare
  item record;
  available integer;
begin
  for item in select id, venue_id from public.internal_roster_links
              where kind = 'table' and label !~ '^Table [1-9][0-9]*$'
              order by venue_id, created_at, id
  loop
    select min(n) into available from generate_series(1, (select count(*)::integer + 1
      from public.internal_roster_links where venue_id = item.venue_id and kind = 'table')) n
    where not exists (select 1 from public.internal_roster_links
      where venue_id = item.venue_id and kind = 'table' and label = 'Table ' || n);
    update public.internal_roster_links set label = 'Table ' || available, updated_at = now() where id = item.id;
  end loop;
end $$;

alter table public.internal_roster_links add constraint internal_roster_table_label_number
  check (kind <> 'table' or label ~ '^Table [1-9][0-9]*$');

-- Existing delivery records snapshot the label. Preserve historical numbers that
-- already have the correct format, including tables renumbered since a request.
update public.dancer_table_request_deliveries d set table_label = coalesce(pg_temp.roster_numbered_label(d.table_label), l.label)
from public.internal_roster_requests r join public.internal_roster_links l on l.id = r.link_id
where d.request_id = r.id and d.table_label !~ '^Table [1-9][0-9]*$';
update public.internal_request_email_deliveries e set table_label = coalesce(pg_temp.roster_numbered_label(e.table_label), l.label)
from public.internal_request_push_deliveries p
join public.internal_roster_requests r on r.id = p.request_id
join public.internal_roster_links l on l.id = r.link_id
where e.id = p.id and e.table_label !~ '^Table [1-9][0-9]*$';
update public.notifications n
set payload = jsonb_set(n.payload, '{tableLabel}', to_jsonb(d.table_label)),
    body = case when starts_with(n.body, n.payload->>'tableLabel')
      then d.table_label || substr(n.body, length(n.payload->>'tableLabel') + 1) else n.body end
from public.dancer_table_request_deliveries d
where d.id = n.id and n.payload->>'kind' = 'dancer_table_request'
  and n.payload->>'tableLabel' !~ '^Table [1-9][0-9]*$';
commit;
