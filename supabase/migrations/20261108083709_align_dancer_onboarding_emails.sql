-- Queue the decision in the same transaction as the club review. Historical
-- declines and retries of an already decided request do not create messages.
create function private.queue_dancer_club_decline_email() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.dancer_media_email_deliveries(recipient_id, title, body, payload)
    select d.user_id, 'Club request declined',
      v.name || ' declined your request to join its roster. Contact the club’s manager if you have questions.',
      jsonb_build_object('kind', 'dancer_club_request_declined', 'dancerId', d.id,
        'venueId', v.id, 'revision', new.revision)
    from public.dancer_profiles d cross join public.venues v
    where d.id = new.dancer_id and v.id = new.venue_id and d.disabled_at is null;
  return new;
end $$;
revoke all on function private.queue_dancer_club_decline_email() from public, anon, authenticated;
create trigger dancer_club_decline_email after update of status on public.club_dancer_approvals
  for each row when (old.status = 'pending' and new.status = 'rejected')
  execute function private.queue_dancer_club_decline_email();

do $migration$
declare
  definition text;
  anchor text;
begin
  -- A club decline is actionable even when the dancer still has pending media.
  definition := pg_get_functiondef('public.claim_dancer_media_emails()'::regprocedure);
  anchor := $old$'dancer_media_batch_result','dancer_visibility_blocked')$old$;
  if array_length(string_to_array(definition, anchor), 1) <> 3 then
    raise exception 'Expected both dancer email claim filters';
  end if;
  execute replace(definition, anchor, $new$'dancer_media_batch_result','dancer_visibility_blocked','dancer_club_request_declined')$new$);

  -- Reuse the verified account and destination checks. Discard the queued
  -- decision if the dancer has since reapplied or the club changed its decision.
  definition := pg_get_functiondef('private.dancer_media_email_target_before_visibility(uuid,uuid)'::regprocedure);
  anchor := $old$elsif job.payload->>'kind'='dancer_profile_approved' and job.destination is not null then$old$;
  if strpos(definition, anchor) = 0 then raise exception 'Expected dancer email target branch'; end if;
  execute replace(definition, anchor, $new$elsif job.payload->>'kind'='dancer_club_request_declined' then
  if not exists (
    select 1 from public.club_dancer_approvals a join public.dancer_profiles d on d.id = a.dancer_id
    where a.dancer_id = (job.payload->>'dancerId')::uuid and a.venue_id = (job.payload->>'venueId')::uuid
      and d.user_id = job.recipient_id and a.status = 'rejected' and a.revision = (job.payload->>'revision')::uuid
  ) then return null; end if;
 $new$ || anchor);

  definition := pg_get_functiondef('private.media_batch_admin_email(uuid,text)'::regprocedure);
  anchor := ' has a completed club review. Review all items, then select Submit review to finish.';
  if strpos(definition, anchor) = 0 then raise exception 'Expected admin review email instructions'; end if;
  execute replace(definition, anchor, ' has media ready for final review. Approve or reject each item, then select “Submit media review”.');

  definition := pg_get_functiondef('private.attach_media_batches(uuid,uuid)'::regprocedure);
  anchor := $old$d.stage_name||' submitted a batch of '||jsonb_array_length(snapshot)||' media items. Review the batch, then select Submit review.'$old$;
  if strpos(definition, anchor) = 0 then raise exception 'Expected club media email instructions'; end if;
  execute replace(definition, anchor, $new$d.stage_name||' has '||jsonb_array_length(snapshot)||
      case when jsonb_array_length(snapshot)=1 then ' media item' else ' media items' end||
      ' ready for review. Open Approvals to review the media.'$new$);

  -- The profile row was locked before finalization. Only a dancer who was
  -- already approved before this transaction should get the media-update copy.
  definition := pg_get_functiondef('private.finish_resolved_club_media_batch(uuid,jsonb,uuid)'::regprocedure);
  anchor := 'update public.dancer_media_batches set result=v_result where id=b.id;';
  if strpos(definition, anchor) = 0 then raise exception 'Expected completed batch result'; end if;
  execute replace(definition, anchor, $new$if v_result->>'outcome' = 'approved' and d.status = 'approved'
   and (d.approved_at is null or d.approved_at < transaction_timestamp()) then
  v_result := v_result || jsonb_build_object(
    'title', 'Media review complete for ' || club_name, 'action', 'View club results',
    'body', case when jsonb_array_length(p_rejected) > 0 then v_result->>'body'
      else 'Your media review is complete. Open your dashboard to see the results for ' || club_name || '.' end,
    'emailPath', case when not exists (select 1 from jsonb_array_elements(b.items) item where item->>'kind' = 'photo')
      then '/dashboard/dancer#dancer-videos-title' else '/dashboard/dancer#dancer-photos-title' end);
 end if;
 $new$ || anchor);
end $migration$;
