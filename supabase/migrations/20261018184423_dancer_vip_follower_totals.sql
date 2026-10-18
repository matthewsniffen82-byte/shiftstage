begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Followers and deliverable working alerts are different audience measures.
-- Add follower totals without changing the existing alert counts or access.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_dancer_request_results(uuid,timestamptz,timestamptz)'::regprocedure);
  old_followers text := $old$subscribers as materialized (
   -- Following now drives both regular and VIP alerts. Legacy opt-in rows are not a second subscription.
   select f.customer_id from public.follows f
   join public.app_users u on u.id=f.customer_id and u.role='customer' and u.account_state='active'
   left join public.customer_profiles c on c.user_id=f.customer_id
   where f.dancer_id=p_dancer_id
     and coalesce(c.notification_settings->'followAlertsEnabled','true'::jsonb)<>'false'::jsonb
     and coalesce(c.notification_settings->'workingNow','true'::jsonb)<>'false'::jsonb
 ), vip_subscribers as materialized (
   select distinct s.customer_id,m.venue_id from subscribers s$old$;
  new_followers text := $new$active_followers as materialized (
   select f.customer_id,c.notification_settings from public.follows f
   join public.app_users u on u.id=f.customer_id and u.role='customer' and u.account_state='active'
   left join public.customer_profiles c on c.user_id=f.customer_id
   where f.dancer_id=p_dancer_id
 ), subscribers as materialized (
   select customer_id from active_followers
   where coalesce(notification_settings->'followAlertsEnabled','true'::jsonb)<>'false'::jsonb
     and coalesce(notification_settings->'workingNow','true'::jsonb)<>'false'::jsonb
 ), vip_followers as materialized (
   select distinct s.customer_id,m.venue_id from active_followers s$new$;
  old_observed text := $old$ ), observed as materialized ($old$;
  new_observed text := $new$ ), vip_subscribers as materialized (
   select v.customer_id,v.venue_id from vip_followers v
   join subscribers s on s.customer_id=v.customer_id
 ), observed as materialized ($new$;
  old_club_count text := $old$(select count(*) from vip_subscribers s where s.venue_id=v.id) "vipSubscribers"$old$;
  new_club_count text := $new$(select count(*) from vip_subscribers s where s.venue_id=v.id) "vipSubscribers",
     (select count(*) from vip_followers f where f.venue_id=v.id) "vipFollowers"$new$;
  old_alerts text := $old$'alerts',jsonb_build_object('total',(select count(*) from subscribers),'vip',(select count(distinct customer_id) from vip_subscribers)),$old$;
  new_alerts text := $new$'alerts',jsonb_build_object('total',(select count(*) from subscribers),'vip',(select count(distinct customer_id) from vip_subscribers)),
   'vipFollowers',(select count(distinct customer_id) from vip_followers),$new$;
begin
  if strpos(definition,old_followers)=0 or strpos(definition,old_observed)=0
    or strpos(definition,old_club_count)=0 or strpos(definition,old_alerts)=0 then
    raise exception 'Expected dancer audience aggregates were not found';
  end if;
  definition := replace(definition,old_followers,new_followers);
  definition := replace(definition,old_observed,new_observed);
  definition := replace(definition,old_club_count,new_club_count);
  definition := replace(definition,old_alerts,new_alerts);
  execute definition;
end;
$migration$;

revoke all on function public.get_dancer_request_results(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_dancer_request_results(uuid,timestamptz,timestamptz) to service_role;
commit;
