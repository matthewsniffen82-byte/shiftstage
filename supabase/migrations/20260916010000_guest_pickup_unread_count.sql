begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Count only venue replies for the supplied private guest capabilities.
-- This read does not open a conversation or advance its read receipt.
create function public.pickup_guest_unread_count(p_links jsonb) returns bigint
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare unread bigint;
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array' then
    raise exception using errcode='22023', message='Invalid pickup links.';
  end if;
  if jsonb_array_length(p_links)>50 or exists (
    select 1 from jsonb_array_elements(p_links) x
    where jsonb_typeof(x) <> 'object'
      or coalesce(x->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(x->>'key_hash','') !~ '^[a-f0-9]{64}$'
  ) then raise exception using errcode='22023', message='Invalid pickup links.'; end if;
  select count(*) into unread from public.pickup_messages m
    join public.pickup_guest_access g on g.pickup_request_id=m.pickup_request_id
    join public.pickup_requests r on r.id=g.pickup_request_id
    join (select distinct (x->>'id')::uuid id,x->>'key_hash' key_hash from jsonb_array_elements(p_links) x) links
      on links.id=g.pickup_request_id and links.key_hash=g.key_hash
    where g.access_expires_at>now() and r.is_guest
      and m.sender_type='venue' and m.sequence>g.last_read_sequence;
  return unread;
end $$;
revoke all on function public.pickup_guest_unread_count(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pickup_guest_unread_count(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
