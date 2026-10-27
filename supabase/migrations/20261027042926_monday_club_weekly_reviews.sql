begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A club's Monday morning review covers its previous complete local week.
-- The optional clock keeps calendar/DST behavior testable without sending email.
create function private.prepare_venue_weekly_summary(p_venue uuid,p_now timestamptz default now()) returns void
language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare club record; local_now timestamp; week date; period_start timestamptz; period_end timestamptz;
 event_key text; total integer; guests integer; vip integer; tables integer;
begin
 select v.id,v.name,coalesce(t.name,'America/Los_Angeles') as timezone into club
 from public.venues v join public.app_users a on a.id=v.owner_user_id
 left join pg_catalog.pg_timezone_names t on t.name=v.timezone
 where v.id=p_venue and v.is_active and a.account_state='active' and a.role='venue';
 if not found then return; end if;
 local_now:=p_now at time zone club.timezone;
 if local_now is null or extract(isodow from local_now)<>1 or local_now::time<time '09:00' then return; end if;
 week:=local_now::date;
 -- Keep the existing UTC-shaped event key so an already sent review never repeats.
 event_key:='weekly:'||club.id||':'||to_char(week,'YYYY-MM-DD')||' 00:00:00+00';
 insert into public.venue_email_events(event_key,venue_id) values(event_key,club.id) on conflict do nothing;
 if not found then return; end if;
 period_start:=(week-7)::timestamp at time zone club.timezone;
 period_end:=week::timestamp at time zone club.timezone;
 select count(*) into total from public.shifts where venue_id=club.id and checked_in_at>=period_start and checked_in_at<period_end;
 select count(*) into guests from public.venue_guest_list_entries where venue_id=club.id and created_at>=period_start and created_at<period_end;
 select count(*) into vip from public.venue_vip_requests where venue_id=club.id and created_at>=period_start and created_at<period_end;
 select count(*) into tables from public.internal_roster_requests where venue_id=club.id and created_at>=period_start and created_at<period_end;
 insert into public.notifications(recipient_id,notification_type,channel,title,body,payload)
 select a.id,'weekly_summary','in_app','Your weekly club summary',
  club.name||' · '||to_char(week-7,'Mon DD')||'–'||to_char(week-1,'Mon DD')||' ('||club.timezone||'): '||total||' dancer check-ins, '||guests||' guest-list entries, '||vip||' VIP requests and '||tables||' table requests. Open Results for details.',
  jsonb_build_object('kind','venue_weekly_summary','venueId',club.id,'emailPath','/dashboard/venue#venue-overview','managersOnly',true,
   'weeklyScheduledFor',(week+time '09:00') at time zone club.timezone,
   'weeklySendBefore',(week+1)::timestamp at time zone club.timezone)
 from public.app_users a
 where a.role='venue' and a.account_state='active' and (a.id=(select owner_user_id from public.venues where id=club.id) or exists(
  select 1 from public.venue_team_members m where m.venue_id=club.id and m.user_id=a.id and m.status='active' and m.role='manager'));
end $$;
revoke all on function private.prepare_venue_weekly_summary(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.prepare_venue_weekly_summary(uuid,timestamptz) to service_role;

create or replace function public.prepare_venue_email_alerts() returns void
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare club record; dancer record; media record; added integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('venue-email-prepare',0)) then return; end if;
 -- Keep immediate media alerts independent of the weekly review schedule.
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
  perform private.prepare_venue_weekly_summary(club.id);
 end loop;
 delete from public.venue_email_deliveries where status in ('accepted','skipped','failed') and created_at<now()-interval '30 days';
end $$;
revoke all on function public.prepare_venue_email_alerts() from public,anon,authenticated;
grant execute on function public.prepare_venue_email_alerts() to service_role;
commit;
