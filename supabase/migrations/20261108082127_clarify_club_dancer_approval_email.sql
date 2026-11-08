do $migration$
declare
  definition text := pg_get_functiondef('private.emit_venue_email_event(uuid,text,text,text,text,text,boolean)'::regprocedure);
  old_copy text := 'Review their profile, photos and videos in New dancers. Submit the media review, then approve or decline the profile.';
  new_copy text := 'Open Approvals and review the dancer’s profile. Choose Approve or Reject for each photo and video. To approve the dancer, select “Approve dancer & submit review”.';
begin
  if strpos(definition, old_copy) = 0 then
    raise exception 'Expected club onboarding email instructions missing';
  end if;
  execute replace(definition, old_copy, new_copy);
end $migration$;
