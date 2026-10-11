begin;

create or replace function public.vip_manage(p_actor uuid,p_venue uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; r public.venue_vip_requests; v_notifications jsonb; v_email text; v_nickname text;
begin
 if not public.vip_manager_access(p_actor,p_venue) then raise exception 'MANAGER_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vip:'||p_venue::text,0));
 if p_action='invite' then
 v_email:=lower(trim(p_data->>'email'));
 v_nickname:=trim(coalesce(p_data->>'nickname',''));
 if (p_data ? 'nickname' and jsonb_typeof(p_data->'nickname')<>'string')
 or length(v_nickname)>80 or v_nickname ~ '[[:cntrl:]]' then
   raise exception 'INVALID_NICKNAME' using errcode='22023';
 end if;
 if v_email is null or length(v_email)>254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
 or coalesce(p_data->>'digest','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INVITATION' using errcode='22023'; end if;
 if (select count(*) from public.venue_vip_invitations where venue_id=p_venue and created_at>now()-interval '1 hour')>=30 then raise exception 'INVITATION_LIMIT' using errcode='P0001'; end if;
 update public.venue_vip_invitations set revoked_at=now() where venue_id=p_venue and email=v_email and accepted_at is null and revoked_at is null;
 insert into public.venue_vip_invitations(venue_id,email,token_digest,invited_by,expires_at,nickname)
 values(p_venue,v_email,p_data->>'digest',p_actor,now()+interval '7 days',v_nickname) returning id into v_id;
 return jsonb_build_object('id',v_id);
 elsif p_action='revoke_invitation' then
 update public.venue_vip_invitations set revoked_at=now() where id=(p_data->>'id')::uuid and venue_id=p_venue and accepted_at is null returning id into v_id;
 if v_id is null then raise exception 'INVITATION_UNAVAILABLE' using errcode='P0002'; end if;
 return jsonb_build_object('id',v_id);
 elsif p_action='revoke_member' then
 update public.venue_vip_members set active=false where id=(p_data->>'id')::uuid and venue_id=p_venue returning id into v_id;
 if v_id is null then raise exception 'MEMBER_UNAVAILABLE' using errcode='P0002'; end if;
 return jsonb_build_object('id',v_id);
 elsif p_action='request_status' then
 select * into r from public.venue_vip_requests where id=(p_data->>'id')::uuid and venue_id=p_venue for update;
 if not found then raise exception 'REQUEST_UNAVAILABLE' using errcode='P0002'; end if;
 if r.status is distinct from p_data->>'expectedStatus' then raise exception 'REQUEST_CHANGED' using errcode='40001'; end if;
 -- An edited request cannot be reviewed from an older venue screen.
 if (p_data->>'expectedUpdatedAt' is null and r.updated_at>r.created_at)
 or (p_data->>'expectedUpdatedAt' is not null and r.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz) then
 raise exception 'REQUEST_CHANGED' using errcode='40001'; end if;
 if coalesce(p_data->>'status','') not in ('confirmed','declined','cancelled') or coalesce(length(p_data->>'note'),0)>500
 or not ((r.status='pending' and p_data->>'status' in ('confirmed','declined')) or (r.status='confirmed' and p_data->>'status'='cancelled')) then
 raise exception 'INVALID_STATUS' using errcode='22023'; end if;
 update public.venue_vip_requests set status=p_data->>'status',response_note=coalesce(trim(p_data->>'note'),''),reviewed_by=p_actor,updated_at=now()
 where id=r.id returning * into r;
 with inserted as (
 insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
 values(r.user_id,'support_message','in_app','VIP request '||r.status,
 (select name from public.venues where id=p_venue)||': your request for '||to_char(r.starts_at at time zone r.timezone,'Mon DD, YYYY HH24:MI')||' ('||r.timezone||') is '||r.status||'.',
 jsonb_build_object('kind','vip_request_status','requestId',r.id,'url','/vip'),now()) returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]') into v_notifications from inserted;
 if r.status in ('confirmed','cancelled') then
   -- Use the saved selection, including off-shift dancers; never share guest identity or private notes.
   with inserted as (
     insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
     select a.id,'support_message','in_app','VIP visit '||r.status,
       'A VIP visit that includes you at '||v.name||' on '||
       to_char(r.starts_at at time zone r.timezone,'Mon DD, YYYY HH24:MI')||' ('||r.timezone||
       ') has been '||r.status||' by the venue.'||
       case when r.status='confirmed' then ' Contact your manager about availability.' else '' end,
       jsonb_build_object('kind','vip_dancer_request','status',r.status,'venueId',p_venue,'venueName',v.name,
         'startsAt',r.starts_at,'timezone',r.timezone,'url','/dashboard/dancer#dancer-account'),now()
     from public.app_users a cross join public.venues v
     where v.id=p_venue and a.role='dancer' and a.account_state='active'
       and exists (
         select 1 from public.dancer_profiles d where d.user_id=a.id
           and d.id in (select (selected->>'id')::uuid from jsonb_array_elements(r.dancers) selected)
       )
     returning *
   ) select v_notifications||coalesce(jsonb_agg(to_jsonb(inserted)),'[]') into v_notifications from inserted;
 end if;
 return jsonb_build_object('request',to_jsonb(r),'notifications',v_notifications);
 end if;
 raise exception 'INVALID_ACTION' using errcode='22023';
end;
$$;

revoke all on function public.vip_manage(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.vip_manage(uuid,uuid,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
