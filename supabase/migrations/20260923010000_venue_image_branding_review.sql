begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.image_moderation_records add column venue_media_context jsonb;
comment on column public.image_moderation_records.venue_media_context is
  'Server-owned venue image target and expected prior image version for private human review.';

create function public.publish_reviewed_venue_image(
  p_record_id uuid, p_expected_updated_at timestamptz, p_storage_path text, p_reviewer_id uuid, p_notes text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  r public.image_moderation_records%rowtype;
  v public.venues%rowtype;
  target_id uuid; kind text; current_path text; current_stamp timestamptz; bucket text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
  if not exists(select 1 from public.app_users where id=p_reviewer_id and role='admin' and account_state='active') then
    raise exception 'Active administrator required' using errcode='42501';
  end if;
  if p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or p_storage_path is null or length(p_storage_path) not between 1 and 1024
    or p_storage_path<>btrim(p_storage_path) or p_storage_path ~ '(^|/)\.\.(/|$)'
    or length(btrim(coalesce(p_notes,''))) not between 3 and 4000 then
    raise exception 'Invalid review input' using errcode='22023';
  end if;
  select (venue_media_context->>'venueId')::uuid into target_id from public.image_moderation_records where id=p_record_id;
  select * into v from public.venues where id=target_id for update;
  if not found then raise exception 'Venue missing' using errcode='P0002';end if;
  select * into r from public.image_moderation_records where id=p_record_id for update;
  kind:=r.venue_media_context->>'kind';
  if r.updated_at is distinct from p_expected_updated_at or r.decision<>'review' or r.status<>'pending_review'
    or kind not in ('cover','logo') or kind is null or r.upload_context<>('venue_'||kind)
    or (r.venue_media_context->>'venueId')::uuid is distinct from v.id then
    raise exception 'Review changed' using errcode='40001';
  end if;
  current_path:=case when kind='logo' then v.logo_storage_path else v.cover_image_storage_path end;
  current_stamp:=case when kind='logo' then v.logo_updated_at else v.cover_image_updated_at end;
  if current_path is distinct from (r.venue_media_context->>'expectedPath')
    or current_stamp is distinct from (r.venue_media_context->>'expectedUpdatedAt')::timestamptz then
    raise exception 'Venue image changed' using errcode='40001';
  end if;
  bucket:=case when kind='logo' then 'venue-logo-images' else 'venue-cover-images' end;
  if left(p_storage_path,length(v.id::text)+1)<>v.id::text||'/'
    or not exists(select 1 from storage.objects where bucket_id=bucket and name=p_storage_path)
    or not exists(select 1 from storage.objects where bucket_id='dancr-image-moderation-review' and name=r.temporary_storage_path) then
    raise exception 'Review image missing' using errcode='P0002';
  end if;
  update public.venues set
    logo_storage_path=case when kind='logo' then p_storage_path else logo_storage_path end,
    logo_updated_at=case when kind='logo' then clock_timestamp() else logo_updated_at end,
    cover_image_storage_path=case when kind='cover' then p_storage_path else cover_image_storage_path end,
    cover_image_updated_at=case when kind='cover' then clock_timestamp() else cover_image_updated_at end,
    page_review_status=case when is_active then page_review_status else 'admin_draft' end,
    page_review_sent_at=case when is_active then page_review_sent_at else null end,
    page_reviewed_at=case when is_active then page_reviewed_at else null end,
    page_reviewed_by_user_id=case when is_active then page_reviewed_by_user_id else null end,
    page_review_notes=case when is_active then page_review_notes else null end
  where id=v.id;
  update public.image_moderation_records set decision='approved',status='approved',final_storage_path=p_storage_path,
    reviewed_by=p_reviewer_id,reviewed_at=clock_timestamp(),review_decision='approved',review_notes=btrim(p_notes),updated_at=clock_timestamp()
    where id=r.id returning * into r;
  return to_jsonb(r);
end;
$$;
revoke all on function public.publish_reviewed_venue_image(uuid,timestamptz,text,uuid,text) from public,anon,authenticated;
grant execute on function public.publish_reviewed_venue_image(uuid,timestamptz,text,uuid,text) to service_role;
commit;
