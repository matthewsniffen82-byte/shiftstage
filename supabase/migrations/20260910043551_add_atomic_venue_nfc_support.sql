-- Add an unused server-only boundary before integrating its application caller.
-- Existing records, helper functions, tables and RLS policies are preserved.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create function public.create_venue_nfc_support_safely(
  p_user_id uuid, p_venue_id uuid, p_tag_id uuid, p_request_type text, p_notes text, p_request_id uuid
) returns jsonb
language plpgsql security invoker
set search_path = ''
set lock_timeout = '3s'
as $function$
declare
  v_owner uuid;
  v_venue_name text;
  v_label text;
  v_tag_type text;
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
  v_request public.venue_nfc_support_requests%rowtype;
  v_thread_id uuid;
  v_support jsonb;
  v_body text;
begin
  if p_user_id is null or p_venue_id is null or p_tag_id is null or p_request_id is null
    or p_request_type is null or p_request_type not in ('damaged','lost','relocate','replacement')
    or char_length(v_notes)>1000 then
    raise exception 'INVALID_NFC_SUPPORT_REQUEST' using errcode='22023';
  end if;

  select owner_user_id into v_owner from public.venues where id=p_venue_id;
  -- Account-before-venue locking avoids reversing account lifecycle lock order.
  perform a.id from public.app_users a where a.id in (p_user_id,v_owner) order by a.id for share;
  if not exists(select 1 from public.app_users where id=p_user_id and role='venue' and account_state='active')
    or not exists(select 1 from public.app_users where id=v_owner and account_state='active') then
    raise exception 'NFC_SUPPORT_FORBIDDEN' using errcode='42501';
  end if;
  select name into v_venue_name from public.venues
    where id=p_venue_id and owner_user_id=v_owner for share;
  if not found then raise exception 'NFC_SUPPORT_FORBIDDEN' using errcode='42501'; end if;
  if v_owner<>p_user_id then
    perform id from public.venue_team_members where venue_id=p_venue_id and user_id=p_user_id
      and status='active' and role in ('manager','staff') for share;
    if not found then raise exception 'NFC_SUPPORT_FORBIDDEN' using errcode='42501'; end if;
  end if;
  select label,tag_type::text into v_label,v_tag_type from public.nfc_tags
    where id=p_tag_id and venue_id=p_venue_id for share;
  if not found then raise exception 'NFC_SUPPORT_TAG_NOT_FOUND' using errcode='P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended('nfc-support:'||p_request_id::text,0));
  select * into v_request from public.venue_nfc_support_requests where id=p_request_id for update;
  if found then
    if v_request.requested_by_user_id is distinct from p_user_id or v_request.venue_id is distinct from p_venue_id
      or v_request.nfc_tag_id is distinct from p_tag_id or v_request.request_type is distinct from p_request_type
      or v_request.notes is distinct from v_notes then
      raise exception 'NFC_SUPPORT_REQUEST_CONFLICT' using errcode='22023';
    end if;
    select t.id into v_thread_id from public.support_messages m join public.support_threads t on t.id=m.thread_id
      where m.id=p_request_id and m.sender_id=p_user_id and m.sender_role='venue'
        and m.sender_kind='human' and t.user_id=p_user_id and t.user_role='venue';
    if not found then raise exception 'NFC_SUPPORT_LINK_UNCONFIRMED' using errcode='40001'; end if;
    return jsonb_build_object('request',to_jsonb(v_request),'threadId',v_thread_id,'notifications','[]'::jsonb,'duplicate',true);
  end if;

  insert into public.venue_nfc_support_requests(id,venue_id,nfc_tag_id,requested_by_user_id,request_type,notes)
    values(p_request_id,p_venue_id,p_tag_id,p_user_id,p_request_type,v_notes) returning * into v_request;
  v_body := v_venue_name||' requested '||p_request_type||' tap-sticker support.'||E'\n'
    ||'Sticker: '||v_label||' ('||replace(v_tag_type,'_',' ')||')'||E'\n'
    ||'Request ID: '||p_request_id::text||E'\n'
    ||case when v_notes is null then 'Notes: None provided.' else 'Notes: '||v_notes end;
  v_support := public.create_support_message_safely(p_user_id,'venue',null,
    left('Tap-sticker support · '||v_label,160),v_body,p_request_id);
  select t.id into v_thread_id from public.support_messages m join public.support_threads t on t.id=m.thread_id
    where m.id=p_request_id and m.sender_id=p_user_id and m.sender_role='venue'
      and m.sender_kind='human' and t.user_id=p_user_id and t.user_role='venue';
  if v_thread_id is null or (v_support#>>'{thread,id}')::uuid is distinct from v_thread_id then
    raise exception 'NFC_SUPPORT_MESSAGE_UNCONFIRMED' using errcode='40001';
  end if;
  return jsonb_build_object('request',to_jsonb(v_request),'threadId',v_thread_id,
    'notifications',coalesce(v_support->'notifications','[]'::jsonb),'duplicate',false);
end;
$function$;

revoke all on function public.create_venue_nfc_support_safely(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_venue_nfc_support_safely(uuid,uuid,uuid,text,text,uuid) to service_role;
comment on function public.create_venue_nfc_support_safely(uuid,uuid,uuid,text,text,uuid) is
  'Server-only venue-authorized NFC support request and human support message transaction. Explicit request identity preserves completed retries without duplicate messages or notification records.';
commit;
