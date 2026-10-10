begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Server-only, using the authenticated actor. Keep the status change and venue
-- alerts in the same transaction, serialized with membership revocation/review.
create function public.vip_withdraw_request(p_actor uuid,p_venue uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.venue_vip_members; v public.venues; r public.venue_vip_requests; v_notifications jsonb;
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
 -- Safe retry after a response was lost; never duplicate venue alerts.
 if r.status='cancelled' and r.reviewed_by=p_actor then
   return jsonb_build_object('request',to_jsonb(r),'notifications','[]'::jsonb);
 end if;
 if r.status<>'pending' then raise exception 'REQUEST_CHANGED' using errcode='40001'; end if;
 update public.venue_vip_requests set status='cancelled',reviewed_by=p_actor,updated_at=now()
 where id=r.id returning * into r;
 with inserted as (
   insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
   select a.id,'support_message','in_app','VIP request withdrawn',
     coalesce(nullif(m.nickname,''),m.display_name)||' withdrew their request for '||to_char(r.starts_at at time zone r.timezone,'Mon DD, YYYY HH24:MI')||' ('||r.timezone||').',
     jsonb_build_object('kind','vip_request_withdrawn','requestId',r.id,'venueId',p_venue,'url','/dashboard/venue#venue-vip'),now()
   from public.app_users a where a.role='venue' and a.account_state='active'
     and (a.id=v.owner_user_id or exists(select 1 from public.venue_team_members t
       where t.venue_id=p_venue and t.user_id=a.id and t.role='manager' and t.status='active')) returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) into v_notifications from inserted;
 return jsonb_build_object('request',to_jsonb(r),'notifications',v_notifications);
end;
$$;
revoke all on function public.vip_withdraw_request(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.vip_withdraw_request(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
