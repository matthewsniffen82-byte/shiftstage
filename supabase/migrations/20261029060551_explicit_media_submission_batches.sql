begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Immutable dancer submissions, with an independent review at each club.
create table public.dancer_media_submissions (
 id uuid primary key default gen_random_uuid(),
 dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 150),
 created_at timestamptz not null default now()
);
create index dancer_media_submissions_dancer on public.dancer_media_submissions(dancer_id,created_at);
create table public.dancer_media_batches (
 id uuid primary key default gen_random_uuid(),
 dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete cascade,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 150),
 state text not null default 'club' check(state in ('club','admin','completed')),
 revision uuid not null default gen_random_uuid(),
 club_decisions jsonb not null default '{}', admin_decisions jsonb not null default '{}',
 club_submitted_by uuid references public.app_users(id), club_submitted_at timestamptz,
 admin_submitted_by uuid references public.app_users(id), completed_at timestamptz,
 result jsonb, created_at timestamptz not null default now()
);
create index dancer_media_batches_dancer on public.dancer_media_batches(dancer_id,created_at);
create index dancer_media_batches_queue on public.dancer_media_batches(venue_id,state,created_at);
create index dancer_media_batches_club_actor on public.dancer_media_batches(club_submitted_by);
create index dancer_media_batches_admin_actor on public.dancer_media_batches(admin_submitted_by);
alter table public.dancer_media_submissions enable row level security;
alter table public.dancer_media_batches enable row level security;
revoke all on public.dancer_media_submissions,public.dancer_media_batches from public,anon,authenticated;
grant select,insert,update,delete on public.dancer_media_submissions,public.dancer_media_batches to service_role;
create policy dancer_media_submissions_service on public.dancer_media_submissions to service_role using(true) with check(true);
create policy dancer_media_batches_service on public.dancer_media_batches to service_role using(true) with check(true);

create function private.media_batch_authorize(p_actor uuid,p_role text,p_venue uuid,p_dancer uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_role='admin' then
  if not exists(select 1 from public.app_users where id=p_actor and role='admin' and account_state='active'
   and admin_workspace_role in ('owner','reviewer')) then raise exception 'MEDIA_BATCH_FORBIDDEN' using errcode='42501';end if;
 elsif p_role='venue' and p_venue is not null then
  perform public.assert_dancer_media_reviewer(p_actor,(select user_id from public.dancer_profiles where id=p_dancer),p_venue);
 elsif p_role='dancer' then
  if not exists(select 1 from public.app_users a join public.dancer_profiles d on d.user_id=a.id
   where a.id=p_actor and a.role='dancer' and a.account_state='active' and d.disabled_at is null
   and (p_dancer is null or d.id=p_dancer)) then raise exception 'MEDIA_BATCH_FORBIDDEN' using errcode='42501';end if;
 else raise exception 'MEDIA_BATCH_FORBIDDEN' using errcode='42501';end if;
end $$;

-- A snapshot carries identity/version only. Storage paths and signed URLs are
-- read afresh after authorization, never accepted from a browser.
create function private.media_batch_snapshot(p_dancer uuid) returns table(item jsonb,submitted boolean,published boolean)
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('key',m.source||':'||m.id,'id',m.id,'source',m.source,'kind',m.kind,
  'version',m.content_version,'isMain',m.is_main),
 exists(select 1 from public.dancer_media_submissions s cross join lateral jsonb_array_elements(s.items) x
  where s.dancer_id=p_dancer and x->>'key'=m.source||':'||m.id and x->>'version'=m.content_version),
 m.record->>'status'='approved'
 from public.dancer_club_media(array[p_dancer]) m
$$;

-- Called at submission and by the existing email preparation job. A new club
-- receives published media plus explicit submissions, never unfinished uploads.
create function private.attach_media_batches(p_venue uuid default null,p_dancer uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
declare v record; d record; snapshot jsonb; batch uuid;
begin
 for v in select id,name from public.venues where is_active and (p_venue is null or id=p_venue) loop
  for d in select distinct dp.id,dp.stage_name,dp.status from public.dancer_profiles dp
   join public.venue_media_dancers(v.id) connected on connected.user_id=dp.user_id
   where dp.disabled_at is null and (p_dancer is null or dp.id=p_dancer)
  loop
   perform 1 from public.dancer_profiles where id=d.id for update;
   select jsonb_agg(s.item order by s.item->>'key') into snapshot from private.media_batch_snapshot(d.id) s
   where (s.submitted or s.published)
    and not exists(select 1 from public.club_media_permissions c where (s.published or not s.submitted) and d.status='approved' and c.venue_id=v.id
     and c.source=s.item->>'source' and c.media_id=(s.item->>'id')::uuid and c.content_version=s.item->>'version')
    and not exists(select 1 from public.dancer_media_batches b cross join lateral jsonb_array_elements(b.items) x
     where b.dancer_id=d.id and b.venue_id=v.id and x->>'key'=s.item->>'key' and x->>'version'=s.item->>'version');
   if snapshot is not null then
    insert into public.dancer_media_batches(dancer_id,venue_id,items) values(d.id,v.id,snapshot) returning id into batch;
    update public.dancer_media_batches set club_decisions=coalesce((
      select jsonb_object_agg(x->>'key',jsonb_build_object('decision',c.decision,'notes',coalesce(c.notes,''),'actor',c.reviewer_id))
      from jsonb_array_elements(snapshot) x join public.club_media_permissions c
       on c.venue_id=v.id and c.source=x->>'source' and c.media_id=(x->>'id')::uuid and c.content_version=x->>'version'
    ),'{}'::jsonb) where id=batch;
    perform private.emit_venue_email_event(v.id,'media-submission:'||batch,'venue_media_pending','Dancer media ready for review',
     d.stage_name||' submitted a batch of '||jsonb_array_length(snapshot)||' media items. Review the batch, then select Submit review.',
     '/dashboard/venue#venue-media-reviews');
   end if;
  end loop;
 end loop;
end $$;

create function public.submit_dancer_media_batch(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d uuid; snapshot jsonb; submission uuid;
begin
 perform private.media_batch_authorize(p_actor,'dancer',null);
 select id into d from public.dancer_profiles where user_id=p_actor for update;
 if exists(select 1 from public.image_moderation_records where user_id=p_actor and upload_context like 'profile_%'
   and status in ('pending','moderating','moderation_retry'))
  or exists(select 1 from public.mydancr_tv_videos where dancer_id=d and (status='moderating' or upload_validation_pending))
 then raise exception 'Wait for media processing to finish before submitting.' using errcode='22023';end if;
 select jsonb_agg(item order by item->>'key') into snapshot from private.media_batch_snapshot(d) where not submitted and not published;
 if snapshot is not null then
  insert into public.dancer_media_submissions(dancer_id,items) values(d,snapshot) returning id into submission;
 end if;
 perform private.attach_media_batches(null,d);
 return jsonb_build_object('submitted',coalesce(jsonb_array_length(snapshot),0),'submissionId',submission);
end $$;

create function public.get_media_batches(p_actor uuid,p_role text,p_venue uuid default null,p_dancer uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; own_dancer uuid; drafts integer:=0;
begin
 perform private.media_batch_authorize(p_actor,p_role,p_venue,p_dancer);
 if p_role='dancer' then
  select id into own_dancer from public.dancer_profiles where user_id=p_actor;
  select count(*) into drafts from private.media_batch_snapshot(own_dancer) where not submitted and not published;
 elsif p_role='venue' then perform private.attach_media_batches(p_venue,p_dancer);end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at),'[]') into result from (
  select b.id,b.dancer_id,b.venue_id,b.state,b.revision,b.created_at,b.result,d.stage_name,v.name venue_name,
   jsonb_array_length(b.items) item_count from public.dancer_media_batches b
   join public.dancer_profiles d on d.id=b.dancer_id join public.venues v on v.id=b.venue_id
   where (p_dancer is null or b.dancer_id=p_dancer)
    and case p_role when 'dancer' then b.dancer_id=own_dancer
      when 'venue' then b.venue_id=p_venue and b.state='club' else b.state='admin' and (p_venue is null or b.venue_id=p_venue) end
   order by case when p_role='dancer' then b.created_at end desc,b.created_at,b.id limit 100
 ) q;
 return jsonb_build_object('batches',result,'draftCount',drafts,'waitingForClub',p_role='dancer' and exists(
  select 1 from public.dancer_media_submissions s cross join lateral jsonb_array_elements(s.items) x where s.dancer_id=own_dancer
   and not exists(select 1 from public.dancer_media_batches b cross join lateral jsonb_array_elements(b.items) y
    where b.dancer_id=own_dancer and y->>'key'=x->>'key' and y->>'version'=x->>'version')));
end $$;

create function public.get_media_batch(p_actor uuid,p_role text,p_batch uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b public.dancer_media_batches; rows jsonb;
begin
 select * into b from public.dancer_media_batches where id=p_batch;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,p_role,b.venue_id,b.dancer_id);
 if p_role='admin' and b.state='club' then raise exception 'Club must submit this review first.' using errcode='42501';end if;
 select jsonb_agg(x||jsonb_build_object('record',m.record,
  'withdrawn',m.id is null,'resolved',m.record->>'status'='approved',
  'club',b.club_decisions->(x->>'key'),'admin',b.admin_decisions->(x->>'key')) order by x->>'isMain' desc,x->>'key') into rows
 from jsonb_array_elements(b.items) x left join public.dancer_club_media(array[b.dancer_id]) m
 on m.id=(x->>'id')::uuid and m.source=x->>'source' and m.content_version=x->>'version';
 return to_jsonb(b)||jsonb_build_object('items',rows);
end $$;

create function public.save_media_batch_decision(p_actor uuid,p_role text,p_batch uuid,p_revision uuid,p_key text,p_decision text,p_notes text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.dancer_media_batches; choices jsonb;
begin
 select * into b from public.dancer_media_batches where id=p_batch for update;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,p_role,b.venue_id,b.dancer_id);
 if p_role not in ('venue','admin') or b.state<>(case p_role when 'venue' then 'club' else 'admin' end)
  or b.revision<>p_revision then raise exception 'This batch changed. Refresh before continuing.' using errcode='40001';end if;
 if p_decision not in ('approved','rejected') or length(p_notes)>4000
  or not exists(select 1 from jsonb_array_elements(b.items) x where x->>'key'=p_key)
  or (p_role='admin' and b.club_decisions->p_key->>'decision' is distinct from 'approved')
 then raise exception 'Choose a submitted item and a valid decision.' using errcode='22023';end if;
 choices:=jsonb_build_object(p_key,jsonb_build_object('decision',p_decision,'notes',btrim(p_notes),'actor',p_actor));
 update public.dancer_media_batches set revision=gen_random_uuid(),
  club_decisions=case when p_role='venue' then club_decisions||choices else club_decisions end,
  admin_decisions=case when p_role='admin' then admin_decisions||choices else admin_decisions end
 where id=p_batch returning * into b;
 return jsonb_build_object('id',b.id,'revision',b.revision);
end $$;

create function private.media_batch_admin_email(p_batch uuid,p_name text) returns void
language plpgsql security invoker set search_path='' as $$
declare k text:='media-batch:'||p_batch; recipient uuid; notice uuid; title text:='Media batch awaiting final review';
 message text:=p_name||' has a completed club review. Review all items, then select Submit review to finish.';
begin
 insert into public.admin_review_email_events(event_key,kind,source_id,title,body)
 values(k,'media_approval',p_batch,title,message) on conflict do nothing;
 if not found then return;end if;
 for recipient in select id from public.app_users where role='admin' and account_state='active' and admin_workspace_role in ('owner','reviewer') loop
  insert into public.notifications(recipient_id,notification_type,channel,title,body,payload)
  values(recipient,'support_message','in_app',title,message,jsonb_build_object('kind','admin_review','reviewKind','media_approval','sourceId',p_batch,'emailPath','/admin?alert=media_approval')) returning id into notice;
  insert into public.admin_review_email_deliveries(event_key,recipient_id,notification_id) values(k,recipient,notice) on conflict do nothing;
 end loop;
end $$;

create function public.submit_club_media_batch(p_actor uuid,p_batch uuid,p_revision uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.dancer_media_batches; x jsonb; m record; decision jsonb; permission text;
begin
 perform 1 from public.dancer_profiles where id=(select dancer_id from public.dancer_media_batches where id=p_batch) for update;
 select * into b from public.dancer_media_batches where id=p_batch for update;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,'venue',b.venue_id,b.dancer_id);
 if b.state<>'club' then return jsonb_build_object('id',b.id,'state',b.state);end if;
 if b.revision<>p_revision then raise exception 'This batch changed. Refresh before submitting.' using errcode='40001';end if;
 perform set_config('mydancr.media_batch',b.id::text,true);
 for x in select value from jsonb_array_elements(b.items) loop
  select * into m from public.dancer_club_media(array[b.dancer_id]) where id=(x->>'id')::uuid and source=x->>'source' and content_version=x->>'version';
  if not found then continue;end if;
  decision:=b.club_decisions->(x->>'key');
  if decision->>'decision' is null then raise exception 'Review every item before submitting.' using errcode='22023';end if;
  select revision::text into permission from public.club_media_permissions where venue_id=b.venue_id and source=m.source and media_id=m.id;
  perform public.set_club_media_permission(p_actor,b.venue_id,b.dancer_id,m.source,m.id,m.content_version,permission,decision->>'decision',decision->>'notes');
 end loop;
 update public.dancer_media_batches set state='admin',revision=gen_random_uuid(),club_submitted_by=p_actor,club_submitted_at=now() where id=b.id;
 perform private.media_batch_admin_email(b.id,(select stage_name from public.dancer_profiles where id=b.dancer_id));
 return jsonb_build_object('id',b.id,'state','admin');
end $$;

-- Every final decision and the result receipt commit together. Prepared files
-- are produced before calling this RPC; no storage/network work holds locks.
create function public.submit_admin_media_batch(p_actor uuid,p_batch uuid,p_revision uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.dancer_media_batches; d public.dancer_profiles; x jsonb; m record; r public.image_moderation_records;
 choice jsonb; rejected jsonb:='[]'; v_result jsonb; ready boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||(select dp.user_id::text from public.dancer_profiles dp join public.dancer_media_batches mb on mb.dancer_id=dp.id where mb.id=p_batch),0));
 select * into d from public.dancer_profiles where id=(select dancer_id from public.dancer_media_batches where id=p_batch) for update;
 select * into b from public.dancer_media_batches where id=p_batch for update;
 if not found then raise exception 'MEDIA_BATCH_MISSING' using errcode='P0002';end if;
 perform private.media_batch_authorize(p_actor,'admin',b.venue_id,b.dancer_id);
 if b.state='completed' then return jsonb_build_object('id',b.id,'state',b.state,'result',b.result);end if;
 if b.state<>'admin' or b.revision<>p_revision then raise exception 'This batch changed. Refresh before submitting.' using errcode='40001';end if;
 if d.disabled_at is not null or d.status not in ('pending_review','approved') or not exists(select 1 from public.app_users where id=d.user_id and account_state='active') then
  raise exception 'This dancer account is not eligible for publication.' using errcode='42501';end if;
 perform set_config('mydancr.media_batch',b.id::text,true);
 for x in select value from jsonb_array_elements(b.items) order by value->>'isMain' desc,value->>'key' loop
  if x->>'source'='upload' then perform 1 from public.image_moderation_records where id=(x->>'id')::uuid for update;
  elsif x->>'source'='video' then perform 1 from public.mydancr_tv_videos where id=(x->>'id')::uuid for update;end if;
  select * into m from public.dancer_club_media(array[b.dancer_id]) where id=(x->>'id')::uuid and source=x->>'source' and content_version=x->>'version';
  if not found then continue;end if;
  if b.club_decisions->(x->>'key')->>'decision'='rejected' then
   rejected:=rejected||jsonb_build_array(jsonb_build_object('targetType',m.kind,'targetId',m.id,'isMain',m.is_main,'reviewScope','club'));continue;
  end if;
  if m.record->>'status'='approved' then continue;end if;
  choice:=b.admin_decisions->(x->>'key');
  if choice->>'decision' is null then raise exception 'Review every item before submitting.' using errcode='22023';end if;
  if choice->>'decision'='rejected' then
   rejected:=rejected||jsonb_build_array(jsonb_build_object('targetType',m.kind,'targetId',m.id,'isMain',m.is_main,'reviewScope','platform'));
   if m.source='upload' then
    update public.image_moderation_records set decision='rejected',status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_decision='rejected',review_notes=nullif(choice->>'notes',''),updated_at=clock_timestamp() where id=m.id;
   else update public.mydancr_tv_videos set status='rejected',reviewed_by=p_actor,reviewed_at=now(),review_notes=nullif(choice->>'notes',''),published_at=null,expires_at=null,venue_featured=false where id=m.id;end if;
  elsif m.source='upload' then
   select * into r from public.image_moderation_records where id=m.id for update;
   if r.category_flags->>'publication_prepared' is distinct from 'true' or r.final_storage_path is null then
    raise exception 'Finish preparing this photo before submitting.' using errcode='22023';end if;
   if r.upload_context='profile_avatar' then
    perform public.publish_approved_dancer_avatar(r.id,r.updated_at,r.final_storage_path,r.reason_codes,r.category_flags,r.category_scores,r.provider_flagged,p_actor,choice->>'notes',d.avatar_storage_path,d.avatar_updated_at);
   else
    perform public.publish_approved_dancer_gallery_photo(r.id,r.updated_at,r.final_storage_path,r.reason_codes,r.category_flags,r.category_scores,r.provider_flagged,null,p_actor,choice->>'notes');
   end if;
  elsif m.source='video' then
   if (m.record->>'duration_seconds')::numeric>30 or m.record->'moderation_details'->'preparedPublication'->>'storagePath' is distinct from m.record->>'storage_path' then
    raise exception 'Finish preparing this video before submitting.' using errcode='22023';end if;
   update public.mydancr_tv_videos set status='approved',reviewed_by=p_actor,reviewed_at=now(),review_notes=nullif(choice->>'notes',''),published_at=now(),expires_at=now()+interval '90 days' where id=m.id;
  end if;
 end loop;
 update public.dancer_media_batches set state='completed',revision=gen_random_uuid(),admin_submitted_by=p_actor,completed_at=now() where id=b.id;
 select count(*)>=3 and coalesce(bool_or(is_primary),false) into ready from public.dancer_photos where dancer_id=d.id and review_status='approved';
 ready:=ready and exists(select 1 from public.mydancr_tv_videos where dancer_id=d.id and status='approved' and distribution_scope='profile_and_feed');
 if ready then perform public.finalize_pending_dancer_nfc_enrollment(d.user_id,null,'{}');end if;
 v_result:=private.dancer_media_review_outcome(d.user_id,rejected);
 update public.dancer_media_batches set result=v_result||jsonb_build_object('batchId',b.id) where id=b.id;
 insert into public.dancer_media_email_deliveries(recipient_id,title,body,payload)
 values(d.user_id,v_result->>'title',v_result->>'body',v_result||jsonb_build_object('kind','dancer_media_batch_result','batchId',b.id,'dancerId',d.id,'items',rejected));
 return jsonb_build_object('id',b.id,'state','completed','result',v_result);
end $$;

-- Block old per-item endpoints from publishing or forwarding dancer media.
create function private.require_media_batch_submit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare n jsonb:=to_jsonb(new); o jsonb:=to_jsonb(old); batch uuid;
begin
 if tg_table_name='image_moderation_records' and n->>'upload_context' not like 'profile_%' then return new;end if;
 if ((n->>'status' in ('approved','rejected') and n->>'status' is distinct from o->>'status' and n->>'reviewed_by' is not null)
  or (n->>'club_reviewed_at' is not null and o->>'club_reviewed_at' is null)) then
  batch:=nullif(current_setting('mydancr.media_batch',true),'')::uuid;
  if not exists(select 1 from public.dancer_media_batches b cross join lateral jsonb_array_elements(b.items) x
    where b.id=batch and b.state in ('club','admin') and x->>'id'=n->>'id') then
   raise exception 'Save decisions in the media batch, then select Submit review.' using errcode='42501';end if;
 end if;
 return new;
end $$;
create trigger require_photo_batch_submit before update on public.image_moderation_records for each row execute function private.require_media_batch_submit();
create trigger require_video_batch_submit before update on public.mydancr_tv_videos for each row execute function private.require_media_batch_submit();

-- Per-item notices remain in the inbox; outgoing email is exclusively a final
-- batch receipt, including when all uploads were accepted.
create function private.suppress_individual_media_email() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='admin_review_email_events' then
  if new.kind='media_approval' and new.event_key not like 'media-batch:%' and (
    exists(select 1 from public.image_moderation_records where id=new.source_id and upload_context like 'profile_%')
    or exists(select 1 from public.mydancr_tv_videos where id=new.source_id and dancer_id is not null)) then return null;end if;
 elsif new.payload->>'kind' in ('dancer_media_rejected','dancer_profile_approved') then return null;
 end if;
 return new;
end $$;
create trigger batch_admin_email_only before insert on public.admin_review_email_events for each row execute function private.suppress_individual_media_email();
create trigger batch_dancer_email_only before insert on public.dancer_media_email_deliveries for each row execute function private.suppress_individual_media_email();
create unique index dancer_media_batch_result_once on public.dancer_media_email_deliveries((payload->>'batchId')) where payload->>'kind'='dancer_media_batch_result';

-- Preserve ready media already in the old queue at rollout as one submission.
insert into public.dancer_media_submissions(dancer_id,items)
select d.id,jsonb_agg(s.item) from public.dancer_profiles d cross join lateral private.media_batch_snapshot(d.id) s
where d.status in ('pending_review','approved') and not s.published group by d.id;

do $$ declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('submit_dancer_media_batch','get_media_batches','get_media_batch','save_media_batch_decision','submit_club_media_batch','submit_admin_media_batch'))
  or (n.nspname='private' and p.proname in ('media_batch_authorize','media_batch_snapshot','attach_media_batches','media_batch_admin_email','require_media_batch_submit','suppress_individual_media_email'))
 loop execute format('revoke all on function %s from public,anon,authenticated',fn);execute format('grant execute on function %s to service_role',fn);end loop;
end $$;

-- Keep weekly club alerts, replacing upload polling with submitted batches.
create or replace function public.prepare_venue_email_alerts() returns void
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare club record;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('venue-email-prepare',0)) then return; end if;
 -- Do not email an upload before its first NFC association or before file checks.
 -- Reuse the review queue's exact eligibility and content-version rules.
 for club in select v.id,v.name from public.venues v join public.app_users a on a.id=v.owner_user_id
  where v.is_active and a.account_state='active' and a.role='venue'
 loop
  perform private.attach_media_batches(club.id,null);
  perform private.prepare_venue_weekly_summary(club.id);
 end loop;
 -- Retain delivery diagnostics for 30 days, without accumulating email bodies forever.
 delete from public.venue_email_deliveries where status in ('accepted','skipped','failed') and created_at<now()-interval '30 days';
end $$;
create or replace function private.dancer_media_review_outcome(p_user uuid,p_items jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d public.dancer_profiles; photos integer; videos integer; has_main boolean; approved boolean;
 rejected_photos integer; rejected_videos integer; rejected_main boolean; club_only boolean;
 outcome text; title text; message text; action text; path text; missing text;
begin
 select * into d from public.dancer_profiles where user_id=p_user;
 if not found then return null; end if;
 select count(*),coalesce(bool_or(is_primary),false) into photos,has_main
  from public.dancer_photos where dancer_id=d.id and review_status='approved';
 select count(*) into videos from public.mydancr_tv_videos
  where dancer_id=d.id and status='approved' and distribution_scope='profile_and_feed';
 approved:=d.status='approved' and d.verification_status='approved' and d.venue_approved_at is not null
  and d.disabled_at is null and photos>=3 and videos>=1 and has_main;
 select count(distinct item->>'targetId') filter(where item->>'targetType'='photo'),
  count(distinct item->>'targetId') filter(where item->>'targetType'='video'),
  coalesce(bool_or(item->>'isMain'='true' or item->>'isAvatar'='true'),false),
  coalesce(bool_or(item->>'reviewScope'='club'),false)
 into rejected_photos,rejected_videos,rejected_main,club_only from jsonb_array_elements(p_items) item;
 if not has_main then
  outcome:='needs_main';title:='Choose a main photo to finish setup';
  message:=case when photos>=3 and videos>=1 then 'Your photos and video meet the minimum requirements. ' else '' end
   ||case when photos>0 then 'Choose an approved photo as your main photo, or upload a replacement.'
     else 'Upload a replacement main photo to continue setup.' end;
  action:=case when photos>0 then 'Choose main photo' else 'Upload main photo' end;path:='/dashboard/dancer#dancer-main-photo';
 elsif approved then
  outcome:='approved';title:='Your profile is approved';
  message:=case when rejected_photos+rejected_videos>0
   then 'Some uploads were not approved. Your approved media remains available, and replacements are optional.'
   else 'Your profile is approved. Open your dashboard to view your profile and check-in status.' end;
  if rejected_main then message:=message||' Your previous approved main photo is still in use.';end if;
  action:='View results';path:='/dashboard/dancer#dancer-photos-title';
 elsif photos<3 or videos<1 then
  outcome:='needs_media';title:='Replace media to finish setup';
  missing:=concat_ws(' and ',case when photos<3 then (3-photos)||case when 3-photos=1 then ' more approved photo' else ' more approved photos' end end,
   case when videos<1 then '1 approved video' end);
  message:='You still need '||missing||'. Your approved media stays saved. Upload replacements for the missing items.';
  action:='Replace media';path:=case when photos<3 then '/dashboard/dancer#dancer-photos-title' else '/dashboard/dancer#dancer-videos-title' end;
 else
  outcome:='media_ready';title:='Your media meets the requirements';
  message:='Your main photo, 3 photos and 1 video are approved. Open your dashboard to finish any remaining setup or check-in steps.';
  if rejected_photos+rejected_videos>0 then message:=message||' Replacing the other rejected uploads is optional.';end if;
  action:='Continue setup';path:='/dashboard/dancer';
 end if;
 if rejected_photos+rejected_videos>0 then
  message:=message||E'\n\nNot approved: '||concat_ws(' and ',
   case when rejected_photos>0 then rejected_photos||case when rejected_photos=1 then ' photo' else ' photos' end end,
   case when rejected_videos>0 then rejected_videos||case when rejected_videos=1 then ' video' else ' videos' end end)||'.';
 end if;
 if club_only then message:=message||' Club-specific decisions apply only to the club shown in your dashboard.';end if;
 return jsonb_build_object('outcome',outcome,'title',title,'body',message,'action',action,'emailPath',path,
  'approvedPhotos',photos,'approvedVideos',videos,'hasApprovedMain',has_main,
  'photoCount',rejected_photos,'videoCount',rejected_videos);
end $$;
create or replace function public.get_dancer_media_review_outcome(p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select b.result from public.dancer_media_batches b join public.dancer_profiles d on d.id=b.dancer_id
 where d.user_id=p_user and b.state='completed' order by b.completed_at desc,b.id limit 1
$$;
create or replace function public.claim_dancer_media_emails() returns table(id uuid,lease_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 -- Deadlines apply to attempted sends, never to time spent waiting for review.
 update public.dancer_media_email_deliveries q set status='failed',outcome='retry_expired',finished_at=now(),lease_id=null,lease_until=null
 where q.status in ('pending','sending') and q.destination is not null
  and (q.lease_until is null or q.lease_until<=now()) and (q.attempts>=8 or q.created_at<now()-interval '20 hours');
 -- Explicit admin submission creates the receipt.
 return query with due as (
  select q.id from public.dancer_media_email_deliveries q where q.status in ('pending','sending') and q.next_attempt_at<=now()
   and (q.payload->>'kind' in ('dancer_media_review_summary','dancer_media_batch_result') or (q.payload->>'kind'='dancer_profile_approved' and q.destination is not null))
   and (q.lease_until is null or q.lease_until<=now()) and (q.payload->>'kind'='dancer_media_batch_result' or not private.dancer_media_review_pending(q.recipient_id))
  order by q.next_attempt_at,q.id for update skip locked limit 1
 ) update public.dancer_media_email_deliveries q set status='sending',attempts=q.attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where q.id=due.id returning q.id,q.lease_id;
end $$;
create or replace function public.dancer_media_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.dancer_media_email_deliveries; email text; result jsonb;
begin
 select * into job from public.dancer_media_email_deliveries where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found then return null;end if;
 email:=private.dancer_media_email_account(job.recipient_id);
 if email is null or (job.destination is not null and job.destination<>email) then return null;end if;
 if not exists(select 1 from public.dancer_profiles where user_id=job.recipient_id and disabled_at is null) then return null;end if;
 if job.payload->>'kind'='dancer_media_batch_result' then
  if not exists(select 1 from public.dancer_media_batches b join public.dancer_profiles d on d.id=b.dancer_id
   where b.id::text=job.payload->>'batchId' and b.state='completed' and d.user_id=job.recipient_id) then return null;end if;
 elsif job.payload->>'kind'='dancer_profile_approved' and job.destination is not null then
  -- Preserve provider idempotency for approval sends already attempted at rollout.
  if not exists(select 1 from public.dancer_profiles d where d.id::text=job.payload->>'dancerId'
   and d.user_id=job.recipient_id and d.status='approved' and d.verification_status='approved'
   and d.venue_approved_at is not null and d.disabled_at is null) then return null;end if;
 elsif job.payload->>'kind'='dancer_media_review_summary' then
  if private.dancer_media_review_pending(job.recipient_id)
   or exists(select 1 from jsonb_array_elements(job.payload->'items') item where not private.dancer_media_rejection_current(job.recipient_id,item))
   or (job.destination is null and exists(select 1 from public.dancer_media_email_deliveries q
    where q.recipient_id=job.recipient_id and q.payload->>'kind' in ('dancer_media_rejected','dancer_profile_approved')
     and q.summary_id is null and q.status='pending')) then
   if job.destination is null then
    update public.dancer_media_email_deliveries set summary_id=null,status='pending',outcome=null,finished_at=null where summary_id=job.id;
   end if;
   return null;
  end if;
  if job.destination is null then
   result:=private.dancer_media_review_outcome(job.recipient_id,job.payload->'items');
   job.title:=result->>'title';job.body:=result->>'body';job.payload:=job.payload||result;
  elsif job.payload->>'outcome'='approved' and private.dancer_media_review_outcome(job.recipient_id,job.payload->'items')->>'outcome'<>'approved' then
   return null;
  end if;
 else return null;
 end if;
 update public.dancer_media_email_deliveries set destination=email,title=job.title,body=job.body,payload=job.payload where id=p_id;
 return jsonb_build_object('email',email,'title',job.title,'body',job.body,'payload',job.payload);
end $$;
create or replace function public.get_admin_media_dancers(
  p_actor uuid, p_stage text default 'staff', p_kind text default 'all',
  p_venue_id uuid default null, p_search text default '', p_hours integer default 0,
  p_offset integer default 0, p_counts_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  perform public.assert_admin_workspace_access(p_actor,'reviewer');
  if p_stage not in ('staff','club','processing','history') or p_kind not in ('all','photo','video')
    or p_offset < 0 or p_offset > 100000 or p_hours < 0 or p_hours > 8760 then
    raise exception 'Invalid media filters.' using errcode='22023';
  end if;
  with scoped as materialized (
    select m.*,
      case when dancer_id is not null then 'dancer:'||dancer_id
        when user_id is not null then 'user:'||user_id else 'upload:'||id end review_group
    from public.admin_media_workspace m
    where (m.stage='history' or m.dancer_id is null) and m.club_reviewed_at is not null and (p_venue_id is null or venue_id=p_venue_id)
  ), filtered as materialized (
    select * from scoped where stage=p_stage and (p_kind='all' or kind=p_kind)
      and (p_search='' or dancer_name ilike '%'||p_search||'%' or venue_name ilike '%'||p_search||'%')
      and (p_hours=0 or created_at<=now()-make_interval(hours=>p_hours))
  ), grouped as (
    select review_group, min(dancer_name) dancer_name, min(created_at) oldest,
      count(*) count, count(*) filter(where kind='photo') photo_count,
      count(*) filter(where kind='video') video_count
    from filtered group by review_group
  ), page as (
    select * from grouped where not p_counts_only order by oldest,review_group limit 12 offset p_offset
  )
  select jsonb_build_object(
    'dancerCount',(select count(*) from grouped), 'total',(select count(*) from filtered),
    'counts',jsonb_build_object('staff',(select count(*) from scoped where stage='staff'),
      'club',(select count(*) from scoped where stage='club'),'processing',(select count(*) from scoped where stage='processing')),
    'dancers',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('preview',(
      select to_jsonb(f) from filtered f where f.review_group=p.review_group
      order by (f.upload_context='profile_main') desc nulls last,(f.kind='photo') desc,f.created_at,f.queue_key limit 1
    )) order by p.oldest,p.review_group) from page p),'[]'::jsonb)
  ) into result;
  return result;
end $$;
create or replace function public.finalize_pending_dancer_nfc_enrollment(p_dancer_user_id uuid,p_session_id uuid,p_audit jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e record; result jsonb := jsonb_build_object('enrollmentStatus','none','shiftCheckedIn',false); next_result jsonb;
begin
  if exists(select 1 from public.dancer_profiles d where d.user_id=p_dancer_user_id and d.status<>'approved'
    and exists(select 1 from public.dancer_media_submissions s where s.dancer_id=d.id)
    and not exists(select 1 from public.dancer_media_batches b where b.dancer_id=d.id and b.state='completed')) then
   return jsonb_build_object('enrollmentStatus','pending','shiftCheckedIn',false,'reason','media_batch_pending');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||p_dancer_user_id::text,0));
  -- One unapproved club must not block completion at another approved club.
  for e in select id from public.dancer_nfc_enrollments where dancer_user_id=p_dancer_user_id
    and status='pending' order by tapped_at desc,id
  loop
    next_result:=public.complete_saved_dancer_check_in(e.id);
    if (next_result->>'shiftCheckedIn')::boolean then return next_result; end if;
    if result->>'enrollmentStatus'='none' then result:=next_result; end if;
  end loop;
  return result;
end $$;

-- Old unattempted item emails are superseded by the batch result. Preserve
-- attempted deliveries so provider idempotency keys remain valid.
update public.dancer_media_email_deliveries set status='skipped',outcome='batch_submission_required',finished_at=now()
where status='pending' and destination is null and payload->>'kind' in ('dancer_media_rejected','dancer_profile_approved','dancer_media_review_summary');
update public.admin_review_email_deliveries q set status='skipped',outcome='batch_submission_required',finished_at=now()
from public.admin_review_email_events e where e.event_key=q.event_key and e.kind='media_approval' and q.status='pending' and q.attempts=0;
create or replace function public.get_club_media_queue(p_actor_id uuid,p_venue_id uuid,p_dancer_id uuid default null,
  p_offset integer default 0,p_limit integer default 12,p_status text default 'pending')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_dancer_media_reviewer(p_actor_id,null,p_venue_id);
  if p_status not in ('pending','all') then raise exception 'MEDIA_REVIEW_INVALID' using errcode='22023';end if;
  with dancers as materialized(select distinct d.id,d.stage_name from public.dancer_profiles d
    join public.venue_media_dancers(p_venue_id) s on s.user_id=d.user_id),
  media as materialized(
    select m.*,case when a.content_version=m.content_version then a.decision else 'pending' end club_status,
      a.revision::text decision_version
    from public.dancer_club_media(array(select id from dancers)) m
    left join public.club_media_permissions a on a.venue_id=p_venue_id and a.source=m.source and a.media_id=m.id
    where m.record->>'status'='approved' or exists(select 1 from public.dancer_media_submissions s cross join lateral jsonb_array_elements(s.items) x
      where s.dancer_id=m.dancer_id and x->>'key'=m.source||':'||m.id and x->>'version'=m.content_version)),
  chosen as materialized(select * from media where p_status='all' or club_status='pending'),
  grouped as(select dancer_id,stage_name,count(*) n,min(created_at) oldest,
    count(*) filter(where kind='photo') photos,count(*) filter(where kind='video') videos from chosen group by dancer_id,stage_name),
  dp as(select * from grouped order by oldest,dancer_id limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset)),
  mp as(select * from chosen where dancer_id=p_dancer_id order by is_main desc,created_at,id,source
    limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset))
  select jsonb_build_object('count',(select count(*) from media where club_status='pending'),
    'dancerCount',(select count(*) from grouped),'uploadCount',(select count(*) from chosen where dancer_id=p_dancer_id),
    'dancer',(select jsonb_build_object('id',id,'stageName',stage_name) from dancers where id=p_dancer_id),
    'dancers',coalesce((select jsonb_agg(jsonb_build_object('id',dancer_id,'stageName',stage_name,'count',n,
      'photoCount',photos,'videoCount',videos) order by oldest,dancer_id) from dp),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'source',source,'dancerId',dancer_id,
      'stageName',stage_name,'record',record,'contentVersion',content_version,'decisionVersion',decision_version,
      'clubStatus',club_status) order by is_main desc,created_at,id,source) from mp),'[]'::jsonb)) into result;
  return result;
end $$;
create or replace function public.get_club_media_updates_queue(p_actor_id uuid,p_venue_id uuid,p_dancer_id uuid default null,
  p_offset integer default 0,p_limit integer default 12,p_status text default 'pending')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  perform public.assert_dancer_media_reviewer(p_actor_id,null,p_venue_id);
  if p_status is null or p_status not in ('pending','all') then raise exception 'MEDIA_REVIEW_INVALID' using errcode='22023';end if;
  with dancers as materialized(select distinct d.id,d.stage_name from public.dancer_profiles d
    join public.venue_media_dancers(p_venue_id) s on s.user_id=d.user_id
    where exists(select 1 from public.club_dancer_approvals a
      where a.venue_id=p_venue_id and a.dancer_id=d.id and a.status='approved')
      and exists(select 1 from public.venue_dancer_affiliations a
        where a.venue_id=p_venue_id and a.dancer_id=d.id and a.status='active' and a.revoked_at is null)),
  media as materialized(
    select m.*,case when a.content_version=m.content_version then a.decision else 'pending' end club_status,
      a.revision::text decision_version
    from public.dancer_club_media(array(select id from dancers)) m
    left join public.club_media_permissions a on a.venue_id=p_venue_id and a.source=m.source and a.media_id=m.id
    where m.record->>'status'='approved' or exists(select 1 from public.dancer_media_submissions s cross join lateral jsonb_array_elements(s.items) x
      where s.dancer_id=m.dancer_id and x->>'key'=m.source||':'||m.id and x->>'version'=m.content_version)),
  chosen as materialized(select * from media where p_status='all' or club_status='pending'),
  grouped as(select dancer_id,stage_name,count(*) n,min(created_at) oldest,
    count(*) filter(where kind='photo') photos,count(*) filter(where kind='video') videos from chosen group by dancer_id,stage_name),
  dp as(select * from grouped order by oldest,dancer_id limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset)),
  mp as(select * from chosen where dancer_id=p_dancer_id order by is_main desc,created_at,id,source
    limit least(24,greatest(0,p_limit)) offset greatest(0,p_offset))
  select jsonb_build_object('count',(select count(*) from media where club_status='pending'),
    'dancerCount',(select count(*) from grouped),'uploadCount',(select count(*) from chosen where dancer_id=p_dancer_id),
    'dancer',(select jsonb_build_object('id',id,'stageName',stage_name) from dancers where id=p_dancer_id),
    'dancers',coalesce((select jsonb_agg(jsonb_build_object('id',dancer_id,'stageName',stage_name,'count',n,
      'photoCount',photos,'videoCount',videos) order by oldest,dancer_id) from dp),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'source',source,'dancerId',dancer_id,
      'stageName',stage_name,'record',record,'contentVersion',content_version,'decisionVersion',decision_version,
      'clubStatus',club_status) order by is_main desc,created_at,id,source) from mp),'[]'::jsonb)) into result;
  return result;
end $$;
create or replace function public.complete_saved_dancer_check_in(p_enrollment_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  e public.dancer_nfc_enrollments;
  d public.dancer_profiles;
  a public.venue_dancer_affiliations;
  v_user_id uuid;
  v_session_id uuid;
  v_visibility text;
  v_result jsonb;
  v_presence jsonb;
  v_reason text;
  v_activated boolean := false;
  v_checked_in boolean := false;
begin
  select dancer_user_id into v_user_id from public.dancer_nfc_enrollments where id=p_enrollment_id;
  if not found then return jsonb_build_object('enrollmentStatus','none','shiftCheckedIn',false); end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||v_user_id::text,0));
  select * into e from public.dancer_nfc_enrollments where id=p_enrollment_id for update;
  if e.status<>'pending' then
    return jsonb_build_object('enrollmentStatus',e.status,'shiftCheckedIn',false);
  end if;
  select p.* into d from public.dancer_profiles p join public.app_users u on u.id=p.user_id
    where p.user_id=e.dancer_user_id and u.role='dancer' and u.account_state='active'
      and p.status in ('pending_review','approved') and p.disabled_at is null for update of p;
  if not found then v_reason:='profile_pending';
  elsif d.status<>'approved' and not exists(select 1 from public.dancer_media_batches b where b.dancer_id=d.id and b.venue_id=e.venue_id and b.state='completed') then v_reason:='media_batch_pending';
  elsif not exists(select 1 from public.nfc_tags t join public.venues v on v.id=t.venue_id
    join public.app_users owner on owner.id=v.owner_user_id
    where t.id=e.nfc_tag_id and t.venue_id=e.venue_id and t.status='active' and t.tag_type='dressing_room'
      and v.is_active and owner.role='venue' and owner.account_state='active') then v_reason:='tag_inactive';
  elsif not exists(select 1 from public.club_dancer_approvals c
    where c.venue_id=e.venue_id and c.dancer_id=d.id and c.status='approved') then v_reason:='club_pending';
  elsif not exists(select 1 from public.dancer_age_verifications age_check
    where age_check.user_id=v_user_id and age_check.provider='ondato' and age_check.status='verified'
      and age_check.verified_at<=e.tapped_at) then v_reason:='age_pending';
  elsif not exists(select 1 from public.dancer_agreement_acceptances receipt
    join public.dancer_agreement_versions version on version.version=receipt.version and version.is_current
    where receipt.user_id=v_user_id) then v_reason:='agreement_pending';
  end if;
  if v_reason is null then
    select * into a from public.venue_dancer_affiliations
      where venue_id=e.venue_id and dancer_id=d.id and status='active' and revoked_at is null for update;
    if not found then v_reason:='access_removed';
    elsif nullif(trim(d.stage_name),'') is null or nullif(trim(d.city),'') is null then v_reason:='profile_pending';
    elsif not (d.status='approved' and d.verification_status='approved') and (
      nullif(d.avatar_storage_path,'') is null or
      (select count(*) from public.dancer_photos where dancer_id=d.id and review_status='approved')<3
      or not exists(select 1 from public.mydancr_tv_videos where dancer_id=d.id and status='approved' and distribution_scope='profile_and_feed')
    ) then v_reason:='media_pending';
    elsif not exists(select 1 from public.dancer_club_media(array[d.id]) m
      join public.club_media_permissions permission on permission.venue_id=e.venue_id and permission.dancer_id=d.id
        and permission.source=m.source and permission.media_id=m.id and permission.content_version=m.content_version
        and permission.decision='approved'
      where m.photo_id is not null and m.record->>'status'='approved') then v_reason:='media_pending';
    end if;
  end if;
  if v_reason is null then
    v_visibility:=e.audit->>'visibility';
    if v_visibility is null or v_visibility not in ('internal','external','both') then
      v_reason:='visibility_required';
    elsif e.expires_at<=clock_timestamp() or e.tapped_at>clock_timestamp() then
      v_reason:='tap_expired';
    else
      -- A review may activate a new profile, but must not fabricate another tap.
      v_activated:=d.venue_approved_at is null;
      update public.dancer_profiles set status='approved',verification_status='approved',
        approved_at=coalesce(approved_at,clock_timestamp()),venue_approved_at=coalesce(venue_approved_at,clock_timestamp()),
        venue_approved_by_user_id=coalesce(venue_approved_by_user_id,a.approved_by_user_id),
        venue_approved_venue_id=coalesce(venue_approved_venue_id,e.venue_id)
        where id=d.id;
      perform pg_advisory_xact_lock(hashtext(d.id::text),781236);
      if not exists(select 1 from public.dancer_channel_preferences where dancer_id=d.id and selected_at>e.tapped_at)
        and not exists(select 1 from public.shifts where dancer_id=d.id and (
          (status='posted' and checked_out_at is null and location_verification_expires_at>clock_timestamp())
          or nfc_last_tapped_at+interval '12 hours'>clock_timestamp())) then
        insert into public.dancer_channel_preferences(dancer_id,visibility,selected_at) values(d.id,v_visibility,e.tapped_at)
          on conflict(dancer_id) do update set visibility=excluded.visibility,selected_at=excluded.selected_at;
        update public.dancer_profiles set is_public=v_visibility in ('external','both') where id=d.id;
      end if;
      if e.tapped_at+interval '6 hours'<=clock_timestamp() then v_reason:='tap_expired';
      else
        -- The existing shift function verifies this stored session and timestamp,
        -- and preserves active shifts and cooldowns across every club.
        v_session_id:=(e.audit->>'sessionId')::uuid;
        if v_session_id is null then v_reason:='tap_expired';
        else
          begin
            v_presence:=public.activate_dancer_shift_from_nfc(e.nfc_tag_id,v_user_id,v_session_id,
              e.audit||jsonb_build_object('clubProfileReview',true));
          exception when sqlstate '40001' then
            if sqlerrm<>'NFC_SAVED_TAP_EXPIRED' then raise; end if;
            v_reason:='tap_expired';
          end;
          v_checked_in:=coalesce((v_presence->>'shiftCheckedIn')::boolean,false)
            and v_presence->>'venueId'=e.venue_id::text;
          v_reason:=case when v_reason='tap_expired' then v_reason when v_checked_in then 'checked_in' when (v_presence->>'cooldownActive')::boolean
            then 'cooldown' else 'active_other_club' end;
          if v_checked_in then
            insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility,selected_at)
              values((v_presence->>'shiftId')::uuid,d.id,e.venue_id,v_visibility,e.tapped_at)
              on conflict(shift_id) do nothing;
          end if;
        end if;
      end if;
    end if;
  end if;
  v_result:=jsonb_build_object('enrollmentStatus',case when v_checked_in then 'completed' else 'pending' end,
    'enrollmentId',e.id,'id',a.id,'dancerId',d.id,'dancerUserId',v_user_id,'stageName',d.stage_name,
    'venueId',e.venue_id,'profileActivated',v_activated,'affiliationActivated',false,'shiftCheckedIn',v_checked_in,
    'checkInStatus',v_reason,'requiresNewTap',v_reason in ('tap_expired','tag_inactive','access_removed','visibility_required'),
    'visibility',v_visibility,'shiftId',case when v_checked_in then v_presence->>'shiftId' end,
    'workingUntil',case when v_checked_in then v_presence->>'workingUntil' end);
  update public.dancer_nfc_enrollments set status=case when v_checked_in then 'completed' else status end,
    completed_at=case when v_checked_in then clock_timestamp() else completed_at end,
    last_attempted_at=clock_timestamp(),updated_at=clock_timestamp(),
    audit=audit||jsonb_build_object('checkInStatus',v_reason) where id=e.id;
  if v_checked_in then
    update public.dancer_channel_tap_receipts set receipt=receipt||v_presence||v_result||jsonb_build_object(
      'status','active','approvedAt',a.approved_at,'clubApprovalStatus','approved')
      where user_id=v_user_id and tag_id=e.nfc_tag_id and session_id=v_session_id;
  end if;
  return v_result;
end $$;
create function private.require_initial_media_batch() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='approved' and old.status is distinct from 'approved' and not exists(select 1 from public.dancer_media_batches where dancer_id=new.id and state='completed') then
  raise exception 'Submit the final media batch before approving this profile.' using errcode='42501';end if;
 return new;
end $$;
revoke all on function private.require_initial_media_batch() from public,anon,authenticated;
grant execute on function private.require_initial_media_batch() to service_role;
create trigger require_initial_media_batch before update of status on public.dancer_profiles for each row execute function private.require_initial_media_batch();

select private.attach_media_batches();
notify pgrst, 'reload schema';
commit;
