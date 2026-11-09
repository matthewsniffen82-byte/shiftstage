-- The saved tap can finish after the approval notification is queued. Resolve
-- the dancer's actual shift when preparing the first delivery attempt.
create function private.dancer_approval_email_copy(p_user uuid, p_payload jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
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
    to_char(s.location_verification_expires_at at time zone tz.name, 'FMHH12:MI AM') as ends_local
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
    if on_roster or on_public_grid then subject := 'Your profile is live at ' || shift.name; end if;
    message := 'You’re checked in at ' || shift.name || coalesce(' until ' || shift.ends_local || ' club time', '') || '. ';
    message := message || case
      when on_roster and on_public_grid then 'Guests and invited VIPs can see you on the club roster. You’re also listed as Working now on public MyDancr.'
      when on_roster then 'You’re visible on the club roster only, to guests at the club and its invited VIPs.'
      when on_public_grid then 'You’re listed as Working now on public MyDancr only.'
      else 'Open your dancer dashboard to check your visibility.' end;
  else
    message := 'Your full dancer dashboard is ready. You’re not checked in. Tap the club’s dancer check-in tag when you’re ready to start your shift.';
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
revoke all on function private.dancer_approval_email_copy(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.dancer_approval_email_copy(uuid,jsonb) to service_role;

-- Keep account checks, ordinary media reviews and previously prepared retries
-- on the same delivery path and with the same provider idempotency key.
do $migration$
declare
  definition text := pg_get_functiondef('private.dancer_media_email_target_before_visibility(uuid,uuid)'::regprocedure);
  anchor text := 'update public.dancer_media_email_deliveries set destination=email,title=job.title,body=job.body,payload=job.payload where id=p_id;';
begin
  if strpos(definition, anchor) = 0 then raise exception 'Expected dancer email destination update'; end if;
  execute replace(definition, anchor, $copy$
 if job.destination is null and (
   (job.payload->>'kind' = 'dancer_profile_approved' and job.payload->>'dashboardUnlocked' = 'true')
   or (job.payload->>'kind' in ('dancer_media_batch_result','dancer_media_review_summary')
     and job.payload->>'outcome' = 'approved' and job.payload->>'action' = 'View results')
 ) then
   result := private.dancer_approval_email_copy(job.recipient_id, job.payload);
   if result is null then return null; end if;
   job.title := result->>'title';
   job.body := result->>'body';
 end if;
 $copy$ || anchor);
end $migration$;
