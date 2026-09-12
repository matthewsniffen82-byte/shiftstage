-- Public venue business/artwork fields remain selectable under existing row policies.
-- Review history/notes and QR-management metadata stay server-only.
-- Existing related-table RLS still needs the opaque owner identifier; retain it.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table public.venues in share row exclusive mode;
do $guard$ begin
  if not(select relrowsecurity from pg_class where oid='public.venues'::regclass)then raise exception 'PUBLIC_VENUE_RLS_REQUIRED';end if;
  if(select array_agg(attname::text order by attnum)from pg_attribute where attrelid='public.venues'::regclass and attnum>0 and not attisdropped)is distinct from array['id','name','slug','city','state','address','phone','website','timezone','opens_at','closes_at','is_active','created_at','updated_at','latitude','longitude','owner_user_id','qr_code_storage_path','qr_code_label','qr_code_updated_at','cover_image_storage_path','cover_image_updated_at','published_at','logo_storage_path','logo_updated_at','page_review_status','page_review_sent_at','page_reviewed_at','page_reviewed_by_user_id','page_review_notes']then raise exception 'PUBLIC_VENUE_SCHEMA_DRIFT';end if;
end $guard$;
revoke select on public.venues from public,anon,authenticated;
revoke select(created_at,updated_at,qr_code_storage_path,qr_code_label,qr_code_updated_at,page_review_status,page_review_sent_at,page_reviewed_at,page_reviewed_by_user_id,page_review_notes)on public.venues from public,anon,authenticated;
grant select(id,name,slug,city,state,address,phone,website,timezone,opens_at,closes_at,is_active,latitude,longitude,cover_image_storage_path,cover_image_updated_at,published_at,logo_storage_path,logo_updated_at,owner_user_id)on public.venues to anon,authenticated;
do $guard$ begin
  if exists(select 1 from pg_attribute a cross join unnest(array['anon','authenticated'])r where a.attrelid='public.venues'::regclass and a.attnum>0 and not a.attisdropped and has_column_privilege(r,a.attrelid,a.attname,'SELECT')is distinct from(a.attname=any(array['id','name','slug','city','state','address','phone','website','timezone','opens_at','closes_at','is_active','latitude','longitude','cover_image_storage_path','cover_image_updated_at','published_at','logo_storage_path','logo_updated_at','owner_user_id'])))then raise exception 'PUBLIC_VENUE_ACCESS_MISMATCH';end if;
  if not has_table_privilege('service_role','public.venues','SELECT')then raise exception 'PUBLIC_VENUE_SERVICE_REQUIRED';end if;
end $guard$;
commit;
