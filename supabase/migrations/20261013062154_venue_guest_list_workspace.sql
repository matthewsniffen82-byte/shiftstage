begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Counts and the page share one snapshot. Contacts never leave the server RPC
-- boundary without the route first checking the staff member's venue access.
create function public.venue_guest_list_workspace(
  p_venue uuid, p_search text, p_status text,
  p_start timestamptz, p_end timestamptz, p_offset integer
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_venue is null or p_search is null or length(p_search) > 100
    or p_status is null or p_status not in ('all', 'generated', 'redeemed')
    or p_offset is null or p_offset < 0 or p_offset > 100000
    or (p_start is null) <> (p_end is null)
    or (p_start is not null and (p_end <= p_start or p_end - p_start > interval '26 hours')) then
    raise exception using errcode = '22023', message = 'Invalid guest filters.';
  end if;

  with matching as materialized (
    select g.pass_id as id, g.guest_name as name, g.phone, g.email, g.created_at,
      q.expires_at, q.arrival_method, q.redeemed_at,
      case when q.status = 'generated' and q.expires_at <= now() then 'expired' else q.status end as status
    from public.venue_guest_list_entries g
    join public.qr_redemptions q on q.id = g.pass_id and q.venue_id = g.venue_id
    where g.venue_id = p_venue and q.status in ('generated', 'redeemed', 'expired')
      and (p_search = '' or strpos(lower(concat_ws(' ', g.guest_name, g.phone, g.email)), lower(p_search)) > 0)
      and case when p_start is null then q.expires_at > now() and q.status in ('generated', 'redeemed')
        -- Count admission on the day it was actually recorded, even after expiry.
        when q.status = 'redeemed' and q.redeemed_at is not null then q.redeemed_at >= p_start and q.redeemed_at < p_end
        -- A pass created earlier can still be valid for this date. A missing
        -- legacy admission timestamp remains unknown, never guessed from expiry.
        else g.created_at < p_end and q.expires_at > p_start end
  ), page as (
    select * from matching where p_status = 'all' or status = p_status
    order by created_at desc, id limit 51 offset p_offset
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id)
      from (select * from page order by created_at desc, id limit 50) p), '[]'::jsonb),
    'hasMore', (select count(*) > 50 from page),
    'counts', jsonb_build_object('all', count(*), 'generated', count(*) filter (where status = 'generated'),
      'redeemed', count(*) filter (where status = 'redeemed'))
  ) into result from matching;
  return result;
end $$;
revoke all on function public.venue_guest_list_workspace(uuid,text,text,timestamptz,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.venue_guest_list_workspace(uuid,text,text,timestamptz,timestamptz,integer) to service_role;
commit;
