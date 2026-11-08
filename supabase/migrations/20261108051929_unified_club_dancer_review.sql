-- A dancer's combined approval must include every open batch, including older submissions.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure);
  old_limit text := 'b.created_at,b.id limit 100';
begin
  if strpos(definition, old_limit) = 0 then raise exception 'Expected media queue limit missing'; end if;
  execute replace(definition, old_limit, 'b.created_at,b.id limit case when p_role=''venue'' and p_dancer is not null then null else 100 end');
end $migration$;

-- One club decision commits the reviewed media, affiliation and saved-tap result together.
create function public.approve_dancer_with_media_review(
  p_actor_user_id uuid, p_venue_id uuid, p_dancer_id uuid, p_revision uuid, p_batch_revisions jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  dancer_user uuid;
  batch record;
  submitted jsonb := '{}';
  previous_review text := current_setting('mydancr.club_review_revision', true);
  previous_batch text := current_setting('mydancr.media_batch', true);
begin
  perform private.media_batch_authorize(p_actor_user_id, 'venue', p_venue_id, p_dancer_id);
  select user_id into strict dancer_user from public.dancer_profiles where id = p_dancer_id;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:' || dancer_user::text, 0));
  perform 1 from public.dancer_profiles where id = p_dancer_id for update;
  perform private.attach_media_batches(p_venue_id, p_dancer_id);

  perform set_config('mydancr.club_review_revision', p_revision::text, true);
  for batch in select id, revision from public.dancer_media_batches
    where dancer_id = p_dancer_id and venue_id = p_venue_id and state = 'club' order by created_at, id for update
  loop
    if p_batch_revisions->>batch.id::text is distinct from batch.revision::text then
      raise exception 'CLUB_MEDIA_BATCHES_CHANGED' using errcode = '40001';
    end if;
    submitted := submitted || jsonb_build_object(batch.id, batch.revision);
    perform public.submit_club_media_batch(p_actor_user_id, batch.id, batch.revision);
  end loop;
  if submitted is distinct from p_batch_revisions then
    raise exception 'CLUB_MEDIA_BATCHES_CHANGED' using errcode = '40001';
  end if;
  perform set_config('mydancr.club_review_revision', coalesce(previous_review, ''), true);
  perform set_config('mydancr.media_batch', coalesce(previous_batch, ''), true);
  return public.review_club_dancer_approval_and_check_in(p_actor_user_id, p_venue_id, p_dancer_id, p_revision, 'approved');
end $$;
revoke all on function public.approve_dancer_with_media_review(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.approve_dancer_with_media_review(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- The existing event trigger enqueues approvals@mydancr.com once. Group all batches
-- in a profile decision under its revision; standalone media reviews use the batch ID.
create or replace function private.media_batch_admin_email(p_batch uuid, p_name text) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  k text := 'media-batch:' || coalesce(nullif(current_setting('mydancr.club_review_revision', true), ''), p_batch::text);
  title text := 'Media batch awaiting final review';
  message text := p_name || ' has a completed club review. Review all items, then select Submit review to finish.';
begin
  insert into public.admin_review_email_events(event_key, kind, source_id, title, body)
    values(k, 'media_approval', p_batch, title, message) on conflict do nothing;
  if not found then return; end if;
  insert into public.notifications(recipient_id, notification_type, channel, title, body, payload)
    select id, 'support_message', 'in_app', title, message,
      jsonb_build_object('kind','admin_review','reviewKind','media_approval','sourceId',p_batch,'emailPath','/admin?alert=media_approval')
    from public.app_users where role = 'admin' and account_state = 'active' and admin_workspace_role in ('owner','reviewer');
end $$;

-- Older single-item media events also retain their in-app alerts and shared inbox copy.
create function private.route_individual_admin_review_email() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.admin_review_email_events where event_key = new.event_key and kind = 'media_approval') then
    return null;
  end if;
  return new;
end $$;
revoke all on function private.route_individual_admin_review_email() from public, anon, authenticated;
create trigger admin_media_email_shared_inbox before insert on public.admin_review_email_deliveries
  for each row when (new.recipient_id is not null) execute function private.route_individual_admin_review_email();

notify pgrst, 'reload schema';
