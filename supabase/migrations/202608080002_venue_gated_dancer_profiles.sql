begin;

alter table public.dancer_profiles
  add column if not exists venue_approved_at timestamptz,
  add column if not exists venue_approved_by_user_id uuid references public.app_users(id) on delete set null,
  add column if not exists venue_approved_venue_id uuid references public.venues(id) on delete set null;

alter table public.dancer_profiles alter column is_public set default false;

-- Existing venue-manager approvals are authoritative. Profiles which only became
-- public through the former automatic path return to private onboarding.
with first_approval as (
  select distinct on (affiliation.dancer_id)
    affiliation.dancer_id,
    affiliation.approved_at,
    affiliation.approved_by_user_id,
    affiliation.venue_id
  from public.venue_dancer_affiliations affiliation
  where affiliation.status = 'active'
    and affiliation.revoked_at is null
  order by affiliation.dancer_id, affiliation.approved_at asc
)
update public.dancer_profiles dancer
set
  venue_approved_at = proof.approved_at,
  venue_approved_by_user_id = proof.approved_by_user_id,
  venue_approved_venue_id = proof.venue_id
from first_approval proof
where dancer.id = proof.dancer_id
  and dancer.venue_approved_at is null;

update public.dancer_profiles
set
  status = case when status in ('rejected', 'disabled') then status else 'pending_review' end,
  verification_status = case when status in ('rejected', 'disabled') then verification_status else 'pending' end,
  approved_at = null,
  is_public = false
where venue_approved_at is null
  and status not in ('rejected', 'disabled');

drop index if exists public.dancer_profiles_public_discovery_idx;
create index dancer_profiles_public_discovery_idx
on public.dancer_profiles (city, stage_name)
where status = 'approved'
  and verification_status = 'approved'
  and venue_approved_at is not null
  and is_public = true
  and disabled_at is null;

create or replace view public.public_dancer_profiles as
select
  dp.id,
  dp.stage_name,
  dp.slug,
  dp.city,
  dp.bio,
  dp.approved_at,
  ts.rank,
  ts.score,
  ts.trend
from public.dancer_profiles dp
left join public.trending_scores ts on ts.dancer_id = dp.id
where dp.status = 'approved'
  and dp.verification_status = 'approved'
  and dp.venue_approved_at is not null
  and dp.is_public = true
  and dp.disabled_at is null;

drop policy if exists "approved public dancers are public" on public.dancer_profiles;
create policy "approved public dancers are public" on public.dancer_profiles for select using (
  (status = 'approved' and verification_status = 'approved' and venue_approved_at is not null and is_public = true and disabled_at is null)
  or user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "approved photos are public" on public.dancer_photos;
create policy "approved photos are public" on public.dancer_photos for select using (
  (review_status = 'approved' and exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_id
      and dancer.status = 'approved'
      and dancer.verification_status = 'approved'
      and dancer.venue_approved_at is not null
      and dancer.is_public = true
      and dancer.disabled_at is null
  ))
  or exists (select 1 from public.dancer_profiles dancer where dancer.id = dancer_id and dancer.user_id = auth.uid())
  or public.is_admin()
);

drop policy if exists "approved social links are public" on public.social_links;
create policy "approved social links are public" on public.social_links for select using (
  (is_active = true and exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_id
      and dancer.status = 'approved'
      and dancer.verification_status = 'approved'
      and dancer.venue_approved_at is not null
      and dancer.is_public = true
      and dancer.disabled_at is null
  ))
  or exists (select 1 from public.dancer_profiles dancer where dancer.id = dancer_id and dancer.user_id = auth.uid())
  or public.is_admin()
);

drop policy if exists "posted approved shifts are public" on public.shifts;
create policy "posted approved shifts are public" on public.shifts for select using (
  (status = 'posted' and exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_id
      and dancer.status = 'approved'
      and dancer.verification_status = 'approved'
      and dancer.venue_approved_at is not null
      and dancer.is_public = true
      and dancer.disabled_at is null
  ))
  or exists (select 1 from public.dancer_profiles dancer where dancer.id = dancer_id and dancer.user_id = auth.uid())
  or public.is_admin()
);

drop policy if exists "approved rankings are public" on public.trending_scores;
create policy "approved rankings are public" on public.trending_scores for select using (
  exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_id
      and dancer.status = 'approved'
      and dancer.verification_status = 'approved'
      and dancer.venue_approved_at is not null
      and dancer.is_public = true
      and dancer.disabled_at is null
  )
  or exists (select 1 from public.dancer_profiles dancer where dancer.id = dancer_id and dancer.user_id = auth.uid())
  or public.is_admin()
);

drop policy if exists "approved dancer photos are publicly readable" on storage.objects;
create policy "approved dancer photos are publicly readable" on storage.objects for select using (
  bucket_id = 'dancer-photos'
  and exists (
    select 1
    from public.dancer_photos photo
    join public.dancer_profiles dancer on dancer.id = photo.dancer_id
    where photo.storage_path = storage.objects.name
      and photo.review_status = 'approved'
      and dancer.status = 'approved'
      and dancer.verification_status = 'approved'
      and dancer.venue_approved_at is not null
      and dancer.is_public = true
      and dancer.disabled_at is null
  )
);

drop policy if exists "public reads approved MyDancr TV videos" on public.mydancr_tv_videos;
create policy "public reads approved MyDancr TV videos" on public.mydancr_tv_videos for select using (
  status = 'approved'
  and duration_seconds between 1 and 30
  and published_at is not null
  and published_at <= now()
  and (expires_at is null or expires_at > now())
  and exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_id
      and dancer.status = 'approved'
      and dancer.verification_status = 'approved'
      and dancer.photo_review_status = 'approved'
      and dancer.venue_approved_at is not null
      and dancer.approved_at is not null
      and dancer.disabled_at is null
      and dancer.is_public = true
  )
);

create or replace function public.issue_dancer_venue_verification_token(
  p_dancer_id uuid,
  p_user_id uuid,
  p_venue_id uuid,
  p_token_digest text,
  p_request_ip_hash text,
  p_expires_at timestamptz
)
returns public.venue_dancer_verification_tokens
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.venue_dancer_verification_tokens;
  v_now timestamptz := now();
begin
  if p_token_digest !~ '^[0-9a-f]{64}$' or p_request_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid dancer verification token.';
  end if;
  if p_expires_at < v_now + interval '5 minutes' or p_expires_at > v_now + interval '15 minutes' then
    raise exception using errcode = '22023', message = 'Dancer verification links must expire in 5 to 15 minutes.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_dancer_id::text), hashtext(p_venue_id::text));

  if not exists (
    select 1
    from public.dancer_profiles dancer
    join public.app_users account on account.id = dancer.user_id
    where dancer.id = p_dancer_id
      and dancer.user_id = p_user_id
      and dancer.status not in ('rejected', 'disabled')
      and dancer.disabled_at is null
      and nullif(trim(dancer.stage_name), '') is not null
      and nullif(trim(dancer.city), '') is not null
      and nullif(trim(dancer.avatar_storage_path), '') is not null
      and dancer.photo_review_status = 'approved'
      and exists (
        select 1 from public.dancer_photos photo
        where photo.dancer_id = dancer.id and photo.review_status = 'approved'
      )
      and not exists (
        select 1 from public.dancer_photos photo
        where photo.dancer_id = dancer.id and photo.review_status <> 'approved'
      )
      and not exists (
        select 1 from public.mydancr_tv_videos video
        where video.dancer_id = dancer.id and video.status in ('uploading', 'moderating', 'submitted')
      )
      and account.role = 'dancer'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Profile setup and automated media moderation must be complete before venue affiliation.';
  end if;

  if not exists (
    select 1 from public.venues venue
    join public.app_users owner on owner.id = venue.owner_user_id
    where venue.id = p_venue_id and venue.is_active = true and owner.role = 'venue' and owner.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'This venue does not have a verified manager yet.';
  end if;

  if (select count(*) from public.venue_dancer_verification_tokens token where token.created_by_user_id = p_user_id and token.created_at >= v_now - interval '1 hour') >= 5 then
    raise exception using errcode = '42901', message = 'Too many verification links were created. Try again later.';
  end if;
  if (select count(*) from public.venue_dancer_verification_tokens token where token.request_ip_hash = p_request_ip_hash and token.created_at >= v_now - interval '24 hours') >= 20 then
    raise exception using errcode = '42901', message = 'Too many verification links were created from this connection.';
  end if;

  update public.venue_dancer_verification_tokens set revoked_at = v_now
  where venue_id = p_venue_id and dancer_id = p_dancer_id and used_at is null and revoked_at is null;

  insert into public.venue_dancer_verification_tokens (
    venue_id, dancer_id, created_by_user_id, token_digest, request_ip_hash, expires_at
  ) values (
    p_venue_id, p_dancer_id, p_user_id, p_token_digest, p_request_ip_hash, p_expires_at
  ) returning * into v_token;

  insert into public.venue_dancer_affiliation_events (venue_id, dancer_id, actor_user_id, event_type, event_payload)
  values (p_venue_id, p_dancer_id, p_user_id, 'token_issued', jsonb_build_object('tokenId', v_token.id, 'expiresAt', p_expires_at));

  return v_token;
end;
$$;

create or replace function public.approve_dancer_venue_affiliation(
  p_token_digest text,
  p_manager_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.venue_dancer_verification_tokens;
  v_affiliation public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_now timestamptz := now();
  v_profile_activated boolean := false;
begin
  select * into v_token from public.venue_dancer_verification_tokens where token_digest = p_token_digest for update;
  if not found or v_token.expires_at <= v_now or v_token.used_at is not null or v_token.revoked_at is not null then
    raise exception using errcode = '42501', message = 'This dancer verification link is invalid or expired.';
  end if;

  select * into v_venue from public.venues where id = v_token.venue_id for key share;
  if not found or v_venue.is_active = false or v_venue.owner_user_id is distinct from p_manager_user_id
    or not exists (select 1 from public.app_users where id = p_manager_user_id and role = 'venue' and account_state = 'active')
  then
    raise exception using errcode = '42501', message = 'Only this venue''s verified manager can confirm affiliation.';
  end if;

  select * into v_dancer from public.dancer_profiles where id = v_token.dancer_id for update;
  if not found or v_dancer.status in ('rejected', 'disabled') or v_dancer.disabled_at is not null
    or nullif(trim(v_dancer.stage_name), '') is null or nullif(trim(v_dancer.city), '') is null
    or nullif(trim(v_dancer.avatar_storage_path), '') is null or v_dancer.photo_review_status <> 'approved'
    or not exists (select 1 from public.dancer_photos photo where photo.dancer_id = v_dancer.id and photo.review_status = 'approved')
    or exists (select 1 from public.dancer_photos photo where photo.dancer_id = v_dancer.id and photo.review_status <> 'approved')
    or exists (select 1 from public.mydancr_tv_videos video where video.dancer_id = v_dancer.id and video.status in ('uploading', 'moderating', 'submitted'))
    or not exists (select 1 from public.app_users where id = v_dancer.user_id and role = 'dancer' and account_state = 'active')
  then
    raise exception using errcode = '42501', message = 'This dancer has not completed profile setup and automated media moderation.';
  end if;

  insert into public.venue_dancer_affiliations (
    venue_id, dancer_id, status, approved_by_user_id, approved_at, revoked_by_user_id, revoked_at, revoke_reason, updated_at
  ) values (
    v_token.venue_id, v_token.dancer_id, 'active', p_manager_user_id, v_now, null, null, null, v_now
  ) on conflict (venue_id, dancer_id) do update set
    status = 'active', approved_by_user_id = excluded.approved_by_user_id, approved_at = excluded.approved_at,
    revoked_by_user_id = null, revoked_at = null, revoke_reason = null, updated_at = excluded.updated_at
  returning * into v_affiliation;

  v_profile_activated := v_dancer.venue_approved_at is null;
  update public.dancer_profiles set
    status = 'approved',
    verification_status = 'approved',
    approved_at = coalesce(approved_at, v_now),
    is_public = true,
    venue_approved_at = coalesce(venue_approved_at, v_now),
    venue_approved_by_user_id = coalesce(venue_approved_by_user_id, p_manager_user_id),
    venue_approved_venue_id = coalesce(venue_approved_venue_id, v_token.venue_id)
  where id = v_dancer.id;

  update public.venue_dancer_verification_tokens set used_at = v_now, used_by_user_id = p_manager_user_id where id = v_token.id;
  update public.venue_dancer_verification_tokens set revoked_at = v_now
  where venue_id = v_token.venue_id and dancer_id = v_token.dancer_id and id <> v_token.id and used_at is null and revoked_at is null;

  insert into public.venue_dancer_affiliation_events (affiliation_id, venue_id, dancer_id, actor_user_id, event_type, event_payload)
  values (v_affiliation.id, v_affiliation.venue_id, v_affiliation.dancer_id, p_manager_user_id, 'affiliation_approved', jsonb_build_object('tokenId', v_token.id, 'profileActivated', v_profile_activated));

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'approvedAt', v_affiliation.approved_at,
    'profileActivated', v_profile_activated,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$$;

create or replace function public.revoke_dancer_venue_affiliation(
  p_affiliation_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_affiliation public.venue_dancer_affiliations;
  v_replacement public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
  v_profile_deactivated boolean := false;
begin
  select * into v_affiliation
  from public.venue_dancer_affiliations
  where id = p_affiliation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue affiliation not found.';
  end if;

  select * into v_dancer from public.dancer_profiles where id = v_affiliation.dancer_id for update;
  select * into v_venue from public.venues where id = v_affiliation.venue_id;

  if p_actor_user_id is distinct from v_dancer.user_id
    and p_actor_user_id is distinct from v_venue.owner_user_id
  then
    raise exception using errcode = '42501', message = 'Only the dancer or verified venue manager can remove this affiliation.';
  end if;

  if v_affiliation.status = 'active' then
    update public.venue_dancer_affiliations
    set
      status = 'revoked',
      revoked_by_user_id = p_actor_user_id,
      revoked_at = v_now,
      revoke_reason = coalesce(v_reason, 'Affiliation removed by an authorized account.'),
      updated_at = v_now
    where id = v_affiliation.id
    returning * into v_affiliation;

    update public.shifts
    set
      checked_out_at = v_now,
      location_status = 'self_reported',
      location_verification_expires_at = v_now,
      working_status = 'ended',
      commission_tracking_stopped_at = coalesce(commission_tracking_stopped_at, v_now),
      ended_at = coalesce(ended_at, v_now),
      ended_reason = 'venue_affiliation_revoked',
      updated_at = v_now
    where dancer_id = v_affiliation.dancer_id
      and venue_id = v_affiliation.venue_id
      and checked_in_at is not null
      and checked_out_at is null;

    select * into v_replacement
    from public.venue_dancer_affiliations
    where dancer_id = v_affiliation.dancer_id
      and status = 'active'
      and revoked_at is null
    order by approved_at asc
    limit 1;

    if found then
      update public.dancer_profiles
      set
        venue_approved_at = v_replacement.approved_at,
        venue_approved_by_user_id = v_replacement.approved_by_user_id,
        venue_approved_venue_id = v_replacement.venue_id
      where id = v_affiliation.dancer_id;
    else
      v_profile_deactivated := true;
      update public.dancer_profiles
      set
        status = case when status in ('rejected', 'disabled') then status else 'pending_review' end,
        verification_status = case when status in ('rejected', 'disabled') then verification_status else 'pending' end,
        approved_at = null,
        is_public = false,
        venue_approved_at = null,
        venue_approved_by_user_id = null,
        venue_approved_venue_id = null
      where id = v_affiliation.dancer_id;
    end if;

    insert into public.venue_dancer_affiliation_events (
      affiliation_id, venue_id, dancer_id, actor_user_id, event_type, event_payload
    ) values (
      v_affiliation.id,
      v_affiliation.venue_id,
      v_affiliation.dancer_id,
      p_actor_user_id,
      'affiliation_revoked',
      jsonb_build_object('reason', v_affiliation.revoke_reason, 'profileDeactivated', v_profile_deactivated)
    );
  end if;

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'profileDeactivated', v_profile_deactivated,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$$;

revoke all on function public.issue_dancer_venue_verification_token(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.issue_dancer_venue_verification_token(uuid, uuid, uuid, text, text, timestamptz) to service_role;
revoke all on function public.approve_dancer_venue_affiliation(text, uuid) from public;
grant execute on function public.approve_dancer_venue_affiliation(text, uuid) to service_role;
revoke all on function public.revoke_dancer_venue_affiliation(uuid, uuid, text) from public;
grant execute on function public.revoke_dancer_venue_affiliation(uuid, uuid, text) to service_role;

comment on column public.dancer_profiles.venue_approved_at is
  'First verified venue-manager affiliation. Required before a dancer profile can be public.';

notify pgrst, 'reload schema';
commit;
