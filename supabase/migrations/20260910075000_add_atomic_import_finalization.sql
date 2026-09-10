-- Add before caller integration. Publication and stored media are never changed here.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create function public.finalize_platform_import_safely(
 p_admin_id uuid,p_video_id uuid,p_batch_id text,p_expected jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
set lock_timeout='3s'
set timezone='UTC'
as $function$
declare
 v_video public.mydancr_tv_videos%rowtype;
 v_before public.mydancr_tv_videos%rowtype;
 v_audit public.admin_actions%rowtype;
 v_expected jsonb := p_expected;
 v_current jsonb;
 v_desired jsonb;
 v_marker text;
 v_note text;
 v_audit_note text;
 v_field text;
 v_count integer;
 v_replayed boolean := false;
 v_keys text[] := array['dancer_id','submitted_by','storage_path','status','review_notes','reviewed_by',
   'submitted_at','reviewed_at','published_at','updated_at','moderation_started_at','moderation_completed_at'];
begin
 if p_admin_id is null or p_video_id is null or p_batch_id is null
   or p_batch_id !~ '^[a-z0-9][a-z0-9-]{7,79}$' or jsonb_typeof(p_expected) is distinct from 'object' then
   raise exception 'IMPORT_FINALIZATION_INVALID_INPUT' using errcode='22023';
 end if;
 perform id from public.app_users where id=p_admin_id and role='admin' and account_state='active' for share;
 if not found then raise exception 'IMPORT_FINALIZATION_FORBIDDEN' using errcode='42501'; end if;
 select * into v_video from public.mydancr_tv_videos where id=p_video_id for update;
 if not found then raise exception 'IMPORT_FINALIZATION_MISSING' using errcode='P0002'; end if;
 v_before := v_video;
 foreach v_field in array array['submitted_at','reviewed_at','published_at','updated_at','moderation_started_at','moderation_completed_at'] loop
   if not(v_expected ? v_field) or jsonb_typeof(v_expected->v_field) not in('string','null')
     or length(v_expected->>v_field)>64 then
     raise exception 'IMPORT_FINALIZATION_INVALID_VERSION' using errcode='22023';
   end if;
   if v_expected->v_field<>'null'::jsonb then
     if not isfinite((v_expected->>v_field)::timestamptz) then
       raise exception 'IMPORT_FINALIZATION_INVALID_VERSION' using errcode='22023';
     end if;
     v_expected := jsonb_set(v_expected,array[v_field],to_jsonb((v_expected->>v_field)::timestamptz));
   end if;
 end loop;
 if not(v_expected ?& v_keys) or (select count(*) from jsonb_object_keys(v_expected))<>cardinality(v_keys)
   or jsonb_typeof(v_expected->'review_notes') not in('string','null') then
   raise exception 'IMPORT_FINALIZATION_INVALID_VERSION' using errcode='22023';
 end if;
 select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_video)) where key=any(v_keys);
 if v_video.status='uploading' then raise exception 'IMPORT_FINALIZATION_NOT_SUBMITTED' using errcode='40001'; end if;
 v_marker := 'platform-import:'||p_batch_id||':'||(v_expected->>'status');
 v_note := case when split_part(coalesce(v_expected->>'review_notes',''),E'\n',1)=v_marker
   then v_expected->>'review_notes'
   else v_marker||case when coalesce(v_expected->>'review_notes','')='' then '' else E'\n'||(v_expected->>'review_notes') end end;
 v_desired := jsonb_set(v_expected,'{review_notes}',to_jsonb(v_note));
 -- Permit the original pre-write snapshot or the exact committed result after a lost response.
 if v_current is distinct from v_expected and v_current is distinct from v_desired then
   raise exception 'IMPORT_FINALIZATION_CHANGED' using errcode='40001';
 end if;
 v_audit_note := 'Batch '||p_batch_id||'; status '||v_video.status||'; version '||md5(v_desired::text);
 select count(*) into v_count from public.admin_actions where target_type='mydancr_tv_video'
   and target_id=p_video_id and action='finalize_platform_tv_import' and notes=v_audit_note;
 if v_count>1 then raise exception 'IMPORT_FINALIZATION_DUPLICATE_RECEIPTS' using errcode='40001'; end if;
 if v_count=1 and v_current=v_desired then
   select * into v_audit from public.admin_actions where target_type='mydancr_tv_video'
     and target_id=p_video_id and action='finalize_platform_tv_import' and notes=v_audit_note;
   v_replayed := true;
 elsif v_count<>0 then
   raise exception 'IMPORT_FINALIZATION_CHANGED' using errcode='40001';
 else
   update public.mydancr_tv_videos set review_notes=v_note where id=p_video_id returning * into v_video;
   if v_video.id is null or v_video.review_notes is distinct from v_note
     or (to_jsonb(v_video)-'review_notes') is distinct from (to_jsonb(v_before)-'review_notes') then
     raise exception 'IMPORT_FINALIZATION_NOTE_NOT_CONFIRMED' using errcode='40001';
   end if;
   insert into public.admin_actions(admin_id,target_type,target_id,action,notes,created_at)
     values(p_admin_id,'mydancr_tv_video',p_video_id,'finalize_platform_tv_import',v_audit_note,clock_timestamp())
     returning * into v_audit;
   if v_audit.id is null or v_audit.admin_id is distinct from p_admin_id
     or v_audit.target_type is distinct from 'mydancr_tv_video' or v_audit.target_id is distinct from p_video_id
     or v_audit.action is distinct from 'finalize_platform_tv_import' or v_audit.notes is distinct from v_audit_note then
     raise exception 'IMPORT_FINALIZATION_AUDIT_NOT_CONFIRMED' using errcode='40001';
   end if;
 end if;
 return jsonb_build_object('video_id',p_video_id,'batch_id',p_batch_id,'status',v_video.status,
   'audit_id',v_audit.id,'recorded_at',v_audit.created_at,'already_recorded',v_replayed,'version',v_desired);
end;
$function$;
revoke all on function public.finalize_platform_import_safely(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_platform_import_safely(uuid,uuid,text,jsonb) to service_role;
comment on function public.finalize_platform_import_safely(uuid,uuid,text,jsonb) is
 'Service-only administrator import note and audit transaction with loaded-version checks and identical receipt replay. Does not publish, moderate, notify or delete media.';
commit;
