-- Public TV rows expose published presentation data, not moderation work or login IDs.
begin;
set local search_path=pg_catalog,public;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table public.mydancr_tv_videos in share row exclusive mode;
do $guard$ begin
 if not(select relrowsecurity from pg_class where oid='public.mydancr_tv_videos'::regclass)then raise exception 'PUBLIC_TV_RLS_REQUIRED';end if;
 if(select array_agg(attname::text order by attnum)from pg_attribute where attrelid='public.mydancr_tv_videos'::regclass and attnum>0 and not attisdropped)is distinct from array['id','dancer_id','submitted_by','venue_id','shift_id','caption','storage_path','storage_mime','file_size_bytes','duration_seconds','width','height','status','venue_tag_status','venue_featured','consent_confirmed','rights_confirmed','review_notes','reviewed_by','submitted_at','reviewed_at','published_at','expires_at','created_at','updated_at','moderation_decision','moderation_reason_codes','moderation_category_scores','moderation_provider_flagged','moderation_frame_count','moderation_model','moderation_details','moderation_attempt_count','moderation_started_at','moderation_completed_at','distribution_scope','like_count','is_pinned']then raise exception 'PUBLIC_TV_SCHEMA_DRIFT';end if;
end $guard$;
revoke select on public.mydancr_tv_videos from public,anon,authenticated;
revoke select(submitted_by,storage_path,storage_mime,file_size_bytes,consent_confirmed,rights_confirmed,review_notes,reviewed_by,submitted_at,reviewed_at,created_at,updated_at,moderation_decision,moderation_reason_codes,moderation_category_scores,moderation_provider_flagged,moderation_frame_count,moderation_model,moderation_details,moderation_attempt_count,moderation_started_at,moderation_completed_at)on public.mydancr_tv_videos from public,anon,authenticated;
grant select(id,dancer_id,venue_id,shift_id,caption,duration_seconds,width,height,status,venue_tag_status,venue_featured,published_at,expires_at,distribution_scope,like_count,is_pinned)on public.mydancr_tv_videos to anon,authenticated;
do $guard$ begin
 if exists(select 1 from pg_attribute a cross join unnest(array['anon','authenticated'])r where a.attrelid='public.mydancr_tv_videos'::regclass and a.attnum>0 and not a.attisdropped and has_column_privilege(r,a.attrelid,a.attname,'SELECT')is distinct from(a.attname=any(array['id','dancer_id','venue_id','shift_id','caption','duration_seconds','width','height','status','venue_tag_status','venue_featured','published_at','expires_at','distribution_scope','like_count','is_pinned'])))then raise exception 'PUBLIC_TV_ACCESS_MISMATCH';end if;
 if not has_table_privilege('service_role','public.mydancr_tv_videos','SELECT')then raise exception 'PUBLIC_TV_SERVICE_REQUIRED';end if;
end $guard$;
commit;
