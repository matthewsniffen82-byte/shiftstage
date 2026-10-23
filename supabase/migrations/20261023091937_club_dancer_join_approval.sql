begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Membership approval is independent of platform approval and club media permissions.
create table public.club_dancer_approvals (
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.app_users(id),
  revision uuid not null default gen_random_uuid(),
  grandfathered boolean not null default false,
  primary key (venue_id,dancer_id),
  check ((status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null))
);
create index club_dancer_approvals_dancer_idx on public.club_dancer_approvals(dancer_id);
create index club_dancer_approvals_reviewer_idx on public.club_dancer_approvals(reviewed_by);
create index club_dancer_approvals_queue_idx on public.club_dancer_approvals(venue_id,requested_at,dancer_id);
alter table public.club_dancer_approvals enable row level security;
revoke all on public.club_dancer_approvals from public,anon,authenticated;
grant all on public.club_dancer_approvals to service_role;

-- Preserve existing club relationships, including the separate removal/retap controls.
lock table public.venue_dancer_affiliations in share row exclusive mode;
insert into public.club_dancer_approvals(venue_id,dancer_id,status,requested_at,reviewed_at,reviewed_by,grandfathered)
select venue_id,dancer_id,'approved',approved_at,approved_at,approved_by_user_id,true
from public.venue_dancer_affiliations;

insert into public.club_dancer_approvals(venue_id,dancer_id,requested_at)
select e.venue_id,d.id,e.tapped_at from public.dancer_nfc_enrollments e
join public.dancer_profiles d on d.user_id=e.dancer_user_id
where e.status='pending' and e.expires_at>clock_timestamp()
on conflict(venue_id,dancer_id) do nothing;

create function public.guard_club_dancer_approval() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status <> 'active' then return new; end if;
  if exists(select 1 from public.venue_dancer_affiliations
    where venue_id=new.venue_id and dancer_id=new.dancer_id and status='active' and revoked_at is null) then
    return new;
  end if;
  if not exists(
    select 1 from public.club_dancer_approvals a join public.dancer_profiles d on d.id=a.dancer_id
    where a.venue_id=new.venue_id and a.dancer_id=new.dancer_id and a.status='approved'
      and (a.grandfathered or exists(select 1 from public.dancer_nfc_enrollments e
        where e.venue_id=a.venue_id and e.dancer_user_id=d.user_id
          and e.status='pending' and e.tapped_at>a.reviewed_at and e.expires_at>clock_timestamp()))
  ) then raise exception 'CLUB_APPROVAL_AND_NEW_TAP_REQUIRED' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function public.guard_club_dancer_approval() from public,anon,authenticated;
create trigger require_club_dancer_approval before insert or update of status
on public.venue_dancer_affiliations for each row execute function public.guard_club_dancer_approval();

create function public.review_club_dancer_approval(p_actor_user_id uuid,p_venue_id uuid,p_dancer_id uuid,p_revision uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user_id uuid; v_request public.club_dancer_approvals;
begin
  if p_decision is null or p_decision not in ('approved','rejected') or p_revision is null then
    raise exception 'INVALID_CLUB_DECISION' using errcode='22023';
  end if;
  if not exists(select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id
    join public.app_users actor on actor.id=p_actor_user_id
    where v.id=p_venue_id and v.is_active and owner.role='venue' and owner.account_state='active'
      and actor.role='venue' and actor.account_state='active'
      and (v.owner_user_id=p_actor_user_id or exists(select 1 from public.venue_team_members m
        where m.venue_id=v.id and m.user_id=p_actor_user_id and m.status='active' and m.role='manager'))
  ) then raise exception 'CLUB_MANAGER_REQUIRED' using errcode='42501'; end if;
  select user_id into v_user_id from public.dancer_profiles where id=p_dancer_id;
  if not found then raise exception 'CLUB_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:'||v_user_id::text,0));
  perform 1 from public.dancer_profiles d join public.app_users u on u.id=d.user_id
    where d.id=p_dancer_id and d.disabled_at is null and d.status in ('pending_review','approved')
      and u.account_state='active' and u.role='dancer' for update of d;
  if not found then raise exception 'DANCER_UNAVAILABLE' using errcode='42501'; end if;
  select * into v_request from public.club_dancer_approvals
    where venue_id=p_venue_id and dancer_id=p_dancer_id for update;
  if not found then raise exception 'CLUB_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  if v_request.revision<>p_revision or v_request.status='approved' then
    raise exception 'CLUB_REQUEST_CHANGED' using errcode='40001';
  end if;
  if not exists(select 1 from public.dancer_nfc_enrollments e join public.nfc_tags t on t.id=e.nfc_tag_id
    where e.venue_id=p_venue_id and e.dancer_user_id=v_user_id and e.status='pending'
      and e.expires_at>clock_timestamp() and t.status='active' and t.venue_id=p_venue_id and t.tag_type='dressing_room') then
    raise exception 'CLUB_REQUEST_EXPIRED' using errcode='40001';
  end if;
  update public.club_dancer_approvals set status=p_decision,reviewed_at=clock_timestamp(),
    reviewed_by=p_actor_user_id,revision=gen_random_uuid()
    where venue_id=p_venue_id and dancer_id=p_dancer_id returning * into v_request;
  return jsonb_build_object('venueId',p_venue_id,'dancerId',p_dancer_id,'status',v_request.status,
    'revision',v_request.revision,'requiresNewTap',p_decision='approved');
end;
$$;
revoke all on function public.review_club_dancer_approval(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_club_dancer_approval(uuid,uuid,uuid,uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.register_dancer_channel_tap(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_visibility text, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_dancer public.dancer_profiles;
 v_tag public.nfc_tags;
 v_previous public.shifts;
 v_saved public.dancer_channel_tap_receipts;
 v_result jsonb;
 v_venue public.venues;
 v_approval_status text;
 v_enrollment_id uuid;
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

 -- A new club gets its own membership decision. Pending requests do not change presence or visibility.
 select v.* into v_venue from public.venues v join public.app_users u on u.id=v.owner_user_id
 where v.id=v_tag.venue_id and v.is_active and u.role='venue' and u.account_state='active' for key share of v,u;
 if not found then raise exception 'NFC_TAG_INACTIVE' using errcode='42501'; end if;
 if exists(select 1 from public.venue_dancer_affiliations where venue_id=v_tag.venue_id
   and dancer_id=v_dancer.id and status='revoked' and reentry_blocked) then
   raise exception 'CLUB_REENTRY_BLOCKED' using errcode='42501';
 end if;
 insert into public.club_dancer_approvals(venue_id,dancer_id) values(v_tag.venue_id,v_dancer.id)
 on conflict(venue_id,dancer_id) do nothing;
 select status into v_approval_status from public.club_dancer_approvals
   where venue_id=v_tag.venue_id and dancer_id=v_dancer.id;
 if v_approval_status <> 'approved' then
   insert into public.dancer_nfc_enrollments(dancer_user_id,venue_id,nfc_tag_id,status,tapped_at,expires_at,last_attempted_at,audit)
   values(p_dancer_user_id,v_tag.venue_id,v_tag.id,'pending',clock_timestamp(),clock_timestamp()+interval '7 days',clock_timestamp(),
     p_audit||jsonb_build_object('sessionId',p_session_id,'visibility',p_visibility))
   on conflict(dancer_user_id,venue_id) do update set nfc_tag_id=excluded.nfc_tag_id,status='pending',
     tapped_at=excluded.tapped_at,expires_at=excluded.expires_at,last_attempted_at=excluded.last_attempted_at,
     completed_at=null,audit=excluded.audit,updated_at=clock_timestamp()
   returning id into v_enrollment_id;
   insert into public.nfc_tap_events(nfc_tag_id,venue_id,tag_type,event_type,actor_user_id,session_id,ip_address,user_agent,device_fingerprint,audit)
   values(v_tag.id,v_tag.venue_id,v_tag.tag_type,'opened',p_dancer_user_id,p_session_id,
     p_audit->>'ip_address',p_audit->>'user_agent',p_audit->>'device_fingerprint',
     p_audit||jsonb_build_object('clubApprovalStatus',v_approval_status));
   update public.nfc_tags set last_tapped_at=clock_timestamp(),tap_count=tap_count+1,updated_at=clock_timestamp() where id=v_tag.id;
   v_result:=jsonb_build_object('enrollmentStatus','pending','enrollmentId',v_enrollment_id,
     'venueId',v_venue.id,'venueName',v_venue.name,'venueSlug',v_venue.slug,'clubApprovalStatus',v_approval_status,
     'profileActivated',false,'shiftCheckedIn',false,'affiliationActivated',false,'visibility',p_visibility,'replayed',false);
   insert into public.dancer_channel_tap_receipts(user_id,session_id,tag_id,visibility,receipt)
     values(p_dancer_user_id,p_session_id,p_tag_id,p_visibility,v_result);
   return v_result;
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
$function$
;
revoke all on function public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.register_dancer_channel_tap(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
