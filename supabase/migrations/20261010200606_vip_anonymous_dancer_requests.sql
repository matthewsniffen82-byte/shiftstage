begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The request and both audiences' alerts commit together. Dancers receive only
-- an anonymous schedule notice; the private request remains manager/VIP-only.
create or replace function public.vip_submit_request(p_actor uuid,p_venue uuid,p_id uuid,p_local_start text,p_dancers uuid[],p_notes text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.venue_vip_members; v public.venues; r public.venue_vip_requests; v_start timestamptz; v_local timestamp;
 v_dancers jsonb; v_names text; v_notifications jsonb; v_dancer_notifications jsonb;
begin
 -- Serialize submissions with membership revocation and keep retries idempotent.
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
 if p_local_start is null or p_local_start !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' or p_notes is null or length(p_notes)>1000
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
 select a.id,'support_message','in_app','New VIP request',coalesce(nullif(m.nickname,''),m.display_name)||' requested '||v_names||' on '||to_char(v_local,'Mon DD, YYYY HH24:MI')||' ('||v.timezone||').',
 jsonb_build_object('kind','vip_request','requestId',r.id,'venueId',p_venue,'url','/dashboard/venue#venue-vip','startsAt',v_start,'timezone',v.timezone),now()
 from public.app_users a where a.role='venue' and a.account_state='active' and (a.id=v.owner_user_id or exists(
 select 1 from public.venue_team_members t where t.venue_id=p_venue and t.user_id=a.id and t.role='manager' and t.status='active')) returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) into v_notifications from inserted;

 -- Build this payload independently: never copy the request, guest identity,
 -- nickname, notes, or the other selected dancers into a dancer notification.
 with inserted as (
 insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
 select a.id,'support_message','in_app','New VIP request',
   'A VIP requested you at '||v.name||' on '||to_char(v_local,'Mon DD, YYYY HH24:MI')||' ('||v.timezone||'). Awaiting venue confirmation. Contact your manager about availability.',
   jsonb_build_object('kind','vip_dancer_request','venueId',p_venue,'venueName',v.name,
     'startsAt',v_start,'timezone',v.timezone,'url','/dashboard/dancer#dancer-account'),now()
 from public.app_users a where a.role='dancer' and a.account_state='active'
 and exists(select 1 from public.dancer_profiles d where d.user_id=a.id and d.id=any(p_dancers)) returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) into v_dancer_notifications from inserted;
 return jsonb_build_object('request',to_jsonb(r),'notifications',v_notifications||v_dancer_notifications);
end;
$$;
revoke all on function public.vip_submit_request(uuid,uuid,uuid,text,uuid[],text) from public,anon,authenticated;
grant execute on function public.vip_submit_request(uuid,uuid,uuid,text,uuid[],text) to service_role;
notify pgrst,'reload schema';
commit;
