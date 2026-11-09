-- Freeze a dated receipt for the provider idempotency key, even if the dancer
-- checks out before a retry reaches their inbox.
create or replace function private.dancer_approval_email_copy(p_user uuid,p_payload jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  dancer public.dancer_profiles;
  shift record;
  on_roster boolean;
  on_public_grid boolean;
  subject text := 'Your profile is approved';
  message text;
  photos integer := coalesce((p_payload->>'photoCount')::integer, 0);
  videos integer := coalesce((p_payload->>'videoCount')::integer, 0);
begin
  select * into dancer from public.dancer_profiles
  where user_id = p_user and disabled_at is null and status = 'approved'
    and verification_status = 'approved' and venue_approved_at is not null;
  if not found then return null; end if;
  if p_payload->>'venueId' is not null and not private.club_media_ready((p_payload->>'venueId')::uuid, dancer.id) then
    return null;
  end if;

  select s.venue_id, v.name, c.visibility, public.has_active_club_deal(v) as public_club,
    to_char(s.checked_in_at at time zone coalesce(tz.name,'UTC'), 'Mon FMDD "at" FMHH12:MI AM') as started_local,
    to_char(s.location_verification_expires_at at time zone coalesce(tz.name,'UTC'), 'Mon FMDD "at" FMHH12:MI AM') as ends_local,
    case when tz.name is null then 'UTC' else 'club time' end as time_label
  into shift
  from public.shifts s join public.venues v on v.id = s.venue_id and v.is_active
  left join public.dancer_shift_channels c on c.shift_id = s.id and c.dancer_id = s.dancer_id and c.venue_id = s.venue_id
  left join pg_catalog.pg_timezone_names tz on tz.name = v.timezone
  where s.dancer_id = dancer.id and s.status = 'posted' and s.checked_in_at <= now()
    and s.checked_out_at is null and s.location_status = 'club_confirmed'
    and isfinite(s.location_verification_expires_at) and s.location_verification_expires_at > now()
  order by s.checked_in_at desc, s.id limit 1;

  if found then
    if private.club_media_ready(shift.venue_id, dancer.id) and not dancer.is_incognito then
      on_roster := shift.visibility in ('internal','both') and exists (
        select 1 from public.internal_roster_members(shift.venue_id) r where r.id = dancer.id
      );
      on_public_grid := shift.visibility in ('external','both') and dancer.is_public and shift.public_club;
    end if;
    if on_roster or on_public_grid then subject := 'Your profile went live at ' || shift.name; end if;
    message := 'You checked in at ' || shift.name || ' on ' || shift.started_local || ' (' || shift.time_label || '). Your scheduled end time was ' || shift.ends_local || '. ';
    message := message || case
      when on_roster and on_public_grid then 'For this check-in, you appeared on the club roster for guests and invited VIPs and as Working now on public MyDancr.'
      when on_roster then 'For this check-in, you appeared on the club roster only, for guests at the club and its invited VIPs.'
      when on_public_grid then 'For this check-in, you appeared as Working now on public MyDancr only.'
      else 'Open your dancer dashboard to see your current visibility.' end;
  else
    message := 'Your full dancer dashboard is ready. There was no active check-in when we prepared this email. Tap the club’s dancer check-in tag to start your next shift.';
  end if;

  if photos + videos > 0 then
    message := message || E'\n\n' || concat_ws(' and ',
      case when photos > 0 then photos || case when photos = 1 then ' photo' else ' photos' end end,
      case when videos > 0 then videos || case when videos = 1 then ' video' else ' videos' end end)
      || case when photos + videos = 1 then ' wasn’t' else ' weren’t' end || ' approved. Replacements are optional.';
    if exists (select 1 from jsonb_array_elements(p_payload->'items') item
               where item->>'isMain' = 'true' or item->>'isAvatar' = 'true') then
      message := message || ' Your previous approved main photo is still in use.';
    end if;
    if exists (select 1 from jsonb_array_elements(p_payload->'items') item where item->>'reviewScope' = 'club') then
      message := message || ' Club decisions apply only at the club that reviewed those items.';
    end if;
  end if;
  return jsonb_build_object('title', subject, 'body', message);
end $$;

create or replace function public.claim_dancer_media_emails() returns table(id uuid,lease_id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 perform private.refresh_dancer_visibility_alerts();
 update public.dancer_media_email_deliveries q set status='failed',outcome=case when q.destination is null then 'target_retry_exhausted' else 'retry_expired' end,finished_at=now(),lease_id=null,lease_until=null
 where q.status in ('pending','sending') and (q.lease_until is null or q.lease_until<=now())
  and ((q.destination is not null and (q.attempts>=8 or q.created_at<now()-interval '20 hours'))
    or (q.destination is null and q.attempts>=5));
 return query with due as (
  select q.id from public.dancer_media_email_deliveries q where q.status in ('pending','sending') and q.next_attempt_at<=now()
   and (q.payload->>'kind' in ('dancer_media_review_summary','dancer_media_batch_result','dancer_visibility_blocked','dancer_club_request_declined')
    or (q.payload->>'kind'='dancer_profile_approved' and (q.destination is not null or q.payload->>'dashboardUnlocked'='true')))
   and (q.lease_until is null or q.lease_until<=now())
   and (q.payload->>'kind' in ('dancer_media_batch_result','dancer_visibility_blocked','dancer_club_request_declined') or q.payload->>'dashboardUnlocked'='true' or not private.dancer_media_review_pending(q.recipient_id))
  order by q.next_attempt_at,q.id for update skip locked limit 1
 ) update public.dancer_media_email_deliveries q set status='sending',attempts=q.attempts+1,
 lease_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where q.id=due.id returning q.id,q.lease_id;
end $$;

-- Review summaries deliberately wait until the review is resolved. Monitor only
-- deliverable work and recent terminal failures. No message contents leave SQL.
create function public.dancer_media_email_queue_needs_attention() returns boolean
language sql stable security invoker set search_path='' as $$
  select exists (
    select 1 from public.dancer_media_email_deliveries q
    where (q.status='failed' and q.finished_at>=now()-interval '1 hour')
       or (q.status in ('pending','sending') and q.created_at<now()-interval '15 minutes'
         and (q.payload->>'kind' in ('dancer_media_batch_result','dancer_visibility_blocked','dancer_club_request_declined')
           or (q.payload->>'kind'='dancer_profile_approved' and (q.destination is not null or q.payload->>'dashboardUnlocked'='true'))
           or (q.payload->>'kind'='dancer_media_review_summary' and not private.dancer_media_review_pending(q.recipient_id)))
         and (q.attempts>0 or q.next_attempt_at<now()-interval '15 minutes'))
  )
$$;
revoke all on function public.dancer_media_email_queue_needs_attention() from public,anon,authenticated;
grant execute on function public.dancer_media_email_queue_needs_attention() to service_role;
