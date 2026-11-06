begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- A new club receives one review request covering the dancer and their initial
-- media batch. Later batches retain their own media-review notifications.
create or replace function private.emit_venue_email_event(
 p_venue uuid,p_key text,p_kind text,p_title text,p_body text,p_path text,p_managers boolean default true
) returns void language plpgsql security invoker set search_path='' as $$
declare approval public.club_dancer_approvals; dancer_name text; club_name text; combined_key text;
begin
 if p_kind='venue_dancer_approval_pending' then
  select a.* into approval from public.club_dancer_approvals a
   where a.venue_id=p_venue and a.status='pending'
    and p_key='dancer-review:'||a.venue_id||':'||a.dancer_id||':'||(to_jsonb(a)->>'requested_at');
 elsif p_kind='venue_media_pending'
  and p_key ~ '^media-submission:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  select a.* into approval from public.dancer_media_batches b
   join public.club_dancer_approvals a on a.venue_id=b.venue_id and a.dancer_id=b.dancer_id
   where b.id=split_part(p_key,':',2)::uuid and b.venue_id=p_venue and a.status='pending'
    and not exists(select 1 from public.dancer_media_batches earlier
     where earlier.venue_id=b.venue_id and earlier.dancer_id=b.dancer_id and earlier.id<>b.id);
 end if;

 if approval.dancer_id is not null then
  combined_key:='dancer-review:'||approval.venue_id||':'||approval.dancer_id||':'||(to_jsonb(approval)->>'requested_at');
  if p_key<>combined_key then
   -- Remember the original batch key as well, so retries remain deduplicated
   -- even after the club approves the profile or another batch is submitted.
   insert into public.venue_email_events(event_key,venue_id) values(p_key,p_venue) on conflict do nothing;
   if not found then return;end if;
  end if;
  select stage_name into dancer_name from public.dancer_profiles where id=approval.dancer_id;
  select name into club_name from public.venues where id=p_venue;
  p_key:=combined_key;
  p_kind:='venue_dancer_approval_pending';
  p_title:='New dancer ready for review';
  p_body:=coalesce(dancer_name,'A dancer')||' is awaiting your club’s approval at '||coalesce(club_name,'your club')
   ||'. Review their profile, photos and videos in New dancers. Submit the media review, then approve or decline the profile.';
  p_path:='/dashboard/venue#venue-dancer-approvals';
  p_managers:=true;
 end if;

 insert into public.venue_email_events(event_key,venue_id) values(p_key,p_venue) on conflict do nothing;
 if not found then return;end if;
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
commit;
