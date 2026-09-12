-- Keep the guest's request independently of a manager clearing their inbox.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.club_shuttle_requests (
  id uuid primary key,
  venue_id uuid not null,
  deal_id uuid,
  details_hash text not null check (details_hash ~ '^[0-9a-f]{64}$'),
  notification_rows jsonb not null check (
    jsonb_typeof(notification_rows) = 'array'
    and jsonb_array_length(notification_rows) between 1 and 100
    and octet_length(notification_rows::text) <= 524288
  ),
  venue_phone text,
  created_at timestamptz not null default now(),
  handed_off_at timestamptz
);
-- IDs are retained as historical references; deleting a club/deal must neither
-- delete the request receipt nor be blocked by it. Contact data stays private.
alter table public.club_shuttle_requests enable row level security;
revoke all on public.club_shuttle_requests from public, anon, authenticated;
grant select, insert on public.club_shuttle_requests to service_role;
grant update (handed_off_at) on public.club_shuttle_requests to service_role;

-- The request has already committed before this function is called. A failed
-- inbox write can be retried without losing the lead. Serialize handoff and its
-- receipt so cleared notifications are never reinserted by an ordinary retry.
create function public.handoff_club_shuttle_request(p_request_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  request_row public.club_shuttle_requests%rowtype;
  item jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Server access required.';
  end if;
  select * into request_row from public.club_shuttle_requests
    where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shuttle request not found.';
  end if;
  if request_row.handed_off_at is not null then
    return jsonb_build_object('request_id', request_row.id, 'newly_handed_off', false);
  end if;
  for item in select value from jsonb_array_elements(request_row.notification_rows) loop
    insert into public.notifications (id, recipient_id, notification_type, channel, title, body, payload)
      values ((item->>'id')::uuid, (item->>'recipient_id')::uuid,
        'support_message', 'in_app', item->>'title', item->>'body', item->'payload')
      on conflict (id) do nothing;
    if not exists (select 1 from public.notifications n where n.id = (item->>'id')::uuid
      and n.recipient_id = (item->>'recipient_id')::uuid and n.body = item->>'body'
      and n.payload = item->'payload') then
      raise exception using errcode = '23505', message = 'Shuttle handoff conflict.';
    end if;
  end loop;
  update public.club_shuttle_requests set handed_off_at = now() where id = request_row.id;
  return jsonb_build_object('request_id', request_row.id, 'newly_handed_off', true);
end;
$function$;
revoke all on function public.handoff_club_shuttle_request(uuid) from public, anon, authenticated;
grant execute on function public.handoff_club_shuttle_request(uuid) to service_role;

comment on table public.club_shuttle_requests is
  'Private immutable club pickup requests and inbox handoff receipts. Not transportation dispatch or proof of arrival.';
commit;
