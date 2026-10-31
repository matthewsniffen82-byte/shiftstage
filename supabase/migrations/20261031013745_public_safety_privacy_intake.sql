-- Private intake and an atomic, evidenced removal operation. No DMCA policy change.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.content_reports
  add column case_kind text not null default 'safety' check(case_kind in ('safety','privacy','support')),
  add column intake jsonb not null default '{}' check(jsonb_typeof(intake)='object' and octet_length(intake::text)<=16384),
  add column priority text not null default 'normal' check(priority in ('normal','urgent')),
  add column next_action_due_at timestamptz,
  add column deadline_basis text,
  add column closure_notes text,
  add column action_evidence jsonb;
update public.content_reports set case_kind='support' where target_type='contact_message';
create index content_reports_open_deadline on public.content_reports(next_action_due_at,created_at) where status='open';

create function public.stamp_public_case_receipt() returns trigger language plpgsql set search_path='' as $$
begin
  new.created_at:=clock_timestamp();
  if new.case_kind='safety' and new.reason='Nonconsensual intimate image' then
    new.next_action_due_at:=new.created_at+interval '48 hours';
    new.deadline_basis:='Intimate-image request: 48 hours from receipt';
  elsif new.case_kind='privacy' and new.reason in ('Access or portable copy','Delete my information','Correct my information') then
    -- Early staff review is separate from the applicable response deadline.
    new.next_action_due_at:=new.created_at+interval '1 day';
    new.deadline_basis:='Initial review within 24 hours; assess jurisdiction. Covered California response due within 45 days of receipt.';
    new.intake:=new.intake||jsonb_build_object('californiaResponseDueAt',new.created_at+interval '45 days');
  else
    new.next_action_due_at:=new.created_at+case when new.priority='urgent' then interval '1 hour' else interval '1 day' end;
    new.deadline_basis:='Initial review target; confirm applicable response deadline';
  end if;
  return new;
end $$;
revoke all on function public.stamp_public_case_receipt() from public,anon,authenticated;
create trigger stamp_public_case_receipt before insert on public.content_reports for each row execute function public.stamp_public_case_receipt();

create table public.safety_media_restrictions(
  bucket text not null check(bucket in ('dancer-photos','mydancr-tv-videos')),
  storage_path text not null,
  report_id uuid not null references public.content_reports(id),
  created_at timestamptz not null default now(),
  primary key(bucket,storage_path)
);
alter table public.safety_media_restrictions enable row level security;
revoke all on public.safety_media_restrictions from public,anon,authenticated;
grant select,insert,update,delete on public.safety_media_restrictions to service_role;

-- Private trigger lookup: enforce holds on every publication/reapproval path,
-- including a repeated row referencing the same stored file. No public RPC.
create schema if not exists private;
create function private.enforce_safety_media_restriction() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='dancer_photos' then
    if exists(select 1 from public.safety_media_restrictions where bucket='dancer-photos' and storage_path=new.storage_path) then new.review_status:='rejected'; end if;
  elsif tg_table_name='mydancr_tv_videos' then
    if exists(select 1 from public.safety_media_restrictions where bucket='mydancr-tv-videos' and storage_path=new.storage_path) then new.status:='removed'; new.venue_featured:=false; end if;
  else
    if exists(select 1 from public.safety_media_restrictions where bucket='dancer-photos' and storage_path in (new.avatar_storage_path,new.avatar_source_storage_path))
      or exists(select 1 from public.dancer_photos p join public.safety_media_restrictions h on h.bucket='dancer-photos' and h.storage_path=p.storage_path where p.id=new.avatar_source_photo_id) then
      new.avatar_storage_path:=null; new.avatar_source_storage_path:=null; new.avatar_source_photo_id:=null;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.enforce_safety_media_restriction() from public,anon,authenticated;
create trigger zz_safety_media_restriction before insert or update on public.dancer_photos for each row execute function private.enforce_safety_media_restriction();
create trigger zz_safety_media_restriction before insert or update on public.mydancr_tv_videos for each row execute function private.enforce_safety_media_restriction();
create trigger zz_safety_media_restriction before insert or update on public.dancer_profiles for each row execute function private.enforce_safety_media_restriction();

create function public.close_public_case(p_admin_id uuid,p_report_id uuid,p_action text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  r public.content_reports%rowtype;
  media_path text;
  bucket_name text;
  affected jsonb:='[]';
  receipt jsonb;
begin
  if not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then raise exception 'Active administrator required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('resolved','removed') or length(btrim(coalesce(p_notes,'')))<10 or length(p_notes)>2000 then raise exception 'Record the decision and follow-up in at least 10 characters' using errcode='22023'; end if;
  select * into r from public.content_reports where id=p_report_id for update;
  if not found then raise exception 'Case not found' using errcode='P0002'; end if;
  if r.status<>'open' then raise exception 'Case is already closed; refresh the queue' using errcode='40001'; end if;
  if p_action='removed' then
    if r.target_id is null or r.case_kind<>'safety' then raise exception 'Locate the reported content and use its moderation controls before resolving this case' using errcode='22023'; end if;
    if r.target_type='dancer_profile' then
      receipt:=public.transition_dancer_publication_safely(r.target_id,'disable',p_admin_id);
      if receipt->>'status'<>'disabled' or receipt->'is_public' is distinct from 'false'::jsonb then raise exception 'Profile restriction could not be confirmed'; end if;
      affected:=jsonb_build_array(jsonb_build_object('type',r.target_type,'id',r.target_id,'result','disabled'));
    elsif r.target_type='venue' then
      receipt:=public.change_venue_publication_safely(p_admin_id,r.target_id,'admin_edit','{"is_active":false}');
      if receipt->'is_active' is distinct from 'false'::jsonb then raise exception 'Club restriction could not be confirmed'; end if;
      affected:=jsonb_build_array(jsonb_build_object('type','venue','id',r.target_id,'result','inactive'));
    elsif r.target_type='shift' then
      update public.shifts set status='cancelled' where id=r.target_id returning jsonb_build_object('type','shift','id',id,'result',status) into receipt;
      if receipt is null or receipt->>'result'<>'cancelled' then raise exception 'Schedule restriction could not be confirmed'; end if;
      affected:=jsonb_build_array(receipt);
    elsif r.target_type in ('profile_photo','tv_video') then
      -- A short moderation-only lock stabilizes the target, copies and avatar
      -- sources before lookup. Timeout rolls back the whole case action.
      lock table public.dancer_profiles,public.dancer_photos,public.mydancr_tv_videos in share row exclusive mode;
      if r.target_type='profile_photo' then
        select storage_path into media_path from public.dancer_photos where id=r.target_id;
        bucket_name:='dancer-photos';
      else
        select storage_path into media_path from public.mydancr_tv_videos where id=r.target_id;
        bucket_name:='mydancr-tv-videos';
      end if;
      if media_path is null then raise exception 'Media target is unavailable; review before closing' using errcode='22023'; end if;
      insert into public.safety_media_restrictions(bucket,storage_path,report_id) values(bucket_name,media_path,r.id) on conflict do nothing;
      if r.target_type='profile_photo' then
        -- Include derived avatars in the hold, as well as every gallery reference.
        insert into public.safety_media_restrictions(bucket,storage_path,report_id)
          select 'dancer-photos',avatar_storage_path,r.id from public.dancer_profiles
          where (avatar_source_storage_path=media_path or avatar_source_photo_id=r.target_id) and avatar_storage_path is not null
          on conflict do nothing;
        with changed as (update public.dancer_photos set review_status='rejected' where storage_path=media_path returning id,review_status)
          select jsonb_agg(jsonb_build_object('type','profile_photo','id',id,'result',review_status)) into affected from changed;
        update public.dancer_profiles set avatar_storage_path=null,avatar_source_storage_path=null,avatar_source_photo_id=null
          where avatar_source_storage_path=media_path or avatar_source_photo_id=r.target_id or avatar_storage_path=media_path;
        if exists(select 1 from public.dancer_photos where storage_path=media_path and review_status<>'rejected') then raise exception 'Photo restriction could not be confirmed'; end if;
      else
        with changed as (update public.mydancr_tv_videos set status='removed',venue_featured=false,reviewed_by=p_admin_id,reviewed_at=clock_timestamp()
          where storage_path=media_path returning id,status)
          select jsonb_agg(jsonb_build_object('type','tv_video','id',id,'result',status)) into affected from changed;
        if exists(select 1 from public.mydancr_tv_videos where storage_path=media_path and status<>'removed') then raise exception 'Video restriction could not be confirmed'; end if;
      end if;
      if affected is null then raise exception 'No media restriction was confirmed'; end if;
    else raise exception 'This target has no automatic removal action' using errcode='22023'; end if;
  end if;
  update public.content_reports set status=p_action, reviewed_by=p_admin_id, reviewed_at=clock_timestamp(),closure_notes=btrim(p_notes),
    action_evidence=jsonb_build_object('action',p_action,'affected',affected,'scope','Stored file references and linked derivatives; separately uploaded identical files require reviewer search','recordedAt',clock_timestamp())
    where id=r.id returning * into r;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_admin_id,'content_report',r.id,case when p_action='removed' then 'remove_reported_target' else 'resolve_report' end,btrim(p_notes));
  return to_jsonb(r);
end $$;
revoke all on function public.close_public_case(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.close_public_case(uuid,uuid,text,text) to service_role;
commit;
