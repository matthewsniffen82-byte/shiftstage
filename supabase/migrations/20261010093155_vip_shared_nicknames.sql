begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Nicknames now belong to the venue/VIP relationship and are visible to both sides.
-- The original guest name remains unchanged for recognition and request history.
alter table public.venue_vip_invitations add column nickname text not null default ''
 check (length(nickname)<=80 and nickname=trim(nickname) and nickname !~ '[[:cntrl:]]');

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

-- Seed new memberships only. Reinvites and acceptance retries must not replace a
-- nickname already saved by the venue or VIP.
create or replace function public.vip_accept_invitation(p_actor uuid,p_digest text,p_name text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.venue_vip_invitations; v_email text;
begin
 select lower(u.email) into v_email from auth.users u join public.app_users a on a.id=u.id
 where u.id=p_actor and u.email_confirmed_at is not null and a.role='customer' and a.account_state='active';
 if v_email is null then raise exception 'VIP_ACCOUNT_REQUIRED' using errcode='42501'; end if;
 select * into i from public.venue_vip_invitations where token_digest=p_digest for update;
 if not found or i.email<>v_email or i.revoked_at is not null then raise exception 'INVITATION_UNAVAILABLE' using errcode='P0002'; end if;
 if not exists(select 1 from public.venues v join public.app_users a on a.id=v.owner_user_id
 where v.id=i.venue_id and v.is_active and a.role='venue' and a.account_state='active') then
 raise exception 'VENUE_UNAVAILABLE' using errcode='P0002'; end if;
 if i.accepted_by=p_actor and exists(select 1 from public.venue_vip_members where venue_id=i.venue_id and user_id=p_actor and active) then return i.venue_id; end if;
 if i.accepted_at is not null or i.expires_at<=now() then raise exception 'INVITATION_UNAVAILABLE' using errcode='P0002'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'INVALID_NAME' using errcode='22023'; end if;
 insert into public.venue_vip_members(venue_id,user_id,display_name,nickname) values(i.venue_id,p_actor,trim(p_name),i.nickname)
 on conflict(venue_id,user_id) do update set active=true,display_name=excluded.display_name;
 update public.venue_vip_invitations set accepted_by=p_actor,accepted_at=now() where id=i.id;
 return i.venue_id;
end;
$$;

create or replace function public.vip_submit_request(p_actor uuid,p_venue uuid,p_id uuid,p_local_start text,p_dancers uuid[],p_notes text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.venue_vip_members; v public.venues; r public.venue_vip_requests; v_start timestamptz; v_local timestamp;
 v_dancers jsonb; v_names text; v_notifications jsonb;
begin
 -- Membership locks serialize submissions and revocation. The client-generated ID
 -- returns the committed result after a lost response without duplicating alerts.
 select * into m from public.venue_vip_members where user_id=p_actor and venue_id=p_venue and active for update;
 if not found or not exists(select 1 from public.app_users where id=p_actor and role='customer' and account_state='active') then
 raise exception 'VIP_ACCESS_REQUIRED' using errcode='42501'; end if;
 select * into v from public.venues where id=p_venue and is_active;
 if not found or not exists(select 1 from public.app_users where id=v.owner_user_id and role='venue' and account_state='active') then
 raise exception 'VENUE_UNAVAILABLE' using errcode='P0002'; end if;
 select * into r from public.venue_vip_requests where id=p_id;
 if found then
   if r.user_id<>p_actor or r.venue_id<>p_venue then raise exception 'REQUEST_CONFLICT' using errcode='40001'; end if;
   return jsonb_build_object('request',to_jsonb(r),'notifications','[]'::jsonb);
 end if;
 if p_local_start is null or p_local_start !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' or p_notes is null or length(p_notes)>1000
 or coalesce(cardinality(p_dancers),0) not between 1 and 10
 or cardinality(p_dancers)<>(select count(distinct x) from unnest(p_dancers) x) then
 raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 v_local:=p_local_start::timestamp;
 v_start:=v_local at time zone v.timezone;
 if v_start at time zone v.timezone<>v_local or v_start<=now() or v_start>now()+interval '1 year' then
 raise exception 'INVALID_TIME' using errcode='22023'; end if;
 select jsonb_agg(jsonb_build_object('id',d.id,'stageName',d.stage_name) order by d.stage_name),string_agg(d.stage_name,', ' order by d.stage_name)
 into v_dancers,v_names from public.vip_eligible_dancers(p_venue) d where d.id=any(p_dancers);
 if coalesce(jsonb_array_length(v_dancers),0)<>cardinality(p_dancers) then raise exception 'ROSTER_CHANGED' using errcode='40001'; end if;
 if (select count(*) from public.venue_vip_requests where user_id=p_actor and created_at>now()-interval '1 hour')>=10 then
 raise exception 'REQUEST_LIMIT' using errcode='P0001'; end if;
 insert into public.venue_vip_requests(id,venue_id,user_id,guest_name,starts_at,timezone,dancers,notes)
 values(p_id,p_venue,p_actor,m.display_name,v_start,v.timezone,v_dancers,trim(p_notes)) returning * into r;
 with inserted as (
 insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
 select a.id,'support_message','in_app','New VIP request',coalesce(nullif(m.nickname,''),m.display_name)||case when m.nickname<>'' then ' ('||m.display_name||')' else '' end||' requested '||v_names||' on '||to_char(v_local,'Mon DD, YYYY HH24:MI')||' ('||v.timezone||').',
 jsonb_build_object('kind','vip_request','requestId',r.id,'venueId',p_venue,'url','/dashboard/venue#venue-vip','startsAt',v_start,'timezone',v.timezone),now()
 from public.app_users a where a.role='venue' and a.account_state='active' and (a.id=v.owner_user_id or exists(
 select 1 from public.venue_team_members t where t.venue_id=p_venue and t.user_id=a.id and t.role='manager' and t.status='active')) returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]') into v_notifications from inserted;
 return jsonb_build_object('request',to_jsonb(r),'notifications',v_notifications);
end;
$$;

-- Only the server can call this RPC, using the verified customer identity.
-- Row locks serialize edits with venue edits, request submission and revocation.
create function public.vip_update_own_nickname(p_actor uuid,p_venue uuid,p_nickname text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.venue_vip_members; v public.venues; v_nickname text:=trim(p_nickname); v_notifications jsonb;
begin
 select * into m from public.venue_vip_members where user_id=p_actor and venue_id=p_venue and active for update;
 if not found or not exists(select 1 from public.app_users where id=p_actor and role='customer' and account_state='active') then
   raise exception 'VIP_ACCESS_REQUIRED' using errcode='42501';
 end if;
 select * into v from public.venues where id=p_venue and is_active;
 if not found or not exists(select 1 from public.app_users where id=v.owner_user_id and role='venue' and account_state='active') then
   raise exception 'VENUE_UNAVAILABLE' using errcode='P0002';
 end if;
 if v_nickname is null or length(v_nickname)>80 or v_nickname ~ '[[:cntrl:]]' then
   raise exception 'INVALID_NICKNAME' using errcode='22023';
 end if;
 if v_nickname=m.nickname then
   return jsonb_build_object('nickname',v_nickname,'changed',false,'notifications','[]'::jsonb);
 end if;
 update public.venue_vip_members set nickname=v_nickname where id=m.id;
 with inserted as (
   insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
   select a.id,'support_message','in_app','VIP nickname changed',
     m.display_name||' changed their nickname at '||v.name||' from “'||coalesce(nullif(m.nickname,''),m.display_name)||'” to “'||coalesce(nullif(v_nickname,''),m.display_name)||'”.',
     jsonb_build_object('kind','vip_nickname_changed','venueId',p_venue,'memberId',m.id,
       'previousNickname',m.nickname,'nickname',v_nickname,'guestName',m.display_name,'url','/dashboard/venue#venue-vip'),now()
   from public.app_users a where a.role='venue' and a.account_state='active'
     and (a.id=v.owner_user_id or exists(select 1 from public.venue_team_members t
       where t.venue_id=p_venue and t.user_id=a.id and t.role='manager' and t.status='active'))
   returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) into v_notifications from inserted;
 return jsonb_build_object('nickname',v_nickname,'changed',true,'notifications',v_notifications);
end;
$$;

revoke all on function public.vip_update_own_nickname(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.vip_update_own_nickname(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
