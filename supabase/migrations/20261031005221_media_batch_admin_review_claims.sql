-- Batch publication must participate in the same reviewer claims and audit
-- trail as individual review. Claim after preparation and while each media
-- row is locked, so another reviewer cannot take over mid-publication.
do $migration$
declare
  definition text := pg_get_functiondef('public.submit_admin_media_batch(uuid,uuid,uuid)'::regprocedure);
  anchor text := 'if choice->>''decision'' is null then raise exception ''Review every item before submitting.'' using errcode=''22023'';end if;';
begin
  if position(anchor in definition) = 0 then
    raise exception 'Expected admin batch decision guard missing';
  end if;
  execute replace(definition, anchor, anchor || E'\n  perform public.claim_admin_media(p_actor,m.kind,m.id,(m.record->>''updated_at'')::timestamptz);');
end
$migration$;

notify pgrst, 'reload schema';
