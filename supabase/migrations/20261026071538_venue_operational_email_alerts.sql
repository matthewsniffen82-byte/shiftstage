begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.venue_email_events (
 event_key text primary key, venue_id uuid not null references public.venues(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table public.venue_email_deliveries (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid unique references public.notifications(id) on delete set null,
 recipient_id uuid not null references public.app_users(id) on delete cascade,
 venue_id uuid references public.venues(id) on delete cascade,
 notification_type text not null, title text not null, body text not null, payload jsonb not null,
 destination text, status text not null default 'pending' check(status in ('pending','sending','accepted','skipped','failed')),
 attempts integer not null default 0, created_at timestamptz not null default now(),
 next_attempt_at timestamptz not null default now(), lease_id uuid, lease_until timestamptz,
 provider_id text, outcome text, finished_at timestamptz
);
create index venue_email_deliveries_due on public.venue_email_deliveries(next_attempt_at,id) where status in ('pending','sending');
create index venue_email_deliveries_recipient on public.venue_email_deliveries(recipient_id);
create index venue_email_deliveries_venue on public.venue_email_deliveries(venue_id);
create index venue_email_events_venue on public.venue_email_events(venue_id);
alter table public.venue_email_events enable row level security;
alter table public.venue_email_deliveries enable row level security;
revoke all on public.venue_email_events,public.venue_email_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.venue_email_events,public.venue_email_deliveries to service_role;
create policy venue_email_events_service on public.venue_email_events to service_role using(true) with check(true);
create policy venue_email_deliveries_service on public.venue_email_deliveries to service_role using(true) with check(true);
create schema if not exists private;
grant usage on schema private to service_role;

-- Trigger-only function in an unexposed schema. A durable email is saved in the
-- same transaction as the inbox message, even if the request then disconnects.
create function private.queue_venue_notification_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare venue uuid; data jsonb:=coalesce(new.payload,'{}'::jsonb); kind text:=coalesce(new.payload->>'kind','');
begin
 if not exists(select 1 from public.app_users where id=new.recipient_id and role='venue' and account_state='active')
 or kind in ('internal_table_request','club_pickup','club_offer') then return new; end if;
 if data->>'venueId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  select id into venue from public.venues where id=(data->>'venueId')::uuid;
 end if;
 if not data ? 'emailPath' then
  data:=data||jsonb_build_object('emailPath',case
   when data ? 'threadId' then '/dashboard/venue#venue-support'
   when kind like 'vip_%' then '/dashboard/venue#venue-vip'
   when kind='club_shuttle_request' then '/dashboard/venue#venue-pickups'
   else '/dashboard/venue' end);
 end if;
 insert into public.venue_email_deliveries(notification_id,recipient_id,venue_id,notification_type,title,body,payload)
 values(new.id,new.recipient_id,venue,new.notification_type::text,new.title,new.body,data)
 on conflict(notification_id) do nothing;
 return new;
end $$;
revoke all on function private.queue_venue_notification_email() from public,anon,authenticated,service_role;
create trigger venue_notification_email after insert on public.notifications
 for each row execute function private.queue_venue_notification_email();

create function public.venue_email_queue_ready() returns boolean language sql security invoker set search_path='' as $$ select true $$;

-- Only the service worker can resolve the current verified recipient and preferences.
create function private.venue_email_account(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',u.email,'metadata',coalesce(u.raw_user_meta_data,'{}'::jsonb))
 from auth.users u join public.app_users a on a.id=u.id
 where u.id=p_user and a.role='venue' and a.account_state='active' and u.deleted_at is null
 and u.email_confirmed_at is not null and lower(btrim(u.email))=lower(btrim(a.email));
$$;
revoke all on function private.venue_email_account(uuid) from public,anon,authenticated;
grant execute on function private.venue_email_account(uuid) to service_role;

create function public.venue_email_recipient_allowed(p_user uuid,p_venue uuid,p_type text,p_payload jsonb)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.app_users where id=p_user and role='venue' and account_state='active')
 and (not p_payload ? 'threadId' or exists(select 1 from public.support_threads t where t.id::text=p_payload->>'threadId' and t.user_id=p_user and t.user_role='venue'))
 and (p_venue is null or p_type='venue_claim_status' or exists(
  select 1 from public.venues v join public.app_users owner on owner.id=v.owner_user_id and owner.account_state='active'
  where v.id=p_venue and (v.owner_user_id=p_user or exists(
   select 1 from public.venue_team_members m where m.venue_id=v.id and m.user_id=p_user and m.status='active'
    and (m.role='manager' or (coalesce(p_payload->>'managersOnly','true')='false' and m.role='staff'))))));
$$;

create function public.claim_venue_emails(p_limit integer default 2)
returns table(id uuid,lease_id uuid) language plpgsql security invoker set search_path='' as $$
begin
 update public.venue_email_deliveries q set status='failed',outcome='retry_expired',finished_at=now(),lease_id=null,lease_until=null
 where status in ('pending','sending') and (lease_until is null or lease_until<=now())
 and (attempts>=8 or created_at<now()-interval '20 hours');
 return query with due as (
  select q.id from public.venue_email_deliveries q where q.status in ('pending','sending') and q.next_attempt_at<=now()
  and (q.lease_until is null or q.lease_until<=now()) order by q.next_attempt_at,q.id
  for update skip locked limit least(greatest(coalesce(p_limit,2),1),10)
 ) update public.venue_email_deliveries q set status='sending',attempts=q.attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where q.id=due.id returning q.id,q.lease_id;
end $$;

create function public.venue_email_target(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.venue_email_deliveries; account jsonb;
begin
 select * into job from public.venue_email_deliveries where id=p_id and lease_id=p_lease and status='sending' and lease_until>now() for update;
 if not found or not public.venue_email_recipient_allowed(job.recipient_id,job.venue_id,job.notification_type,job.payload) then return null; end if;
 account:=private.venue_email_account(job.recipient_id);
 if account is null or (job.destination is not null and job.destination<>account->>'email') then return null; end if;
 update public.venue_email_deliveries set destination=account->>'email' where id=p_id;
 return account||jsonb_build_object('title',job.title,'body',job.body,'notification_type',job.notification_type,'payload',job.payload);
end $$;

create function public.finish_venue_email(p_id uuid,p_lease uuid,p_status text,p_outcome text,p_provider_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_status is null or p_status not in ('accepted','retry','failed','skipped') then raise exception 'Invalid email outcome'; end if;
 update public.venue_email_deliveries set status=case when p_status='retry' then 'pending' else p_status end,
 next_attempt_at=now()+least(interval '60 minutes',interval '1 minute'*power(2,attempts)),
 lease_id=null,lease_until=null,outcome=left(p_outcome,100),provider_id=left(p_provider_id,200),
 finished_at=case when p_status='retry' then null else now() end
 where id=p_id and lease_id=p_lease and status='sending';
 return found;
end $$;

create function private.emit_venue_email_event(p_venue uuid,p_key text,p_kind text,p_title text,p_body text,p_path text,p_managers boolean default true)
returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.venue_email_events(event_key,venue_id) values(p_key,p_venue) on conflict do nothing;
 if not found then return; end if;
 insert into public.notifications(recipient_id,notification_type,channel,title,body,payload)
 select a.id,case when p_kind='venue_weekly_summary' then 'weekly_summary'::public.notification_type else 'support_message'::public.notification_type end,
 'in_app',p_title,p_body,jsonb_build_object('kind',p_kind,'venueId',p_venue,'emailPath',p_path,'managersOnly',p_managers)
 from public.app_users a join public.venues v on v.id=p_venue
 join public.app_users owner on owner.id=v.owner_user_id and owner.account_state='active'
 where a.role='venue' and a.account_state='active' and (a.id=v.owner_user_id or exists(
 select 1 from public.venue_team_members m where m.venue_id=p_venue and m.user_id=a.id and m.status='active' and (m.role='manager' or (not p_managers and m.role='staff'))));
end $$;
revoke all on function private.emit_venue_email_event(uuid,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function private.emit_venue_email_event(uuid,text,text,text,text,text,boolean) to service_role;

-- Event triggers run only after the underlying action has passed its existing
-- authorization checks. They never grant roster, guest or media access.
create function private.venue_operational_email_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare n jsonb:=to_jsonb(new); o jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 venue uuid:=(n->>'venue_id')::uuid; club text; dancer text; kind text; title text; message text; path text;
 key text; managers boolean:=true;
begin
 if venue is null then return new; end if;
 select name into club from public.venues where id=venue;
 if n ? 'dancer_id' then select stage_name into dancer from public.dancer_profiles where id=(n->>'dancer_id')::uuid; end if;
 key:=tg_table_name||':'||coalesce(n->>'id',n->>'pass_id',n->>'dancer_id')||':'||coalesce(n->>'updated_at',n->>'revision',n->>'created_at','');
 if tg_table_name='venue_guest_list_entries' then
  kind:='venue_guest_list_added'; title:='New guest-list entry'; path:='/dashboard/venue#venue-guest-list';
  message:='A guest joined the guest list for '||club||'. Open your club dashboard for their details.';
 elsif tg_table_name='club_dancer_approvals' then
  if n->>'status'<>'pending' or (o->>'status'='pending' and n->>'requested_at'=o->>'requested_at') then return new; end if;
  key:='dancer-review:'||venue||':'||(n->>'dancer_id')||':'||(n->>'requested_at');
  kind:='venue_dancer_approval_pending'; title:='Dancer awaiting club approval'; path:='/dashboard/venue#venue-dancer-approvals';
  message:=coalesce(dancer,'A dancer')||' is waiting for your club’s profile review at '||club||'.';
 elsif tg_table_name='shifts' then
  if n->>'shift_source'='demo_locked' then return new; end if;
  managers:=false; path:='/dashboard/venue#venue-working-now';
  if n->>'checked_in_at' is not null and o->>'checked_in_at' is null then
   kind:='venue_checkin_started'; title:='Dancer checked in'; message:=coalesce(dancer,'A dancer')||' checked in at '||club||'.';
   key:='checkin:'||(n->>'id')||':'||(n->>'checked_in_at');
  elsif n->>'checked_out_at' is not null and o->>'checked_out_at' is null then
   kind:='venue_checkout_ended'; title:='Dancer checked out'; message:=coalesce(dancer,'A dancer')||' checked out at '||club||'.';
   key:='checkout:'||(n->>'id')||':'||(n->>'checked_out_at');
  elsif n->>'checked_in_at' is null and n->>'shift_source'='scheduled'
   and (tg_op='INSERT' or (n->>'starts_at',n->>'ends_at',n->>'status') is distinct from (o->>'starts_at',o->>'ends_at',o->>'status')) then
   kind:='venue_checkin_schedule'; title:='Scheduled appearance updated'; message:=coalesce(dancer,'A dancer')||' updated a scheduled appearance at '||club||'. Check the roster for the current time and status.';
  else return new; end if;
 elsif tg_table_name='venue_dancer_affiliations' then
  if (n->>'status',n->>'revoked_at') is not distinct from (o->>'status',o->>'revoked_at') then return new; end if;
  kind:='venue_roster_changed'; title:='Dancer roster updated'; path:='/dashboard/venue#venue-working-now';
  message:=coalesce(dancer,'A dancer')||case when n->>'status'='active' and n->>'revoked_at' is null then ' joined the roster at ' else ' is no longer active on the roster at ' end||club||'.';
 elsif tg_table_name='venue_team_members' then
  if (n->>'status',n->>'role') is not distinct from (o->>'status',o->>'role') then return new; end if;
  kind:='venue_team_changed'; title:='Club team access updated'; path:='/dashboard/venue#venue-team';
  message:='Team access changed at '||club||'. Review the current members and access levels in your club dashboard.';
 elsif tg_table_name='venue_club_deal_requests' then
  if n->>'status' is not distinct from o->>'status' then return new; end if;
  kind:='club_deal_request_updated'; title:='Club Deal request updated'; path:='/dashboard/venue#venue-club-deals';
  message:='The Club Deal request for '||club||' is now '||replace(n->>'status','_',' ')||'. Open your dashboard for the decision and any notes.';
 elsif tg_table_name='club_deals' then
  if tg_op='UPDATE' and (n->>'deal_title',n->>'deal_description',n->>'deal_terms',n->>'is_active',n->>'removed_at')
   is not distinct from (o->>'deal_title',o->>'deal_description',o->>'deal_terms',o->>'is_active',o->>'removed_at') then return new; end if;
  kind:='club_deal_updated'; title:='Club Deal updated'; path:='/dashboard/venue#venue-club-deals';
  message:='A Club Deal for '||club||' changed. Review the current offer and terms in your club dashboard.';
 else return new; end if;
 perform private.emit_venue_email_event(venue,key,kind,title,message,path,managers);
 return new;
end $$;
revoke all on function private.venue_operational_email_event() from public,anon,authenticated,service_role;
create trigger guest_list_email after insert on public.venue_guest_list_entries for each row execute function private.venue_operational_email_event();
create trigger dancer_approval_email after insert or update on public.club_dancer_approvals for each row execute function private.venue_operational_email_event();
create trigger shift_venue_email after insert or update on public.shifts for each row execute function private.venue_operational_email_event();
create trigger roster_venue_email after insert or update on public.venue_dancer_affiliations for each row execute function private.venue_operational_email_event();
create trigger team_venue_email after insert or update on public.venue_team_members for each row execute function private.venue_operational_email_event();
create trigger deal_request_venue_email after update on public.venue_club_deal_requests for each row execute function private.venue_operational_email_event();
create trigger deal_venue_email after insert or update on public.club_deals for each row execute function private.venue_operational_email_event();

create function public.prepare_venue_email_alerts() returns void
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare club record; dancer record; media record; added integer; week timestamptz:=date_trunc('week',now() at time zone 'UTC') at time zone 'UTC';
 total integer; guests integer; vip integer; tables integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('venue-email-prepare',0)) then return; end if;
 -- Do not email an upload before its first NFC association or before file checks.
 -- Reuse the review queue's exact eligibility and content-version rules.
 for club in select v.id,v.name from public.venues v join public.app_users a on a.id=v.owner_user_id
  where v.is_active and a.account_state='active' and a.role='venue'
 loop
  for dancer in select d.id,d.stage_name from public.dancer_profiles d join public.venue_media_dancers(club.id) s on s.user_id=d.user_id
  loop
   added:=0;
   for media in select m.* from public.dancer_club_media(array[dancer.id]) m
    left join public.club_media_permissions p on p.venue_id=club.id and p.source=m.source and p.media_id=m.id
    where p.content_version is distinct from m.content_version
   loop
    insert into public.venue_email_events(event_key,venue_id)
    values('media:'||club.id||':'||media.source||':'||media.id||':'||media.content_version,club.id) on conflict do nothing;
    if found then added:=added+1; end if;
   end loop;
   if added>0 then
    perform private.emit_venue_email_event(club.id,'media-batch:'||gen_random_uuid(),'venue_media_pending','Dancer media awaiting approval',
     dancer.stage_name||' has '||added||' new media item'||case when added=1 then '' else 's' end||' for your review at '||club.name||'. MyDancr final approval is still required before publication.',
     '/dashboard/venue#venue-media-reviews');
   end if;
  end loop;
  if not exists(select 1 from public.venue_email_events where event_key='weekly:'||club.id||':'||week::text) then
   select count(*) into total from public.shifts where venue_id=club.id and checked_in_at>=week-interval '7 days' and checked_in_at<week;
   select count(*) into guests from public.venue_guest_list_entries where venue_id=club.id and created_at>=week-interval '7 days' and created_at<week;
   select count(*) into vip from public.venue_vip_requests where venue_id=club.id and created_at>=week-interval '7 days' and created_at<week;
   select count(*) into tables from public.internal_roster_requests where venue_id=club.id and created_at>=week-interval '7 days' and created_at<week;
   perform private.emit_venue_email_event(club.id,'weekly:'||club.id||':'||week::text,'venue_weekly_summary','Your weekly club summary',
    club.name||' · '||to_char(week-interval '7 days','Mon DD')||'–'||to_char(week-interval '1 day','Mon DD')||' (UTC): '||total||' dancer check-ins, '||guests||' guest-list entries, '||vip||' VIP requests and '||tables||' table requests. Open Results for details.',
    '/dashboard/venue#venue-overview');
  end if;
 end loop;
 -- Retain delivery diagnostics for 30 days, without accumulating email bodies forever.
 delete from public.venue_email_deliveries where status in ('accepted','skipped','failed') and created_at<now()-interval '30 days';
end $$;

do $$ declare fn regprocedure; begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('venue_email_queue_ready','venue_email_recipient_allowed','claim_venue_emails','venue_email_target','finish_venue_email','prepare_venue_email_alerts')
 loop execute format('revoke all on function %s from public,anon,authenticated',fn);
 execute format('grant execute on function %s to service_role',fn); end loop;
end $$;
commit;
