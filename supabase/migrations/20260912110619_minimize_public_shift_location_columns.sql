-- Public schedules retain published venue/timing and active-presence fields.
-- Exact device distance, internal links, and redundant lifecycle details stay private.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table public.shifts in share row exclusive mode;
do $guard$ begin
  if not(select relrowsecurity from pg_class where oid='public.shifts'::regclass)
  then raise exception 'PUBLIC_SHIFT_RLS_REQUIRED';end if;
  if(select array_agg(attname::text order by attnum)from pg_attribute where attrelid='public.shifts'::regclass and attnum>0 and not attisdropped)
    is distinct from array['id','dancer_id','venue_id','starts_at','ends_at','timezone','status','broadcast_sent_at','broadcast_recipients','created_at','updated_at','location_status','checked_in_at','checked_out_at','checkin_latitude','checkin_longitude','checkin_distance_feet','checkin_accuracy_meters','checkin_captured_at','last_location_latitude','last_location_longitude','last_location_accuracy_meters','last_location_captured_at','last_location_verified_at','location_verification_expires_at','working_status','commission_tracking_started_at','commission_tracking_stopped_at','ended_at','ended_reason','checkout_latitude','checkout_longitude','shift_summary','venue_affiliation_id','shift_date','shift_source','nfc_tag_id','nfc_last_tapped_at']
  then raise exception 'PUBLIC_SHIFT_COLUMN_SCHEMA_DRIFT';end if;
  if has_table_privilege('anon','public.shifts','SELECT')or has_table_privilege('authenticated','public.shifts','SELECT')
  then raise exception 'PUBLIC_SHIFT_UNEXPECTED_TABLE_GRANT';end if;
end $guard$;
revoke select(created_at,updated_at,checkin_distance_feet,last_location_verified_at,working_status,venue_affiliation_id,nfc_tag_id,nfc_last_tapped_at)on public.shifts from public,anon,authenticated;
do $guard$ begin
  if exists(select 1 from pg_attribute a cross join unnest(array['anon','authenticated'])r
    where a.attrelid='public.shifts'::regclass and a.attnum>0 and not a.attisdropped
    and has_column_privilege(r,a.attrelid,a.attname,'SELECT')is distinct from(a.attname=any(array['id','dancer_id','venue_id','starts_at','ends_at','timezone','status','location_status','checked_in_at','checked_out_at','location_verification_expires_at','shift_date','shift_source'])))
  then raise exception 'PUBLIC_SHIFT_COLUMN_ACCESS_MISMATCH';end if;
  if not has_table_privilege('service_role','public.shifts','SELECT')
  then raise exception 'PUBLIC_SHIFT_SERVER_ACCESS_REQUIRED';end if;
end $guard$;
commit;
