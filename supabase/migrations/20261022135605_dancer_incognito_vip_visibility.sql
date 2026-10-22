begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Incognito is a privacy choice independent of the public discovery channel.
alter table public.dancer_profiles add column is_incognito boolean not null default false;
-- Preserve prior hidden approved profiles conservatively; do not infer consent.
update public.dancer_profiles set is_incognito=true where is_public=false and status='approved';
create or replace function public.guard_dancer_channel_publication() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.is_incognito or exists(select 1 from public.dancer_channel_preferences where dancer_id=new.id and visibility='internal') then
  new.is_public:=false;
 end if;
 return new;
end; $$;
CREATE OR REPLACE FUNCTION public.transition_dancer_publication_safely(p_dancer_id uuid, p_transition text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.dancer_profiles%rowtype;
  v_account public.app_users%rowtype;
  v_owner boolean;
  v_admin boolean;
  v_update jsonb;
  v_status public.dancer_status;
begin
  if p_actor_user_id is null then raise exception using errcode='42501',message='An authorized actor is required.'; end if;
  select * into v_profile from public.dancer_profiles where id=p_dancer_id;
  if not found then raise exception using errcode='P0002',message='Dancer profile not found.'; end if;
  -- Account before profile is the same order used by account-state changes.
  select * into v_account from public.app_users where id=v_profile.user_id for update;
  if not found or v_account.role<>'dancer' then raise exception using errcode='P0002',message='Dancer account not found.'; end if;
  select * into v_profile from public.dancer_profiles where id=p_dancer_id for update;
  if not found or v_profile.user_id<>v_account.id then raise exception using errcode='P0002',message='Dancer profile changed.'; end if;
  v_owner := p_actor_user_id=v_profile.user_id;
  v_admin := exists(select 1 from public.app_users where id=p_actor_user_id and role='admin' and account_state='active');
  if not (v_owner or v_admin) then raise exception using errcode='42501',message='Unauthorized profile change.'; end if;
  if p_transition='submit_for_venue_review' then
    if not v_owner or v_account.account_state<>'active' or v_profile.disabled_at is not null or v_profile.admin_disabled_at is not null or v_profile.status='disabled' then
      raise exception using errcode='42501',message='Only the active dancer can submit this profile.';
    end if;
    v_update := jsonb_build_object('status','pending_review','verification_status','pending','approved_at',null,'is_public',false);
  elsif p_transition in ('admin_accept','admin_reject') then
    if not v_admin then raise exception using errcode='42501',message='An active admin account is required.'; end if;
    v_update := jsonb_build_object('status',case when p_transition='admin_accept' then 'pending_review' else 'rejected' end,
      'verification_status',case when p_transition='admin_accept' then 'pending' else 'rejected' end,'approved_at',null,'is_public',false);
  elsif p_transition in ('set_public','set_private','restore_visibility') then
    if not v_owner then raise exception using errcode='42501',message='Only the dancer can change profile visibility.'; end if;
    if p_transition in ('set_public','restore_visibility') and (v_account.account_state<>'active' or v_profile.status<>'approved'
      or v_profile.verification_status<>'approved' or v_profile.approved_at is null
      or v_profile.venue_approved_at is null or v_profile.disabled_at is not null or v_profile.admin_disabled_at is not null) then
      raise exception using errcode='22023',message='Profile approval is required before reactivation.';
    end if;
    v_update := jsonb_build_object('is_public',p_transition<>'set_private','is_incognito',p_transition='set_private');
  elsif p_transition='disable' then
    v_update := jsonb_build_object('status','disabled','disabled_at',clock_timestamp(),'is_public',false);
    if v_admin then v_update := v_update || jsonb_build_object('admin_disabled_at',clock_timestamp()); end if;
  elsif p_transition='reactivate' then
    if v_account.account_state<>'active' then raise exception using errcode='22023',message='The dancer account must be active before reactivation.'; end if;
    -- Resuming a login account does not undo an administrative profile suspension.
    if v_profile.admin_disabled_at is not null and not v_admin then
      v_update := jsonb_build_object('status','disabled','is_public',false);
    else
      v_status := case when v_profile.verification_status='rejected' or v_profile.status='rejected' then 'rejected'::public.dancer_status
        when v_profile.verification_status='approved' and v_profile.approved_at is not null and v_profile.venue_approved_at is not null then 'approved'::public.dancer_status
        else 'pending_review'::public.dancer_status end;
      v_update := jsonb_build_object('status',v_status,'disabled_at',null,'admin_disabled_at',null,'is_public',v_status='approved');
    end if;
  else raise exception using errcode='22023',message='Unknown dancer publication transition.';
  end if;
  update public.dancer_profiles d set
    status=coalesce((v_update->>'status')::public.dancer_status,d.status),
    verification_status=coalesce((v_update->>'verification_status')::public.review_status,d.verification_status),
    approved_at=case when v_update ? 'approved_at' then (v_update->>'approved_at')::timestamptz else d.approved_at end,
    disabled_at=case when v_update ? 'disabled_at' then (v_update->>'disabled_at')::timestamptz else d.disabled_at end,
    admin_disabled_at=case when v_update ? 'admin_disabled_at' then (v_update->>'admin_disabled_at')::timestamptz else d.admin_disabled_at end,
    is_incognito=coalesce((v_update->>'is_incognito')::boolean,d.is_incognito),
    is_public=coalesce((v_update->>'is_public')::boolean,d.is_public), updated_at=clock_timestamp()
  where d.id=p_dancer_id returning d.* into v_profile;
  return jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,'status',v_profile.status,
    'verification_status',v_profile.verification_status,'approved_at',v_profile.approved_at,
    'is_incognito',v_profile.is_incognito,'is_public',v_profile.is_public,'disabled_at',v_profile.disabled_at,'venue_approved_at',v_profile.venue_approved_at,
    'venue_approved_by_user_id',v_profile.venue_approved_by_user_id,'venue_approved_venue_id',v_profile.venue_approved_venue_id,
    'channel_visibility',(select visibility from public.dancer_channel_preferences where dancer_id=v_profile.id));
end; $function$
;

create or replace function public.internal_roster_members(p_venue_id uuid)
returns table(id uuid,stage_name text,avatar_storage_path text,working_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
 select d.id,d.stage_name,d.avatar_storage_path,max(s.location_verification_expires_at)
 from public.dancer_shift_channels c
 join public.shifts s on s.id=c.shift_id and s.dancer_id=c.dancer_id and s.venue_id=c.venue_id
 join public.dancer_profiles d on d.id=c.dancer_id
 join public.dancer_channel_preferences pref on pref.dancer_id=d.id and pref.visibility in ('internal','both')
 join public.app_users u on u.id=d.user_id and u.account_state='active' and u.role='dancer'
 join public.venues v on v.id=c.venue_id and v.is_active
 join public.app_users owner on owner.id=v.owner_user_id and owner.account_state='active' and owner.role='venue'
 join public.venue_dancer_affiliations a on a.venue_id=c.venue_id and a.dancer_id=d.id and a.status='active' and a.revoked_at is null
 where c.venue_id=p_venue_id and c.visibility in ('internal','both') and d.status='approved'
 and not d.is_incognito and d.verification_status='approved' and d.disabled_at is null and nullif(d.avatar_storage_path,'') is not null
 and (exists(select 1 from public.dancer_age_verifications where user_id=d.user_id and provider='ondato' and status='verified') or public.is_internal_demo_shift(s.id))
 and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
 and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
 group by d.id,d.stage_name,d.avatar_storage_path;
$$;


create or replace function public.vip_eligible_dancers(p_venue uuid)
returns table(id uuid,stage_name text,working_now boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 select d.id,d.stage_name,exists(select 1 from public.shifts s where s.dancer_id=d.id and s.venue_id=p_venue
 and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
 and s.location_status='club_confirmed' and s.location_verification_expires_at>now()) as working_now
 from public.dancer_profiles d join public.app_users u on u.id=d.user_id and u.role='dancer' and u.account_state='active'
 where not d.is_incognito and (d.is_public or exists(select 1 from public.dancer_channel_preferences c where c.dancer_id=d.id and c.visibility='internal'
   and p_venue=(select sc.venue_id from public.dancer_shift_channels sc where sc.dancer_id=d.id order by sc.selected_at desc,sc.shift_id desc limit 1)))
 and d.status='approved' and d.verification_status='approved' and d.disabled_at is null
 and not exists(select 1 from public.venue_dancer_affiliations a where a.dancer_id=d.id and a.venue_id=p_venue and a.reentry_blocked)
 and (exists(select 1 from public.venue_dancer_affiliations a where a.dancer_id=d.id and a.venue_id=p_venue and a.status='active' and a.revoked_at is null)
 or exists(select 1 from public.shifts s where s.dancer_id=d.id and s.venue_id=p_venue
 and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
 and s.location_status='club_confirmed' and s.location_verification_expires_at>now()))
 order by d.stage_name,d.id;
$$;
revoke all on function public.vip_eligible_dancers(uuid) from public,anon,authenticated;
grant execute on function public.vip_eligible_dancers(uuid) to service_role;
-- Keep the affiliated roster for follows and history. New and edited requests
-- must select dancers with a current, verified check-in at this venue.
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
 -- Lock in a consistent order so Incognito and requests cannot race.
 perform id from public.dancer_profiles where id=any(p_dancers) order by id for share;
 select jsonb_agg(jsonb_build_object('id',d.id,'stageName',d.stage_name) order by d.stage_name),string_agg(d.stage_name,', ' order by d.stage_name)
 into v_dancers,v_names from public.vip_eligible_dancers(p_venue) d where d.id=any(p_dancers) and d.working_now;
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

create or replace function public.vip_edit_request(p_actor uuid,p_venue uuid,p_request uuid,p_expected_updated_at timestamptz,p_local_start text,p_dancers uuid[])
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
 -- Lock in a consistent order so Incognito and requests cannot race.
 perform id from public.dancer_profiles where id=any(p_dancers) order by id for share;
 select jsonb_agg(jsonb_build_object('id',d.id,'stageName',d.stage_name) order by d.stage_name),string_agg(d.stage_name,', ' order by d.stage_name)
 into v_dancers,v_names from public.vip_eligible_dancers(p_venue) d where d.id=any(p_dancers) and d.working_now;
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


notify pgrst,'reload schema';

notify pgrst,'reload schema';
commit;
