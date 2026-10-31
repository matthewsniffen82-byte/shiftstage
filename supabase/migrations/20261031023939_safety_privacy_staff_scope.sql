begin;
set local lock_timeout='5s';
alter table public.app_users drop constraint app_users_admin_workspace_role_check;
alter table public.app_users add constraint app_users_admin_workspace_role_check
 check(admin_workspace_role in ('owner','reviewer','support','billing','compliance'));

-- Existing restricted_admin/is_admin RLS rules continue to deny broad owner access.
create function private.case_reviewer(p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.app_users where id=p_actor and role='admin' and account_state='active' and admin_workspace_role in ('owner','compliance'));
$$;
revoke all on function private.case_reviewer(uuid) from public,anon,authenticated;
grant execute on function private.case_reviewer(uuid) to service_role;



create or replace function public.record_external_case(p_actor uuid,p_received timestamptz,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.content_reports;
begin
 if not private.case_reviewer(p_actor) then raise exception 'Active safety/privacy reviewer access required'; end if;
 if p_received is null or p_received>clock_timestamp() or p_values->>'case_kind' not in ('safety','privacy') then raise exception 'Invalid original receipt'; end if;
 insert into public.content_reports(target_type,target_label,reason,details,case_kind,priority,intake,received_at)
 values('contact_message','External safety or privacy request',p_values->>'reason',p_values->>'details',p_values->>'case_kind',p_values->>'priority',
  (p_values->'intake')||jsonb_build_object('receiptSource',p_values->>'source','recordedBy',p_actor),p_received) returning * into r;
 insert into public.compliance_events(case_id,actor_id,action,revision) values(r.id,p_actor,'external_receipt_recorded',0);
 return to_jsonb(r);
end $$;

create or replace function public.save_case_workflow(p_actor uuid,p_id uuid,p_revision integer,p_workflow jsonb) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare r public.content_reports; due timestamptz; hard_due timestamptz; person text; keys text;
begin
 if not private.case_reviewer(p_actor) then raise exception 'Active safety/privacy reviewer access required'; end if;
 select * into r from public.content_reports where id=p_id for update;
 if not found or r.case_kind not in ('safety','privacy') then raise exception 'Case unavailable'; end if;
 if r.status<>'open' then raise exception 'Closed case is read-only; create a linked follow-up'; end if;
 if r.workflow_revision<>p_revision then raise exception 'Case changed; refresh before saving'; end if;
 if jsonb_typeof(p_workflow) is distinct from 'object' or octet_length(p_workflow::text)>16000 then raise exception 'Invalid workflow'; end if;
 select key into keys from jsonb_each(p_workflow) where key not in
 ('ownerId','backupId','jurisdiction','verification','authority','triage','nextAction','nextDue','responseDue','deadlineReason','extensionNotice','notices','decision','followUp','copySearch','verificationDisposal','retentionTrigger','evidenceLocation','appealReference') limit 1;
 if keys is not null then raise exception 'Unknown workflow field'; end if;
 if exists(select 1 from jsonb_each(p_workflow) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>2000) then raise exception 'Workflow fields must be text up to 2000 characters'; end if;
 foreach person in array array[p_workflow->>'ownerId',p_workflow->>'backupId'] loop
  if coalesce(person,'')<>'' and not private.case_reviewer(person::uuid) then raise exception 'Choose an active safety/privacy reviewer with case access'; end if;
 end loop;
 if coalesce(p_workflow->>'ownerId','')<>'' and p_workflow->>'ownerId'=p_workflow->>'backupId' then raise exception 'Primary and backup must differ'; end if;
 if coalesce(p_workflow->>'verification','') not in ('','pending','verified','not_required','failed') then raise exception 'Invalid verification status'; end if;
 due:=nullif(p_workflow->>'nextDue','')::timestamptz;
 if due is null then raise exception 'Next action deadline required'; end if;
 if length(btrim(coalesce(p_workflow->>'nextAction','')))<3 then raise exception 'Next action required'; end if;
 if r.reason='Nonconsensual intimate image' and r.case_kind='safety' then
  hard_due:=r.received_at+interval '48 hours';
  if due>hard_due then raise exception 'The 48-hour removal clock cannot be extended'; end if;
 end if;
 if r.case_kind='privacy' and nullif(p_workflow->>'responseDue','') is not null then
  hard_due:=(p_workflow->>'responseDue')::timestamptz;
  if hard_due<r.received_at then raise exception 'Response deadline precedes receipt'; end if;
  if length(btrim(coalesce(p_workflow->>'deadlineReason','')))<10 then raise exception 'Record applicable deadline and basis'; end if;
  if lower(p_workflow->>'jurisdiction') ~ '(^|[^a-z])(ca|california)([^a-z]|$)' and r.reason in ('Access or portable copy','Delete my information','Correct my information') then
   if hard_due>r.received_at+interval '90 days' then raise exception 'California response deadline exceeds supported maximum'; end if;
   if hard_due>r.received_at+interval '45 days' and length(btrim(coalesce(p_workflow->>'extensionNotice','')))<10 then raise exception 'Record extension reason and notice before extending'; end if;
  end if;
  if due>hard_due then raise exception 'Next action must be on or before response deadline'; end if;
 end if;
 update public.content_reports set workflow=p_workflow,workflow_revision=workflow_revision+1,next_action_due_at=due where id=p_id returning * into r;
 insert into public.compliance_events(case_id,actor_id,action,revision) values(p_id,p_actor,'workflow_saved',r.workflow_revision);
 return to_jsonb(r);
end $$;

create or replace function private.compliance_close_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare w jsonb:=new.workflow; field text;
begin
 if old.status<>'open' or new.status='open' or new.case_kind not in ('safety','privacy') then return new; end if;
 if not private.case_reviewer(nullif(w->>'ownerId','')::uuid) then raise exception 'Assign an active case owner in Tools > Safety & privacy before closure'; end if;
 foreach field in array array['triage','decision','notices','followUp','retentionTrigger'] loop
  if length(btrim(coalesce(w->>field,'')))<10 then raise exception 'Complete % in Tools > Safety & privacy before closure',field; end if;
 end loop;
 if new.case_kind='privacy' then
  if coalesce(w->>'verification','') not in ('verified','not_required','failed') then raise exception 'Record the verification outcome before closure'; end if;
  if length(btrim(coalesce(w->>'verificationDisposal','')))<10 or length(btrim(coalesce(w->>'authority','')))<10 or length(btrim(coalesce(w->>'jurisdiction','')))<2
   then raise exception 'Complete privacy authority, jurisdiction and verification-material disposal'; end if;
 elsif length(btrim(coalesce(w->>'copySearch','')))<10 then raise exception 'Record known-copy and derivative review before closure'; end if;
 insert into public.compliance_events(case_id,actor_id,action,revision) values(new.id,new.reviewed_by,'case_'||new.status,new.workflow_revision);
 return new;
end $$;

create or replace function public.close_public_case(p_admin_id uuid,p_report_id uuid,p_action text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
  r public.content_reports%rowtype;
  media_path text;
  bucket_name text;
  affected jsonb:='[]';
  receipt jsonb;
begin
  if not private.case_reviewer(p_admin_id) then raise exception 'Active administrator required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('resolved','removed','restricted') or length(btrim(coalesce(p_notes,'')))<10 or length(p_notes)>2000 then raise exception 'Record the decision and follow-up in at least 10 characters' using errcode='22023'; end if;
  select * into r from public.content_reports where id=p_report_id for update;
  if not found then raise exception 'Case not found' using errcode='P0002'; end if;
  if r.case_kind not in ('safety','privacy') and not private.compliance_owner(p_admin_id) then raise exception 'Case permission required' using errcode='42501'; end if;
  if r.status<>'open' then raise exception 'Case is already closed; refresh the queue' using errcode='40001'; end if;
  if p_action in ('removed','restricted') then
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
  update public.content_reports set status=case when p_action='restricted' then 'open' else p_action end, reviewed_by=case when p_action='restricted' then null else p_admin_id end, reviewed_at=case when p_action='restricted' then null else clock_timestamp() end,closure_notes=case when p_action='restricted' then null else btrim(p_notes) end,
    action_evidence=jsonb_build_object('action',p_action,'affected',affected,'restriction',case when p_action in ('restricted','removed') then jsonb_build_object('affected',affected,'at',clock_timestamp(),'actor',p_admin_id,'notes',btrim(p_notes)) else r.action_evidence->'restriction' end,'scope','Stored file references and linked derivatives; separately uploaded identical files require reviewer search','recordedAt',clock_timestamp())
    where id=r.id returning * into r;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_admin_id,'content_report',r.id,case when p_action in ('removed','restricted') then 'remove_reported_target' else 'resolve_report' end,btrim(p_notes));
  return to_jsonb(r);
end $$;

create or replace function public.set_admin_workspace_role(p_actor uuid,p_target uuid,p_role text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
  -- Serialize permission changes, including concurrent changes to the last owner.
  perform pg_advisory_xact_lock(208234,1);
  perform public.assert_admin_workspace_access(p_actor,'owner');
  if p_role not in ('owner','reviewer','support','billing','compliance') or p_actor=p_target then
    raise exception 'Choose another staff account and a valid role.' using errcode='22023';
  end if;
  update public.app_users set admin_workspace_role=p_role where id=p_target and role='admin' and account_state='active';
  if not found then raise exception 'Active staff account not found.'; end if;
  insert into public.admin_actions(admin_id,action,target_type,target_id,notes)
  values(p_actor,'staff_permissions_changed','user',p_target,'Workspace role: '||p_role);
end $$;

commit;
