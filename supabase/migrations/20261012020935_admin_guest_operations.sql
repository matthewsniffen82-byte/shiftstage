begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Server-only VIP workflows may act for a verified, active platform admin.
-- Venue owner/manager rules and browser grants stay unchanged.
create or replace function public.vip_manager_access(p_actor uuid,p_venue uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.venues v join public.app_users actor on actor.id=p_actor
 where v.id=p_venue and actor.account_state='active' and (
   actor.role='admin' or (
     actor.role='venue' and v.is_active
     and exists(select 1 from public.app_users owner where owner.id=v.owner_user_id and owner.role='venue' and owner.account_state='active')
     and (v.owner_user_id=p_actor or exists(select 1 from public.venue_team_members t
       where t.venue_id=v.id and t.user_id=p_actor and t.role='manager' and t.status='active'))
   )
 ));
$$;
revoke all on function public.vip_manager_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vip_manager_access(uuid,uuid) to service_role;

create function public.admin_guest_operation(p_actor uuid,p_venue uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; target uuid; old_nickname text; subscription public.venue_update_subscriptions;
begin
 if not exists(select 1 from public.app_users where id=p_actor and role='admin' and account_state='active') then
   raise exception 'ADMIN_REQUIRED' using errcode='42501';
 end if;
 if not exists(select 1 from public.venues where id=p_venue) then raise exception 'VENUE_UNAVAILABLE' using errcode='P0002'; end if;
 if p_action is null or p_action not in ('invite','request_status','revoke_invitation','revoke_member','set_nickname','unsubscribe')
   or p_data is null or jsonb_typeof(p_data)<>'object' or length(coalesce(p_data->>'note',''))>500 then
   raise exception 'INVALID_ACTION' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('vip:'||p_venue::text,0));
 if p_action<>'invite' then target:=(p_data->>'id')::uuid; end if;
 if p_action='unsubscribe' then
   select * into subscription from public.venue_update_subscriptions where id=target and venue_id=p_venue for update;
   if not found then raise exception 'SUBSCRIPTION_UNAVAILABLE' using errcode='P0002'; end if;
   if subscription.withdrawn_at is not null or p_data->>'expectedConsentedAt' is null
     or subscription.consented_at is distinct from (p_data->>'expectedConsentedAt')::timestamptz then
     raise exception 'SUBSCRIPTION_CHANGED' using errcode='40001';
   end if;
   update public.venue_update_subscriptions set withdrawn_at=now() where id=target;
   result:=jsonb_build_object('id',target);
 elsif p_action='set_nickname' then
   select nickname into old_nickname from public.venue_vip_members where id=target and venue_id=p_venue for update;
   if not found then raise exception 'MEMBER_UNAVAILABLE' using errcode='P0002'; end if;
   if p_data->>'expectedNickname' is null or coalesce(old_nickname,'') is distinct from p_data->>'expectedNickname' then
     raise exception 'MEMBER_CHANGED' using errcode='40001';
   end if;
   result:=public.vip_set_member_nickname(p_actor,p_venue,target,p_data->>'nickname');
 else
   if p_action='invite' and not exists(select 1 from public.venues where id=p_venue and is_active) then
     raise exception 'VENUE_UNAVAILABLE' using errcode='P0002';
   end if;
   if p_action='revoke_member' and not exists(select 1 from public.venue_vip_members where id=target and venue_id=p_venue and active) then
     raise exception 'MEMBER_CHANGED' using errcode='40001';
   end if;
   if p_action='revoke_invitation' and not exists(select 1 from public.venue_vip_invitations where id=target and venue_id=p_venue and accepted_at is null and revoked_at is null) then
     raise exception 'INVITATION_CHANGED' using errcode='40001';
   end if;
   result:=public.vip_manage(p_actor,p_venue,p_action,p_data);
   if p_action='invite' then target:=(result->>'id')::uuid; end if;
 end if;
 -- A failed audit insert rolls the entire action back, including notification rows.
 insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
 values(p_actor,case when p_action='unsubscribe' then 'venue_update_subscription' else 'venue_vip' end,target,
   'guest_operations:'||p_action,'venue='||p_venue::text||case when coalesce(p_data->>'note','')='' then '' else '; '||trim(p_data->>'note') end);
 return result;
end;
$$;
revoke all on function public.admin_guest_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_guest_operation(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
