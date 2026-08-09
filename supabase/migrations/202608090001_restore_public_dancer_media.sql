begin;

alter table public.dancer_profiles alter column is_public set default true;

-- Restore profiles that the venue-gating migration moved back to pending after
-- their avatar and complete photo/video set had already passed moderation.
update public.dancer_profiles dancer
set
  status = 'approved',
  verification_status = 'approved',
  approved_at = coalesce(dancer.approved_at, now()),
  is_public = true
where dancer.status = 'pending_review'
  and dancer.verification_status = 'pending'
  and dancer.venue_approved_at is null
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
  and exists (
    select 1 from public.app_users account
    where account.id = dancer.user_id
      and account.role = 'dancer'
      and account.account_state = 'active'
  );

drop index if exists public.dancer_profiles_public_discovery_idx;
create index dancer_profiles_public_discovery_idx
on public.dancer_profiles (city, stage_name)
where
  (status = 'approved' or verification_status = 'approved')
  and status not in ('rejected', 'disabled')
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
where (dp.status = 'approved' or dp.verification_status = 'approved')
  and dp.status not in ('rejected', 'disabled')
  and dp.is_public = true
  and dp.disabled_at is null;

drop policy if exists "approved public dancers are public" on public.dancer_profiles;
create policy "approved public dancers are public" on public.dancer_profiles for select using (
  (
    (status = 'approved' or verification_status = 'approved')
    and status not in ('rejected', 'disabled')
    and is_public = true
    and disabled_at is null
  )
  or user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "approved photos are public" on public.dancer_photos;
create policy "approved photos are public" on public.dancer_photos for select using (
  (
    review_status = 'approved'
    and exists (
      select 1 from public.dancer_profiles dancer
      where dancer.id = dancer_id
        and (dancer.status = 'approved' or dancer.verification_status = 'approved')
        and dancer.status not in ('rejected', 'disabled')
        and dancer.is_public = true
        and dancer.disabled_at is null
    )
  )
  or exists (select 1 from public.dancer_profiles dancer where dancer.id = dancer_id and dancer.user_id = auth.uid())
  or public.is_admin()
);

drop policy if exists "approved social links are public" on public.social_links;
create policy "approved social links are public" on public.social_links for select using (
  (
    is_active = true
    and exists (
      select 1 from public.dancer_profiles dancer
      where dancer.id = dancer_id
        and (dancer.status = 'approved' or dancer.verification_status = 'approved')
        and dancer.status not in ('rejected', 'disabled')
        and dancer.is_public = true
        and dancer.disabled_at is null
    )
  )
  or exists (select 1 from public.dancer_profiles dancer where dancer.id = dancer_id and dancer.user_id = auth.uid())
  or public.is_admin()
);

drop policy if exists "posted approved shifts are public" on public.shifts;
create policy "posted approved shifts are public" on public.shifts for select using (
  (
    status = 'posted'
    and exists (
      select 1 from public.dancer_profiles dancer
      where dancer.id = dancer_id
        and (dancer.status = 'approved' or dancer.verification_status = 'approved')
        and dancer.status not in ('rejected', 'disabled')
        and dancer.is_public = true
        and dancer.disabled_at is null
    )
  )
  or exists (select 1 from public.dancer_profiles dancer where dancer.id = dancer_id and dancer.user_id = auth.uid())
  or public.is_admin()
);

drop policy if exists "approved rankings are public" on public.trending_scores;
create policy "approved rankings are public" on public.trending_scores for select using (
  exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_id
      and (dancer.status = 'approved' or dancer.verification_status = 'approved')
      and dancer.status not in ('rejected', 'disabled')
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
      and (dancer.status = 'approved' or dancer.verification_status = 'approved')
      and dancer.status not in ('rejected', 'disabled')
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
      and dancer.approved_at is not null
      and dancer.disabled_at is null
      and dancer.is_public = true
  )
);

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
      update public.dancer_profiles
      set
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
      jsonb_build_object('reason', v_affiliation.revoke_reason, 'profileDeactivated', false)
    );
  end if;

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'profileDeactivated', false,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$$;

comment on column public.dancer_profiles.venue_approved_at is
  'First verified venue-manager affiliation. Used for check-in and venue attribution, not profile visibility.';

notify pgrst, 'reload schema';
commit;
