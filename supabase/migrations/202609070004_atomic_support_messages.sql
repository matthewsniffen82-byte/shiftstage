begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.create_support_message_safely(
  p_user_id uuid,p_role text,p_thread_id uuid,p_subject text,p_body text,p_message_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_message_id uuid := coalesce(p_message_id,gen_random_uuid());
  v_thread public.support_threads%rowtype;
  v_existing public.support_messages%rowtype;
  v_duplicate boolean := false;
  v_subject text := coalesce(nullif(trim(p_subject),''),'Message to admin');
  v_body text := trim(p_body);
  v_count integer;
  v_notifications jsonb := '[]'::jsonb;
begin
  if p_user_id is null or p_role is null or p_role not in ('customer','dancer','venue','admin')
    or not exists(select 1 from public.app_users where id=p_user_id and role::text=p_role and account_state='active') then
    raise exception using errcode='42501',message='Active support account required.';
  end if;
  if p_role='admin' and p_thread_id is null then raise exception using errcode='22023',message='An existing thread is required.'; end if;
  if v_body is null or length(v_body)<1 or length(v_body)>4000 or length(v_subject)>160 then
    raise exception using errcode='22023',message='Invalid support message.';
  end if;
  -- Serializes both duplicate request IDs and the per-account send limit.
  perform pg_advisory_xact_lock(hashtextextended('support:'||p_user_id::text,0));
  select * into v_existing from public.support_messages where id=v_message_id;
  if found then
    if v_existing.sender_id is distinct from p_user_id or v_existing.body is distinct from v_body
      or v_existing.sender_role::text is distinct from p_role
      or (p_thread_id is not null and v_existing.thread_id<>p_thread_id) then
      raise exception using errcode='22023',message='Message request ID already has different content.';
    end if;
    select * into v_thread from public.support_threads where id=v_existing.thread_id and (p_role='admin' or user_id=p_user_id);
    if not found then raise exception using errcode='42501',message='Support thread not found.'; end if;
    v_duplicate := true;
  else
    select count(*) into v_count from public.support_messages
      where sender_id=p_user_id and sender_kind='human' and created_at>=now()-interval '60 seconds';
    if v_count>=12 then raise exception using errcode='P0001',message='Support message rate limit reached.'; end if;
    if p_thread_id is not null then
      select * into v_thread from public.support_threads where id=p_thread_id and (p_role='admin' or user_id=p_user_id) for update;
      if not found then raise exception using errcode='42501',message='Support thread not found.'; end if;
    else
      insert into public.support_threads(user_id,user_role,subject,status,last_message_at)
        values(p_user_id,p_role::public.user_role,v_subject,'open',now()) returning * into v_thread;
    end if;
    insert into public.support_messages(id,thread_id,sender_id,sender_role,sender_kind,body)
      values(v_message_id,v_thread.id,p_user_id,p_role::public.user_role,'human',v_body);
    update public.support_threads set status=case when p_role='admin' then 'answered' else 'open' end,
      assigned_admin_id=case when p_role='admin' then p_user_id else assigned_admin_id end,last_message_at=now(),updated_at=now()
      where id=v_thread.id and (p_role='admin' or user_id=p_user_id) returning * into v_thread;
    if p_role='admin' then
      with inserted as (
        insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
        values(v_thread.user_id,'support_message','in_app','Admin replied',
          case when length(v_body)>140 then left(v_body,137)||'...' else v_body end,
          jsonb_build_object('threadId',v_thread.id,'subject',v_thread.subject),now()) returning *
      ) select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) into v_notifications from inserted i;
    else
      with inserted as (
        insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
        select a.id,'support_message','in_app','New '||p_role||' support message',left(v_subject||': '||v_body,500),
          jsonb_build_object('threadId',v_thread.id,'userRole',p_role),now()
        from public.app_users a where a.role='admin' and a.account_state='active' returning *
      ) select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) into v_notifications from inserted i;
    end if;
  end if;
  return jsonb_build_object('duplicate',v_duplicate,'notifications',v_notifications,'thread',to_jsonb(v_thread)||jsonb_build_object(
    'app_users',case when p_role='admin' then (select jsonb_build_object('display_name',a.display_name,'email',a.email,'role',a.role) from public.app_users a where a.id=v_thread.user_id) else null end,
    'support_messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from
      (select * from public.support_messages where thread_id=v_thread.id order by created_at desc,id desc limit 1000) m),'[]'::jsonb)));
end; $$;
revoke all on function public.create_support_message_safely(uuid,text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_support_message_safely(uuid,text,uuid,text,text,uuid) to service_role;

notify pgrst,'reload schema';
commit;
