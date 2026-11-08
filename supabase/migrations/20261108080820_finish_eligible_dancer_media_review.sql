set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The automatic avatar is a rendition of an approved main photo. The club's
-- existing main-photo permission already controls its use on the club card.
create function private.generated_main_avatar_version(p_dancer uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select md5(d.avatar_storage_path)
  from public.dancer_profiles d
  join public.dancer_photos p on p.id = d.avatar_source_photo_id and p.dancer_id = d.id
  where d.id = p_dancer and p.is_primary and p.review_status = 'approved'
    and p.storage_path = d.avatar_source_storage_path
    and d.avatar_storage_path in (p.storage_path, p.storage_path || '.avatar.jpg')
$$;
revoke all on function private.generated_main_avatar_version(uuid) from public, anon, authenticated;
grant execute on function private.generated_main_avatar_version(uuid) to service_role;

-- Exclude only the synthetic inventory row. Uploaded avatars still have their
-- own moderation record, and independent avatar files retain the legacy path.
do $migration$
declare
  definition text := pg_get_functiondef('public.dancer_club_media(uuid[])'::regprocedure);
  anchor text := 'from dancers d where nullif(d.avatar_storage_path,'''') is not null';
begin
  if strpos(definition, anchor) = 0 then raise exception 'Expected avatar inventory branch missing'; end if;
  execute replace(definition, anchor, anchor || ' and private.generated_main_avatar_version(d.id) is null');
end $migration$;

-- Retire untouched, avatar-only queue entries. A real submission, a saved
-- decision or a different version must retain its review history.
delete from public.dancer_media_batches b
where b.state = 'club' and b.club_decisions = '{}' and b.admin_decisions = '{}'
  and b.club_submitted_at is null and jsonb_array_length(b.items) = 1
  and b.items->0->>'key' = 'avatar:' || b.dancer_id
  and b.items->0->>'version' = private.generated_main_avatar_version(b.dancer_id)
  and not exists (
    select 1 from public.dancer_media_submissions s, jsonb_array_elements(s.items) x
    where s.dancer_id = b.dancer_id and x->>'key' = b.items->0->>'key'
      and x->>'version' = b.items->0->>'version'
  );

-- First honor any saved check-in using its actual tap and visibility. The
-- photo trigger normally runs at commit, after the review receipt is written.
do $migration$
declare
  definition text := pg_get_functiondef('private.finish_resolved_club_media_batch(uuid,jsonb,uuid)'::regprocedure);
  anchor text := 'perform public.finalize_pending_dancer_nfc_enrollment';
begin
  if strpos(definition, anchor) = 0 then raise exception 'Expected media finalization missing'; end if;
  execute replace(definition, anchor,
    E'set constraints public.sync_main_photo_avatar immediate;\n  set constraints public.sync_main_photo_avatar deferred;\n  ' || anchor);
end $migration$;

-- An expired or absent tap can prevent a shift, but it does not invalidate
-- the club's affiliation decision or a completed review of sufficient media.
create function private.activate_reviewed_dancer_profile(p_user uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  dancer public.dancer_profiles;
  affiliation public.venue_dancer_affiliations;
begin
  select d.* into dancer from public.dancer_profiles d
  join public.app_users u on u.id = d.user_id and u.role = 'dancer' and u.account_state = 'active'
  where d.user_id = p_user and d.disabled_at is null and d.status = 'pending_review'
    and d.verification_status <> 'rejected' and nullif(trim(d.stage_name),'') is not null
    and nullif(trim(d.city),'') is not null and nullif(d.avatar_storage_path,'') is not null
  for update of d;
  if not found then return false; end if;

  if not exists (select 1 from public.dancer_age_verifications where user_id = p_user
      and provider = 'ondato' and status = 'verified' and verified_at <= now())
    or not exists (select 1 from public.dancer_agreement_acceptances a join public.dancer_agreement_versions v
      on v.version = a.version and v.is_current where a.user_id = p_user)
    or not exists (select 1 from public.dancer_photos where dancer_id = dancer.id and is_primary and review_status = 'approved')
  then return false; end if;

  select a.* into affiliation from public.venue_dancer_affiliations a
  join public.club_dancer_approvals c on c.venue_id = a.venue_id and c.dancer_id = a.dancer_id and c.status = 'approved'
  join public.venues v on v.id = a.venue_id and v.is_active
  join public.app_users owner on owner.id = v.owner_user_id and owner.role = 'venue' and owner.account_state = 'active'
  where a.dancer_id = dancer.id and a.status = 'active' and a.revoked_at is null
    and exists (select 1 from public.dancer_media_batches b where b.dancer_id = dancer.id
      and b.venue_id = a.venue_id and b.state = 'completed' and b.club_submitted_at is not null)
    and private.club_media_ready(a.venue_id, dancer.id)
  order by a.approved_at, a.venue_id limit 1 for update of a;
  if not found then return false; end if;

  update public.dancer_profiles set status = 'approved', verification_status = 'approved',
    approved_at = coalesce(approved_at, now()), venue_approved_at = coalesce(venue_approved_at, now()),
    venue_approved_by_user_id = coalesce(venue_approved_by_user_id, affiliation.approved_by_user_id),
    venue_approved_venue_id = coalesce(venue_approved_venue_id, affiliation.venue_id),
    is_public = is_public and exists (select 1 from public.dancer_channel_preferences
      where dancer_id = dancer.id and visibility in ('external','both'))
  where id = dancer.id;
  return true;
end $$;
revoke all on function private.activate_reviewed_dancer_profile(uuid) from public, anon, authenticated;
grant execute on function private.activate_reviewed_dancer_profile(uuid) to service_role;

do $migration$
declare
  definition text := pg_get_functiondef('public.finalize_pending_dancer_nfc_enrollment(uuid,uuid,jsonb)'::regprocedure);
  anchor text := 'return result;';
begin
  if strpos(definition, anchor) = 0 then raise exception 'Expected saved check-in result missing'; end if;
  execute replace(definition, anchor,
    E'if private.activate_reviewed_dancer_profile(p_dancer_user_id) then\n    result := result || jsonb_build_object(''profileActivated'', true);\n  end if;\n  ' || anchor);
end $migration$;

-- Repair already-reviewed profiles without replaying a shift or sending
-- another review notification. The first successful activation is final.
do $repair$
declare
  dancer_user uuid;
begin
  for dancer_user in select d.user_id from public.dancer_profiles d where d.status = 'pending_review'
    and exists (select 1 from public.dancer_media_batches b where b.dancer_id = d.id and b.state = 'completed')
    order by d.user_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('mydancr:dancer-nfc-enrollment:' || dancer_user::text, 0));
    perform private.activate_reviewed_dancer_profile(dancer_user);
  end loop;
end $repair$;
