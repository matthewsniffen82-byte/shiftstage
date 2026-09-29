begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.dancer_channel_preferences (
  dancer_id uuid primary key references public.dancer_profiles(id) on delete cascade,
  visibility text not null check (visibility in ('internal','external','both')),
  selected_at timestamptz not null default now()
);
create table public.dancer_shift_channels (
  shift_id uuid primary key references public.shifts(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  visibility text not null check (visibility in ('internal','external','both')),
  selected_at timestamptz not null default now()
);
create index dancer_shift_channels_venue on public.dancer_shift_channels(venue_id,dancer_id);
create table public.dancer_channel_tap_receipts (
  user_id uuid not null references public.app_users(id) on delete cascade,
  session_id uuid not null,
  tag_id uuid not null references public.nfc_tags(id) on delete cascade,
  visibility text not null check (visibility in ('internal','external','both')),
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,session_id)
);

create function public.guard_dancer_channel_publication() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_public and exists(select 1 from public.dancer_channel_preferences where dancer_id=new.id and visibility='internal') then
    new.is_public := false;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_dancer_channel_publication() from public,anon,authenticated,service_role;
create trigger guard_dancer_channel_publication before insert or update on public.dancer_profiles
for each row execute function public.guard_dancer_channel_publication();

create function public.register_dancer_channel_tap(
 p_tag_id uuid,p_dancer_user_id uuid,p_session_id uuid,p_visibility text,p_audit jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
 v_dancer public.dancer_profiles;
 v_tag public.nfc_tags;
 v_previous public.shifts;
 v_saved public.dancer_channel_tap_receipts;
 v_result jsonb;
begin
 if p_tag_id is null or p_dancer_user_id is null or p_session_id is null or p_visibility is null
   or p_visibility not in ('internal','external','both') or jsonb_typeof(p_audit) is distinct from 'object' then
   raise exception 'NFC_VISIBILITY_REQUIRED' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:' || p_dancer_user_id::text,0));
 select * into v_tag from public.nfc_tags where id=p_tag_id and status='active' and tag_type='dressing_room' for update;
 if not found then raise exception 'NFC_TAG_INACTIVE' using errcode='42501'; end if;
 select d.* into v_dancer from public.dancer_profiles d join public.app_users u on u.id=d.user_id
 where d.user_id=p_dancer_user_id and u.role='dancer' and u.account_state='active'
 and d.status in ('pending_review','approved') and d.disabled_at is null for update of d;
 if not found or nullif(trim(v_dancer.avatar_storage_path),'') is null
   or nullif(trim(v_dancer.stage_name),'') is null or nullif(trim(v_dancer.city),'') is null
   or not exists(select 1 from public.dancer_photos where dancer_id=v_dancer.id and review_status='approved') then
   raise exception 'AGE_PROFILE_SETUP_REQUIRED' using errcode='42501';
 end if;
 if not exists(select 1 from public.dancer_age_verifications where user_id=p_dancer_user_id
   and provider='ondato' and status='verified' and verified_at <= clock_timestamp()) then
   raise exception 'AGE_VERIFICATION_REQUIRED_BEFORE_TAP' using errcode='42501';
 end if;
 select * into v_saved from public.dancer_channel_tap_receipts where user_id=p_dancer_user_id and session_id=p_session_id;
 if found then
   if v_saved.tag_id<>p_tag_id or v_saved.visibility<>p_visibility then raise exception 'NFC_REQUEST_REUSED' using errcode='40001'; end if;
   return v_saved.receipt || jsonb_build_object('replayed',true);
 end if;
 select * into v_previous from public.shifts where dancer_id=v_dancer.id and status='posted'
   and checked_in_at is not null and checked_out_at is null and location_status='club_confirmed'
   and location_verification_expires_at>clock_timestamp() order by checked_in_at desc limit 1 for update;
 if found then
   if v_previous.venue_id<>v_tag.venue_id then raise exception 'NFC_ACTIVE_OTHER_CLUB' using errcode='40001'; end if;
 elsif exists(select 1 from public.shifts where dancer_id=v_dancer.id and nfc_last_tapped_at + interval '12 hours'>clock_timestamp()) then
   raise exception 'NFC_COOLDOWN_ACTIVE' using errcode='40001';
 end if;
 insert into public.dancer_channel_preferences(dancer_id,visibility) values(v_dancer.id,p_visibility)
 on conflict(dancer_id) do update set visibility=excluded.visibility,selected_at=clock_timestamp();
 v_result := public.register_and_activate_dancer_tap(p_tag_id,p_dancer_user_id,p_session_id,
   p_audit || jsonb_build_object('visibility',p_visibility));
 if v_result->>'enrollmentStatus' is distinct from 'completed' then raise exception 'AGE_PROFILE_SETUP_REQUIRED' using errcode='42501'; end if;
 if v_result->>'venueId' is distinct from v_tag.venue_id::text or (v_result->>'shiftCheckedIn')::boolean is distinct from true then
   raise exception 'NFC_PRESENCE_CONFLICT' using errcode='40001';
 end if;
 insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility)
 values((v_result->>'shiftId')::uuid,v_dancer.id,v_tag.venue_id,p_visibility)
 on conflict(shift_id) do update set visibility=excluded.visibility,selected_at=clock_timestamp();
 update public.dancer_profiles set is_public=(p_visibility in ('external','both')) where id=v_dancer.id;
 v_result := v_result || jsonb_build_object('visibility',p_visibility,'replayed',false);
 insert into public.dancer_channel_tap_receipts(user_id,session_id,tag_id,visibility,receipt)
 values(p_dancer_user_id,p_session_id,p_tag_id,p_visibility,v_result);
 return v_result;
end;
$$;
revoke all on function public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb) to service_role;

-- Operational objects reference the canonical venue and dancer; no copied profiles or photos.
create table public.internal_roster_links (
 id uuid primary key default gen_random_uuid(),
 venue_id uuid not null references public.venues(id) on delete cascade,
 kind text not null check(kind in ('table','display')),
 label text not null check(length(trim(label)) between 1 and 60),
 token uuid not null unique default gen_random_uuid(),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,venue_id)
);
create index internal_roster_links_venue on public.internal_roster_links(venue_id);
create table public.internal_roster_requests (
 id uuid primary key default gen_random_uuid(),
 venue_id uuid not null references public.venues(id) on delete cascade,
 link_id uuid not null,
 dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
 request_key uuid not null,
 status text not null default 'pending' check(status in ('pending','acknowledged','completed','cancelled')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(link_id,venue_id) references public.internal_roster_links(id,venue_id) on delete cascade,
 unique(link_id,request_key)
);
create index internal_roster_requests_queue on public.internal_roster_requests(venue_id,status,created_at);
create unique index internal_roster_requests_open on public.internal_roster_requests(link_id,dancer_id) where status in ('pending','acknowledged');

-- No public grants: the only callers are server routes after verifying session or capability.
do $$ declare t text; begin
 foreach t in array array['dancer_channel_preferences','dancer_shift_channels','dancer_channel_tap_receipts','internal_roster_links','internal_roster_requests'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.internal_roster_members(p_venue_id uuid)
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
 and d.verification_status='approved' and d.disabled_at is null and nullif(d.avatar_storage_path,'') is not null
 and exists(select 1 from public.dancer_age_verifications where user_id=d.user_id and provider='ondato' and status='verified')
 and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
 and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
 group by d.id,d.stage_name,d.avatar_storage_path;
$$;

create function public.internal_roster_access(p_actor uuid,p_venue uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select exists(select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id
 join public.app_users actor on actor.id=p_actor and actor.role='venue' and actor.account_state='active'
 where v.id=p_venue and v.is_active and owner.role='venue' and owner.account_state='active'
 and (v.owner_user_id=p_actor or exists(select 1 from public.venue_team_members m
 where m.venue_id=v.id and m.user_id=p_actor and m.status='active' and m.role in ('manager','staff'))));
$$;

create function public.internal_roster_request(p_token uuid,p_dancer uuid,p_key uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.internal_roster_links; r public.internal_roster_requests;
begin
 if p_key is null or p_dancer is null then raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 select * into l from public.internal_roster_links where token=p_token and active and kind='table' for update;
 if not found then raise exception 'LINK_UNAVAILABLE' using errcode='42501'; end if;
 update public.internal_roster_requests req set status='cancelled',updated_at=clock_timestamp()
 where req.link_id=l.id and req.status in ('pending','acknowledged')
 and (req.created_at<now()-interval '6 hours' or not exists(select 1 from public.internal_roster_members(l.venue_id) where id=req.dancer_id));
 if not exists(select 1 from public.internal_roster_members(l.venue_id) where id=p_dancer) then
   raise exception 'DANCER_UNAVAILABLE' using errcode='40001';
 end if;
 select * into r from public.internal_roster_requests where link_id=l.id and request_key=p_key;
 if found then
   if r.dancer_id<>p_dancer then raise exception 'REQUEST_REUSED' using errcode='40001'; end if;
   return jsonb_build_object('id',r.id,'status',r.status);
 end if;
 if exists(select 1 from public.internal_roster_requests where link_id=l.id and dancer_id=p_dancer and status in ('pending','acknowledged')) then
   raise exception 'REQUEST_ALREADY_OPEN' using errcode='40001';
 end if;
 if (select count(*) from public.internal_roster_requests where link_id=l.id and created_at>now()-interval '10 minutes')>=10
 or exists(select 1 from public.internal_roster_requests where link_id=l.id and created_at>now()-interval '15 seconds')
 or (select count(*) from public.internal_roster_requests where link_id=l.id and status in ('pending','acknowledged'))>=5 then
   raise exception 'REQUEST_LIMIT' using errcode='P0001';
 end if;
 insert into public.internal_roster_requests(venue_id,link_id,dancer_id,request_key) values(l.venue_id,l.id,p_dancer,p_key) returning * into r;
 return jsonb_build_object('id',r.id,'status',r.status);
end;
$$;

create function public.internal_roster_manage(p_actor uuid,p_venue uuid,p_action text,p_data jsonb) returns jsonb
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
   if p_data->>'kind' is null or p_data->>'kind' not in ('table','display') or nullif(trim(p_data->>'label'),'') is null
     or length(p_data->>'label')>60 then raise exception 'INVALID_LINK' using errcode='22023'; end if;
   insert into public.internal_roster_links(venue_id,kind,label) values(p_venue,p_data->>'kind',trim(p_data->>'label')) returning id into v_id;
   return jsonb_build_object('id',v_id);
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

revoke all on function public.internal_roster_members(uuid),public.internal_roster_access(uuid,uuid),
 public.internal_roster_request(uuid,uuid,uuid),public.internal_roster_manage(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.internal_roster_members(uuid),public.internal_roster_access(uuid,uuid),
 public.internal_roster_request(uuid,uuid,uuid),public.internal_roster_manage(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
