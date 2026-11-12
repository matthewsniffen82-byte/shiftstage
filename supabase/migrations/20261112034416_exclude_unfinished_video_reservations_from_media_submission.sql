-- The editor tracks live transfers. A reservation on its own can belong to a
-- disconnected client and has no prepared video to include in a submission.
create function private.media_submission_video_processing(
  video_status text, validation_pending boolean, started_at timestamptz, completed_at timestamptz
) returns boolean language sql stable security invoker set search_path = '' as $$
  select (video_status = 'moderating' or (video_status = 'submitted' and validation_pending))
    and completed_at is null
    and (started_at is null or started_at >= now() - interval '5 minutes')
$$;
revoke all on function private.media_submission_video_processing(text,boolean,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function private.media_submission_video_processing(text,boolean,timestamptz,timestamptz) to service_role;

-- Use the same processing gate for the dancer's status read and both submit
-- paths. The existing snapshot still selects only media that passed its checks.
do $migration$
declare
  target record;
  definition text;
  old_video text;
  new_video text;
  old_photo constant text := 'status in (''pending'',''moderating'',''moderation_retry'')';
begin
  for target in select * from (values
    ('public.get_media_batches_page(uuid,text,uuid,uuid,integer,integer,boolean)'::regprocedure, 'v.'),
    ('public.submit_dancer_media_batch(uuid)'::regprocedure, ''),
    ('private.submit_checked_in_media_batch(uuid,uuid)'::regprocedure, 't.')
  ) as targets(signature, prefix) loop
    definition := pg_get_functiondef(target.signature);
    old_video := format('(%1$sstatus in (''uploading'',''moderating'') or %1$supload_validation_pending)', target.prefix);
    new_video := format('private.media_submission_video_processing(%1$sstatus, %1$supload_validation_pending, %1$smoderation_started_at, %1$smoderation_completed_at)', target.prefix);
    if array_length(string_to_array(definition, old_video), 1) <> 2
      or array_length(string_to_array(definition, old_photo), 1) <> 2 then
      raise exception 'Unexpected media processing guard in %', target.signature;
    end if;
    execute replace(replace(definition, old_video, new_video), old_photo, 'status in (''pending'',''moderating'')');
  end loop;
end $migration$;
