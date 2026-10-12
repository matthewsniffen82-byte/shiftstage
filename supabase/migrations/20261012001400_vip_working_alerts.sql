begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.venue_vip_working_alerts (
 user_id uuid not null, venue_id uuid not null,
 dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,venue_id,dancer_id),
 foreign key(venue_id,user_id) references public.venue_vip_members(venue_id,user_id) on delete cascade
);
create index venue_vip_working_alerts_fanout_idx on public.venue_vip_working_alerts(dancer_id,venue_id);
create index venue_vip_working_alerts_member_idx on public.venue_vip_working_alerts(venue_id,user_id);
-- Receipts outlive inbox clearing and preference changes, preventing replayed alerts.
create table public.venue_vip_working_alert_receipts (
 shift_id uuid not null references public.shifts(id) on delete cascade,
 user_id uuid not null references public.app_users(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(shift_id,user_id)
);
create index venue_vip_working_alert_receipts_user_idx on public.venue_vip_working_alert_receipts(user_id);
alter table public.venue_vip_working_alerts enable row level security;
alter table public.venue_vip_working_alert_receipts enable row level security;
revoke all on public.venue_vip_working_alerts,public.venue_vip_working_alert_receipts from public,anon,authenticated;
grant select,insert,delete on public.venue_vip_working_alerts to service_role;
grant select,insert on public.venue_vip_working_alert_receipts to service_role;

create function public.vip_set_working_alert(p_actor uuid,p_venue uuid,p_dancer uuid,p_enabled boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_enabled is null or p_dancer is null then raise exception 'INVALID_PREFERENCE' using errcode='22023'; end if;
 perform 1 from public.venue_vip_members m join public.app_users u on u.id=m.user_id
 where m.user_id=p_actor and m.venue_id=p_venue and m.active and u.role='customer' and u.account_state='active' for update of m;
 if not found then raise exception 'VIP_ACCESS_REQUIRED' using errcode='42501'; end if;
 -- Muting remains possible after a dancer or venue becomes unavailable.
 if not p_enabled then
   delete from public.venue_vip_working_alerts where user_id=p_actor and venue_id=p_venue and dancer_id=p_dancer;
   return false;
 end if;
 if not exists(select 1 from public.venues v join public.app_users u on u.id=v.owner_user_id
 where v.id=p_venue and v.is_active and u.role='venue' and u.account_state='active') then
   raise exception 'VENUE_UNAVAILABLE' using errcode='P0002'; end if;
 if not exists(select 1 from public.vip_eligible_dancers(p_venue) e join public.dancer_profiles d on d.id=e.id
 where e.id=p_dancer and d.is_public) then raise exception 'DANCER_UNAVAILABLE' using errcode='40001'; end if;
 insert into public.venue_vip_working_alerts(user_id,venue_id,dancer_id) values(p_actor,p_venue,p_dancer)
 on conflict do nothing;
 return true;
end;
$$;

create function public.vip_emit_working_alerts(p_shift uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.shifts; v_name text; d_name text; notices jsonb; recipients jsonb;
begin
 select * into s from public.shifts where id=p_shift for share;
 if not found or s.status<>'posted' or s.checked_in_at is null or s.checked_out_at is not null
 or s.location_status is distinct from 'club_confirmed' or s.location_verification_expires_at is null
 or s.location_verification_expires_at<=now() then return jsonb_build_object('notifications','[]'::jsonb,'recipientIds','[]'::jsonb); end if;
 select v.name into v_name from public.venues v join public.app_users u on u.id=v.owner_user_id
 where v.id=s.venue_id and v.is_active and u.role='venue' and u.account_state='active';
 select d.stage_name into d_name from public.dancer_profiles d join public.app_users u on u.id=d.user_id
 where d.id=s.dancer_id and d.is_public and d.status='approved' and d.verification_status='approved' and d.disabled_at is null
 and u.role='dancer' and u.account_state='active'
 and exists(select 1 from public.vip_eligible_dancers(s.venue_id) e where e.id=d.id);
 if v_name is null or d_name is null then return jsonb_build_object('notifications','[]'::jsonb,'recipientIds','[]'::jsonb); end if;
 with claimed as (
   insert into public.venue_vip_working_alert_receipts(shift_id,user_id)
   select s.id,a.user_id from public.venue_vip_working_alerts a
   join public.venue_vip_members m on m.user_id=a.user_id and m.venue_id=a.venue_id and m.active
   join public.app_users u on u.id=a.user_id and u.role='customer' and u.account_state='active'
   left join public.customer_profiles c on c.user_id=a.user_id
   where a.venue_id=s.venue_id and a.dancer_id=s.dancer_id and a.created_at<=s.checked_in_at
   and coalesce(c.notification_settings->'followAlertsEnabled','true'::jsonb)<>'false'::jsonb
   and coalesce(c.notification_settings->'workingNow','true'::jsonb)<>'false'::jsonb
   on conflict do nothing returning user_id
 ), inserted as (
   insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
   select user_id,'shift_updated','in_app',d_name||' is working now',d_name||' checked in at '||v_name||'.',
     jsonb_build_object('kind','vip_dancer_working_now','dancerId',s.dancer_id,'venueId',s.venue_id,
       'shiftId',s.id,'url','/vip?venueId='||s.venue_id::text||'#vip-plan'),now() from claimed returning *
 ) select coalesce(jsonb_agg(to_jsonb(inserted)),'[]'::jsonb) into notices from inserted;
 select coalesce(jsonb_agg(r.user_id),'[]'::jsonb) into recipients from public.venue_vip_working_alert_receipts r where r.shift_id=s.id;
 return jsonb_build_object('notifications',notices,'recipientIds',recipients);
end;
$$;
revoke all on function public.vip_set_working_alert(uuid,uuid,uuid,boolean),public.vip_emit_working_alerts(uuid) from public,anon,authenticated;
grant execute on function public.vip_set_working_alert(uuid,uuid,uuid,boolean),public.vip_emit_working_alerts(uuid) to service_role;
commit;
