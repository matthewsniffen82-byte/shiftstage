begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Serialize media publication with cleanup claims across derivative paths and buckets.
create function private.retention_media_member(b text,p text,target_bucket text,target_path text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select (b=target_bucket and (p=target_path or starts_with(target_path,p||'.') or b='mydancr-tv-videos' and target_path='__originals/'||p))
 or (target_bucket='dancr-media-originals' and target_path=b||'/'||p)
 or (b='mydancr-tv-videos' and target_bucket='dancer-photos' and target_path='tv-posters/'||regexp_replace(p,'\.[a-zA-Z0-9]+$','.poster.webp'));
$$;
revoke all on function private.retention_media_member(text,text,text,text) from public,anon,authenticated;
grant execute on function private.retention_media_member(text,text,text,text) to service_role;
create or replace function private.track_retention_media() returns trigger language plpgsql security definer set search_path='' as $$
declare before_path text:=to_jsonb(old)->>tg_argv[1]; after_path text:=to_jsonb(new)->>tg_argv[1];
begin
 if tg_table_schema<>'public' then raise exception 'Invalid media retention trigger'; end if;
 if tg_op<>'DELETE' and after_path is not null and after_path is distinct from before_path then
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Media publication requires read committed'; end if;
  perform pg_advisory_xact_lock(71031,91);
  perform pg_advisory_xact_lock(hashtextextended(tg_argv[0]||'/'||after_path,71));
  if exists(select 1 from public.retention_media_jobs where state in ('deleting','completed') and private.retention_media_member(bucket,storage_path,tg_argv[0],after_path)) then
   raise exception 'Retired media path cannot be reused';
  end if;
 end if;
 if before_path is not null and (tg_op='DELETE' or before_path is distinct from after_path) then
  perform pg_advisory_xact_lock(hashtextextended(tg_argv[0]||'/'||before_path,71));
  insert into public.retention_media_jobs(bucket,storage_path,family) values(tg_argv[0],before_path,tg_argv[2]) on conflict(bucket,storage_path) do nothing;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create or replace function private.retention_media_referenced(b text,p text) returns boolean language sql stable security invoker set search_path='' as $$
 select case b
 when 'dancer-photos' then exists(select 1 from public.dancer_photos where storage_path=p or starts_with(storage_path,p||'.'))
  or exists(select 1 from public.dancer_profiles where avatar_storage_path=p or starts_with(avatar_storage_path,p||'.') or avatar_source_storage_path=p)
  or exists(select 1 from public.image_moderation_records where final_storage_path=p or starts_with(final_storage_path,p||'.'))
 when 'mydancr-tv-videos' then exists(select 1 from public.mydancr_tv_videos where storage_path=p or starts_with(storage_path,p||'.'))
  or exists(select 1 from public.dancer_photos where storage_path='tv-posters/'||regexp_replace(p,'\.[a-zA-Z0-9]+$','.poster.webp'))
  or exists(select 1 from public.dancer_profiles where avatar_storage_path='tv-posters/'||regexp_replace(p,'\.[a-zA-Z0-9]+$','.poster.webp'))
 when 'dancr-image-moderation-temp' then exists(select 1 from public.image_moderation_records where temporary_storage_path=p)
 when 'dancr-image-moderation-review' then exists(select 1 from public.image_moderation_records where temporary_storage_path=p)
 when 'dancer-photo-uploads' then exists(select 1 from public.photo_upload_reservations where storage_path=p or starts_with(storage_path,p||'.'))
 when 'venue-ownership-proofs' then exists(select 1 from public.venue_ownership_claims where proof_storage_path=p)
 when 'venue-cover-images' then exists(select 1 from public.venues where cover_image_storage_path=p)
 when 'venue-logo-images' then exists(select 1 from public.venues where logo_storage_path=p)
 when 'venue-qr-codes' then exists(select 1 from public.venues where qr_code_storage_path=p)
 else true end;
$$;

create or replace function public.claim_retention_media() returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' set statement_timeout='10s' as $$
declare j public.retention_media_jobs; result jsonb:='[]';
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Media cleanup requires read committed'; end if;
 perform pg_advisory_xact_lock(71031,91);
 if not pg_try_advisory_xact_lock(71031,90) then return result; end if;
 if exists(select 1 from public.compliance_records where kind='hold' and status<>'completed') then return result; end if;
 if not exists(select 1 from public.lifecycle_retention_rules r join public.compliance_records p on p.id=r.policy_id and p.revision=r.policy_revision
  where r.source='dancer_photos' and r.enabled and p.status='verified') then return result; end if;
 for j in select * from public.retention_media_jobs where state<>'completed' and next_attempt_at<=now() and (lease_until is null or lease_until<now())
  order by next_attempt_at,id limit 20 for update skip locked loop
  perform pg_advisory_xact_lock(hashtextextended(j.bucket||'/'||j.storage_path,71));
  if private.retention_media_referenced(j.bucket,j.storage_path) or exists(select 1 from public.safety_media_restrictions where private.retention_media_member(j.bucket,j.storage_path,bucket,storage_path)) then
   update public.retention_media_jobs set next_attempt_at=now()+interval '1 hour',error_code='reference_or_restriction' where id=j.id; continue;
  end if;
  update public.retention_media_jobs set state='deleting',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=j.id returning * into j;
  result:=result||jsonb_build_array(to_jsonb(j));
 end loop;
 return result;
end $$;

notify pgrst,'reload schema';
commit;
