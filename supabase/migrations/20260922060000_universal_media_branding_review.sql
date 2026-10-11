begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Independent publication gate: branding approval never overrides safety,
-- account visibility, copyright holds, or a newer replacement upload.
create table public.media_branding_reviews (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  media_kind text not null check (media_kind in ('avatar','photo','video')),
  target_id uuid not null,
  storage_path text not null check (length(storage_path) between 1 and 1024),
  policy_version integer not null default 1 check (policy_version = 1),
  status text not null default 'queued' check (status in ('queued','processing','clear','review','approved','rejected','superseded')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  locked_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  reviewed_by uuid references public.app_users(id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(media_kind,target_id,storage_path,policy_version)
);
alter table public.media_branding_reviews enable row level security;
revoke all on public.media_branding_reviews from public, anon, authenticated, service_role;
grant select on public.media_branding_reviews to service_role;
create index media_branding_queue_idx on public.media_branding_reviews(status,next_attempt_at,created_at);
create index media_branding_path_idx on public.media_branding_reviews(storage_path,media_kind,status);

create function public.branding_media_is_current(p_kind text,p_target uuid,p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'avatar' then exists(select 1 from public.dancer_profiles where id=p_target and avatar_storage_path=p_path)
    when 'photo' then exists(select 1 from public.dancer_photos where id=p_target and storage_path=p_path)
    when 'video' then exists(select 1 from public.mydancr_tv_videos where id=p_target and storage_path=p_path)
    else false end;
$$;
revoke all on function public.branding_media_is_current(text,uuid,text) from public,anon,authenticated,service_role;

create function public.enqueue_media_branding_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_dancer uuid; v_path text;
begin
  if tg_table_name='dancer_profiles' then
    v_kind:='avatar'; v_dancer:=new.id; v_path:=new.avatar_storage_path;
  else
    v_kind:=case tg_table_name when 'dancer_photos' then 'photo' else 'video' end;
    v_dancer:=new.dancer_id; v_path:=new.storage_path;
    if v_kind='video' and new.status in ('uploading','rejected') then return new; end if;
  end if;
  if nullif(trim(v_path),'') is not null then
    insert into public.media_branding_reviews(dancer_id,media_kind,target_id,storage_path)
      values(v_dancer,v_kind,new.id,v_path) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_media_branding_review() from public,anon,authenticated,service_role;
create trigger enqueue_avatar_branding after insert or update of avatar_storage_path on public.dancer_profiles
  for each row execute function public.enqueue_media_branding_review();
create trigger enqueue_photo_branding after insert or update of storage_path on public.dancer_photos
  for each row execute function public.enqueue_media_branding_review();
create trigger enqueue_video_branding after insert or update of storage_path,status on public.mydancr_tv_videos
  for each row execute function public.enqueue_media_branding_review();

-- One-time scan of existing media. Preserve every account, object and original
-- moderation decision. Storage objects remain private throughout the scan.
insert into public.media_branding_reviews(dancer_id,media_kind,target_id,storage_path)
select id,'avatar',id,avatar_storage_path from public.dancer_profiles where nullif(trim(avatar_storage_path),'') is not null
union all select dancer_id,'photo',id,storage_path from public.dancer_photos
union all select dancer_id,'video',id,storage_path from public.mydancr_tv_videos where status not in ('uploading','rejected')
on conflict do nothing;

create function public.is_dancer_media_branding_clear(p_kind text,p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.media_branding_reviews
    where storage_path=p_path and policy_version=1 and status in ('clear','approved')
      and case when p_kind='photo' then media_kind in ('avatar','photo') else media_kind='video' and p_kind='video' end);
$$;
revoke all on function public.is_dancer_media_branding_clear(text,text) from public,anon,authenticated,service_role;
grant execute on function public.is_dancer_media_branding_clear(text,text) to anon,authenticated,service_role;

create policy "Photos require branding clearance" on public.dancer_photos as restrictive for select to anon,authenticated
  using (public.is_current_dancer_owner(dancer_id) or public.is_admin()
    or public.is_dancer_media_branding_clear('photo',storage_path));
create policy "Videos require branding clearance" on public.mydancr_tv_videos as restrictive for select to anon,authenticated
  using (public.is_current_dancer_owner(dancer_id) or public.is_admin()
    or public.is_dancer_media_branding_clear('video',storage_path));

create function public.claim_media_branding_review()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.media_branding_reviews;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service authorization required' using errcode='42501'; end if;
  select * into v_row from public.media_branding_reviews
    where (status='queued' and next_attempt_at<=clock_timestamp())
       or (status='processing' and locked_at<clock_timestamp()-interval '5 minutes')
    order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  if not public.branding_media_is_current(v_row.media_kind,v_row.target_id,v_row.storage_path) then
    update public.media_branding_reviews set status='superseded',version=version+1,updated_at=clock_timestamp(),lease_token=null,locked_at=null where id=v_row.id returning * into v_row;
  elsif v_row.attempts>=3 then
    update public.media_branding_reviews set status='review',evidence='{"reason":"Automatic branding checks could not finish. Review the full media."}',
      version=version+1,updated_at=clock_timestamp(),lease_token=null,locked_at=null where id=v_row.id returning * into v_row;
  else
    update public.media_branding_reviews set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),locked_at=clock_timestamp(),
      version=version+1,updated_at=clock_timestamp() where id=v_row.id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.claim_media_branding_review() from public,anon,authenticated;
grant execute on function public.claim_media_branding_review() to service_role;

create function public.finish_media_branding_review(p_id uuid,p_lease uuid,p_result text,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.media_branding_reviews; v_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service authorization required' using errcode='42501'; end if;
  if p_result is null or p_result not in ('clear','review','retry') or jsonb_typeof(p_evidence) is distinct from 'object'
    or length(p_evidence::text)>16000 then raise exception 'Invalid branding result' using errcode='22023'; end if;
  select * into v_row from public.media_branding_reviews where id=p_id for update;
  if not found or v_row.status<>'processing' or v_row.lease_token is distinct from p_lease or p_lease is null then
    raise exception 'Branding worker lease changed' using errcode='40001';
  end if;
  if p_result='clear' and (p_evidence->>'finding' is distinct from 'none'
    or jsonb_typeof(p_evidence->'confidence') is distinct from 'number'
    or (p_evidence->>'confidence')::numeric<0.95 or (p_evidence->>'confidence')::numeric>1) then
    raise exception 'Branding clearance evidence required' using errcode='22023';
  end if;
  v_status:=case when not public.branding_media_is_current(v_row.media_kind,v_row.target_id,v_row.storage_path) then 'superseded'
    when p_result='retry' then case when v_row.attempts>=3 then 'review' else 'queued' end else p_result end;
  update public.media_branding_reviews set status=v_status,evidence=p_evidence,lease_token=null,locked_at=null,
    next_attempt_at=clock_timestamp()+interval '1 minute',version=version+1,updated_at=clock_timestamp()
    where id=p_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.finish_media_branding_review(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_media_branding_review(uuid,uuid,text,jsonb) to service_role;

create function public.review_media_branding(p_actor uuid,p_id uuid,p_version bigint,p_decision text,p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.media_branding_reviews;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.app_users
    where id=p_actor and role='admin' and account_state='active' and dmca_suspended_at is null) then
    raise exception 'Active administrator required' using errcode='42501';
  end if;
  if p_decision is null or p_decision not in ('approved','rejected') or nullif(trim(p_notes),'') is null or length(p_notes)>2000 then
    raise exception 'A decision and review notes are required' using errcode='22023';
  end if;
  select * into v_row from public.media_branding_reviews where id=p_id for update;
  if not found or v_row.status<>'review' or v_row.version is distinct from p_version
    or not public.branding_media_is_current(v_row.media_kind,v_row.target_id,v_row.storage_path) then
    raise exception 'Media or branding review changed. Refresh the queue.' using errcode='40001';
  end if;
  update public.media_branding_reviews set status=p_decision,reviewed_by=p_actor,reviewed_at=clock_timestamp(),review_notes=trim(p_notes),
    version=version+1,updated_at=clock_timestamp() where id=p_id returning * into v_row;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_actor,'media_branding',p_id,'branding_'||p_decision,trim(p_notes));
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.review_media_branding(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.review_media_branding(uuid,uuid,bigint,text,text) to service_role;
notify pgrst,'reload schema';
commit;
