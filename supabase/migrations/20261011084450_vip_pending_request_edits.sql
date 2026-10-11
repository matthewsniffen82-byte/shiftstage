begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Update the existing request and its alerts atomically. Membership and request
-- locks serialize edits with revocation, withdrawal and venue review.
create function public.vip_edit_request(p_actor uuid,p_venue uuid,p_request uuid,p_expected_updated_at timestamptz,p_local_start text,p_dancers uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.venue_vip_members; v public.venues; r public.venue_vip_requests;
 v_start timestamptz; v_local timestamp; v_dancers jsonb; v_names text; v_old_ids uuid[];
 v_old_start timestamptz; v_old_timezone text; v_old_names text; v_notifications jsonb; v_dancer_notifications jsonb;
begin
 select * into m from public.venue_vip_members where user_id=p_actor and venue_id=p_venue and active for update;
 if not found or not exists(select 1 from public.app_users where id=p_actor and role='customer' and account_state='active') then
   raise exception 'VIP_ACCESS_REQUIRED' using errcode='42501';
 end if;
 select * into v from public.venues where id=p_venue and is_active;
 if not found or not exists(select 1 from public.app_users where id=v.owner_user_id and role='venue' and account_state='active') then
   raise exception 'VENUE_UNAVAILABLE' using errcode='P0002';
 end if;
 select * into r from public.venue_vip_requests where id=p_request and venue_id=p_venue and user_id=p_actor for update;
 if not found then raise exception 'REQUEST_UNAVAILABLE' using errcode='P0002'; end if;
 if r.status<>'pending' then raise exception 'REQUEST_CHANGED' using errcode='40001'; end if;
 if p_expected_updated_at is null or p_local_start is null or p_local_start !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
 or coalesce(cardinality(p_dancers),0) not between 1 and 10
 or cardinality(p_dancers)<>(select count(distinct x) from unnest(p_dancers) x) then
   raise exception 'INVALID_REQUEST' using errcode='22023';
 end if;
 v_local:=p_local_start::timestamp;
 v_start:=v_local at time zone v.timezone;
 select array_agg((d->>'id')::uuid order by d->>'id'),string_agg(d->>'stageName',', ' order by d->>'stageName')
 into v_old_ids,v_old_names from jsonb_array_elements(r.dancers) d;
 -- Preserve the original offset during a daylight-saving overlap if time is unchanged.
 if r.timezone=v.timezone and r.starts_at at time zone r.timezone=v_local then v_start:=r.starts_at; end if;
 -- A lost response or an unchanged save must not duplicate notifications.
 if r.starts_at=v_start and r.timezone=v.timezone and v_old_ids @> p_dancers and v_old_ids <@ p_dancers then
   return jsonb_build_object('request',to_jsonb(r),'changed',false,'notifications','[]'::jsonb);
 end if;
 if r.updated_at is distinct from p_expected_updated_at then raise exception 'REQUEST_CHANGED' using errcode='40001'; end if;
 if v_start at time zone v.timezone<>v_local or v_start<=now() or v_start>now()+interval '1 year' then
   raise exception 'INVALID_TIME' using errcode='22023';
 end if;
 select jsonb_agg(jsonb_build_object('id',d.id,'stageName',d.stage_name) order by d.stage_name),string_agg(d.stage_name,', ' order by d.stage_name)
 into v_dancers,v_names from public.vip_eligible_dancers(p_venue) d where d.id=any(p_dancers);
 if coalesce(jsonb_array_length(v_dancers),0)<>cardinality(p_dancers) then raise exception 'ROSTER_CHANGED' using errcode='40001'; end if;
 if (select count(*) from public.notifications where recipient_id=v.owner_user_id and sent_at>now()-interval '1 hour'
   and payload->>'kind'='vip_request_updated' and payload->>'requestId'=p_request::text)>=20 then
   raise exception 'REQUEST_LIMIT' using errcode='P0001';
 end if;
 v_old_start:=r.starts_at; v_old_timezone:=r.timezone;
 update public.venue_vip_requests set starts_at=v_start,timezone=v.timezone,dancers=v_dancers,updated_at=clock_timestamp()
 where id=r.id returning * into r;
 with inserted as (
   insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
   select a.id,'support_message','in_app','VIP request updated',
     coalesce(nullif(m.nickname,''),m.display_name)||' updated their pending request. Previously: '||v_old_names||' on '||to_char(v_old_start at time zone v_old_timezone,'Mon DD, YYYY HH24:MI')||' ('||v_old_timezone||'). Now: '||v_names||' on '||to_char(v_local,'Mon DD, YYYY HH24:MI')||' ('||v.timezone||'). Review the updated details before confirming.',
     jsonb_build_object('kind','vip_request_updated','requestId',r.id,'venueId',p_venue,'url','/dashboard/venue#venue-vip','startsAt',v_start,'timezone',v.timezone),now()
   from public.app_users a where a.role='venue' and a.account_state='active'
     and (a.id=v.owner_user_id or exists(select 1 from public.venue_team_members t
       where t.venue_id=p_venue and t.user_id=a.id and t.role='manager' and t.status='active')) returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) into v_notifications from inserted;
 -- Dancer messages never contain guest identity, request IDs, notes or other dancers.
 -- Notify removed dancers, added dancers, and retained dancers whose time changed.
 with inserted as (
   insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
   select a.id,'support_message','in_app','VIP request updated',
     case when d.id=any(p_dancers) then
       case when d.id=any(v_old_ids) then 'A VIP request for you at '||v.name||' moved from '||to_char(v_old_start at time zone v_old_timezone,'Mon DD, YYYY HH24:MI')||' ('||v_old_timezone||') to '
       else 'A VIP requested you at '||v.name||' on ' end
       ||to_char(v_local,'Mon DD, YYYY HH24:MI')||' ('||v.timezone||'). Awaiting venue confirmation. Contact your manager about availability.'
     else 'A VIP request for you at '||v.name||' on '||to_char(v_old_start at time zone v_old_timezone,'Mon DD, YYYY HH24:MI')||' ('||v_old_timezone||') no longer includes you. Contact your manager with any questions.' end,
     jsonb_build_object('kind','vip_dancer_request','venueId',p_venue,'venueName',v.name,
       'startsAt',case when d.id=any(p_dancers) then v_start else v_old_start end,
       'timezone',case when d.id=any(p_dancers) then v.timezone else v_old_timezone end,
       'url','/dashboard/dancer#dancer-account'),now()
   from public.app_users a join public.dancer_profiles d on d.user_id=a.id
   where a.role='dancer' and a.account_state='active' and (d.id=any(v_old_ids) or d.id=any(p_dancers))
     and (not d.id=any(v_old_ids) or not d.id=any(p_dancers) or v_old_start<>v_start or v_old_timezone<>v.timezone)
   returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) into v_dancer_notifications from inserted;
 return jsonb_build_object('request',to_jsonb(r),'changed',true,'notifications',v_notifications||v_dancer_notifications);
end;
$$;
revoke all on function public.vip_edit_request(uuid,uuid,uuid,timestamptz,text,uuid[]) from public,anon,authenticated;
grant execute on function public.vip_edit_request(uuid,uuid,uuid,timestamptz,text,uuid[]) to service_role;

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
 return jsonb_build_object('request',to_jsonb(r),'notifications',v_notifications);
 end if;
 raise exception 'INVALID_ACTION' using errcode='22023';
end;
$$;

notify pgrst,'reload schema';
commit;
