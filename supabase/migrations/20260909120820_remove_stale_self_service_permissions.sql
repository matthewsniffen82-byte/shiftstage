-- Remove obsolete self-reactivation permissions left on already-active accounts
-- by the former Auth metadata merge behavior. Keep current self-pauses intact.
-- Apply only after the account-state fix is deployed. The fixed cutoff excludes
-- new pause requests, which now always receive a fresh timestamp.
do $security_cleanup$
declare
  stale_user_id uuid;
begin
  for stale_user_id in
    select a.id
    from public.app_users a
    join auth.users u on u.id = a.id
    where a.account_state = 'active'
      and u.raw_app_meta_data->>'mydancr_self_disabled_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
      and u.raw_app_meta_data->>'mydancr_self_disabled_at' < '2026-09-09T12:00:00.000Z'
    order by a.id
    for update of a, u
  loop
    update auth.users
      set raw_app_meta_data = raw_app_meta_data
        - 'mydancr_self_disabled_at' - 'mydancr_venue_was_active'
      where id = stale_user_id;
  end loop;
end;
$security_cleanup$;
