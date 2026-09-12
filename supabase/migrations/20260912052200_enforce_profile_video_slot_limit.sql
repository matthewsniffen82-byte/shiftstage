-- Enforce the existing fifty-video profile library limit in the transaction.
-- Existing rows, ownership, grants and visibility are preserved.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.enforce_mydancr_tv_profile_video_limit()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  current_video_count integer;
begin
  if new.distribution_scope <> 'profile_and_feed'
    or new.status not in ('uploading', 'moderating', 'submitted', 'approved', 'rejected')
  then
    return new;
  end if;

  -- Transitions inside the same occupied slot do not acquire another slot.
  if tg_op = 'UPDATE' then
    if old.dancer_id = new.dancer_id
      and old.distribution_scope = 'profile_and_feed'
      and old.status in ('uploading', 'moderating', 'submitted', 'approved', 'rejected')
    then
      return new;
    end if;
  end if;

  -- Repeatable Read can retain a snapshot taken before an advisory-lock wait.
  -- Current PostgREST callers use Read Committed; Serializable uses SSI.
  if current_setting('transaction_isolation') = 'repeatable read' then
    raise exception using errcode = '25000',
      message = 'Profile video reservations require Read Committed or Serializable isolation.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('mydancr:profile-video-slots:' || new.dancer_id::text, 0)
  );

  -- AFTER observes the final row and excludes ignored ON CONFLICT inserts.
  -- VOLATILE PL/pgSQL takes a fresh Read Committed snapshot after the lock.
  select count(*) into current_video_count
  from public.mydancr_tv_videos
  where dancer_id = new.dancer_id
    and distribution_scope = 'profile_and_feed'
    and status in ('uploading', 'moderating', 'submitted', 'approved', 'rejected');

  if current_video_count > 50 then
    raise exception using errcode = '23514',
      message = 'You can upload up to 50 profile videos. Remove one before adding another.';
  end if;
  return new;
end;
$function$;

-- This attachment is absent in the audited production catalog.
-- Do not drop an unexpected existing trigger during deployment.
create trigger enforce_mydancr_tv_profile_video_limit
  after insert or update of dancer_id, distribution_scope, status
  on public.mydancr_tv_videos
  for each row execute function public.enforce_mydancr_tv_profile_video_limit();

commit;