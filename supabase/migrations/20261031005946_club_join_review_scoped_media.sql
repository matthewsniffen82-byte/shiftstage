-- Match the club's review queue: later uploads belonging to another club and
-- media removed from this club cannot block its membership decision.
do $migration$
declare
  definition text := pg_get_functiondef('public.review_club_dancer_approval_and_check_in(uuid,uuid,uuid,uuid,text)'::regprocedure);
  anchor text := 'and a.content_version=m.content_version;';
begin
  if position(anchor in definition) = 0 then
    raise exception 'Expected club profile review join missing';
  end if;
  definition := replace(definition, anchor,
    'and a.content_version=m.content_version
    where private.editor_media_available(p_dancer_id,p_venue_id,m.source,m.id)
      and not private.editor_media_removed(p_dancer_id,p_venue_id,m.kind,m.id,m.photo_id);');
  definition := replace(definition,
    'raise exception ''CLUB_PROFILE_MEDIA_REVIEW_REQUIRED'' using errcode=''40001''',
    'raise exception ''CLUB_PROFILE_MEDIA_REVIEW_REQUIRED'' using errcode=''P0001''');
  execute definition;
end
$migration$;

notify pgrst, 'reload schema';
