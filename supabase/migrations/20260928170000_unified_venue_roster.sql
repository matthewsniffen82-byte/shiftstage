-- One staff roster; guest access still requires an opted-in active internal shift.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.venue_roster_members(p_venue_id uuid)
returns table(id uuid,stage_name text,avatar_storage_path text,working_until timestamptz,internal_visible boolean,external_visible boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 select d.id,d.stage_name,d.avatar_storage_path,presence.working_until,
   coalesce(presence.internal_visible,false),coalesce(presence.external_visible,false)
 from public.venue_dancer_affiliations a
 join public.dancer_profiles d on d.id=a.dancer_id
 join public.app_users u on u.id=d.user_id and u.role='dancer' and u.account_state='active'
 join public.venues v on v.id=a.venue_id and v.is_active
 join public.app_users owner on owner.id=v.owner_user_id and owner.role='venue' and owner.account_state='active'
 left join public.dancer_channel_preferences pref on pref.dancer_id=d.id
 left join lateral (
   select max(s.location_verification_expires_at) working_until,
     bool_or(c.visibility in ('internal','both') and pref.visibility in ('internal','both')
       and exists(select 1 from public.dancer_age_verifications age where age.user_id=d.user_id and age.provider='ondato' and age.status='verified')) internal_visible,
     bool_or(d.is_public and coalesce(c.visibility,'external') in ('external','both')
       and coalesce(pref.visibility,'external') in ('external','both')) external_visible
   from public.shifts s
   left join public.dancer_shift_channels c on c.shift_id=s.id and c.dancer_id=d.id and c.venue_id=a.venue_id
   where s.dancer_id=d.id and s.venue_id=a.venue_id and s.status='posted'
     and s.checked_in_at is not null and s.checked_out_at is null
     and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
 ) presence on true
 where a.venue_id=p_venue_id and a.status='active' and a.revoked_at is null
   and d.status='approved' and d.verification_status='approved' and d.disabled_at is null
   and nullif(d.avatar_storage_path,'') is not null;
$$;
revoke all on function public.venue_roster_members(uuid) from public,anon,authenticated;
grant execute on function public.venue_roster_members(uuid) to service_role;

-- Retain historical rows while disabling all former entrance-display capabilities.
update public.internal_roster_links set active=false,token=gen_random_uuid(),updated_at=clock_timestamp() where kind='display';
alter table public.internal_roster_links add constraint internal_roster_table_links_only check(kind='table' or not active);

create or replace function public.internal_roster_manage(p_actor uuid,p_venue uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.internal_roster_links; r public.internal_roster_requests; v_id uuid;
begin
 if not public.internal_roster_access(p_actor,p_venue) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='request_status' then
   select * into r from public.internal_roster_requests where id=(p_data->>'id')::uuid and venue_id=p_venue for update;
   if not found then raise exception 'REQUEST_UNAVAILABLE' using errcode='P0002'; end if;
   if r.status is distinct from p_data->>'expectedStatus' then raise exception 'REQUEST_CHANGED' using errcode='40001'; end if;
   if not ((r.status='pending' and p_data->>'status' in ('acknowledged','cancelled'))
     or (r.status='acknowledged' and p_data->>'status' in ('completed','cancelled'))) then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
   update public.internal_roster_requests set status=p_data->>'status',updated_at=clock_timestamp() where id=r.id;
   return jsonb_build_object('id',r.id);
 end if;
 if not exists(select 1 from public.venues where id=p_venue and owner_user_id=p_actor)
 and not exists(select 1 from public.venue_team_members where venue_id=p_venue and user_id=p_actor and status='active' and role='manager') then
   raise exception 'MANAGER_REQUIRED' using errcode='42501';
 end if;
 if p_action='link_create' then
   if p_data->>'kind' is null or p_data->>'kind' <> 'table' or nullif(trim(p_data->>'label'),'') is null
     or length(p_data->>'label')>60 then raise exception 'INVALID_LINK' using errcode='22023'; end if;
   insert into public.internal_roster_links(venue_id,kind,label) values(p_venue,p_data->>'kind',trim(p_data->>'label')) returning id into v_id;
   return jsonb_build_object('id',v_id);
 elsif p_action='link_update' then
   if nullif(trim(p_data->>'label'),'') is null or length(p_data->>'label')>60 then
     raise exception 'INVALID_LINK' using errcode='22023';
   end if;
   update public.internal_roster_links set label=trim(p_data->>'label'),updated_at=clock_timestamp()
   where id=(p_data->>'id')::uuid and venue_id=p_venue and kind='table' and active returning * into l;
   if not found then raise exception 'LINK_UNAVAILABLE' using errcode='P0002'; end if;
   return jsonb_build_object('id',l.id);
 elsif p_action='link_revoke' then
   update public.internal_roster_links set active=false,token=gen_random_uuid(),updated_at=clock_timestamp()
   where id=(p_data->>'id')::uuid and venue_id=p_venue returning * into l;
   if not found then raise exception 'LINK_UNAVAILABLE' using errcode='P0002'; end if;
   update public.internal_roster_requests set status='cancelled',updated_at=clock_timestamp() where link_id=l.id and status in ('pending','acknowledged');
   return jsonb_build_object('id',l.id);
 end if;
 raise exception 'INVALID_ACTION' using errcode='22023';
end;
$$;

notify pgrst,'reload schema';
commit;
