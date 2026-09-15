begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.pickup_unread_counts(p_ids uuid[]) returns table(request_id uuid,unread_count bigint)
language sql stable security definer set search_path=pg_catalog,public as $$
  select r.id,(select count(*) from public.pickup_messages m where m.pickup_request_id=r.id
    and m.sender_user_id is distinct from auth.uid() and m.sequence>coalesce((select last_read_sequence
      from public.pickup_read_receipts where pickup_request_id=r.id and user_id=auth.uid()),0))
  from public.pickup_requests r where r.id=any(p_ids) and cardinality(p_ids)<=50 and public.pickup_viewer(r.id) is not null
$$;
create function public.pickup_manageable_venues() returns jsonb language sql stable security definer
set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) from (
    select id,name,slug,club_pickup_enabled,(is_active and page_review_status='published' and published_at is not null) eligible
    from public.venues where public.pickup_venue_authorized(id) or public.pickup_actor_role()='admin' order by name,id limit 200
  ) v
$$;
revoke all on function public.pickup_unread_counts(uuid[]),public.pickup_manageable_venues() from public,anon,authenticated,service_role;
grant execute on function public.pickup_unread_counts(uuid[]),public.pickup_manageable_venues() to authenticated;
notify pgrst,'reload schema';
commit;
