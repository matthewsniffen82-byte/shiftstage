alter table public.dancer_profiles
  add column if not exists is_public boolean not null default true;

create index if not exists dancer_profiles_public_discovery_idx
on public.dancer_profiles (city, stage_name)
where status = 'approved' and is_public = true and disabled_at is null;

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
  and dp.is_public = true
  and dp.disabled_at is null;

drop policy if exists "approved public dancers are public" on public.dancer_profiles;
create policy "approved public dancers are public"
on public.dancer_profiles
for select
using (
  (status = 'approved' and is_public = true and disabled_at is null)
  or user_id = auth.uid()
  or public.is_admin()
);

drop policy if exists "approved photos are public" on public.dancer_photos;
create policy "approved photos are public"
on public.dancer_photos
for select
using (
  (
    review_status = 'approved'
    and exists (
      select 1
      from public.dancer_profiles dp
      where dp.id = dancer_id
        and dp.status = 'approved'
        and dp.is_public = true
        and dp.disabled_at is null
    )
  )
  or exists (
    select 1
    from public.dancer_profiles dp
    where dp.id = dancer_id
      and dp.user_id = auth.uid()
  )
  or public.is_admin()
);

drop policy if exists "approved social links are public" on public.social_links;
create policy "approved social links are public"
on public.social_links
for select
using (
  (
    is_active = true
    and exists (
      select 1
      from public.dancer_profiles dp
      where dp.id = dancer_id
        and dp.status = 'approved'
        and dp.is_public = true
        and dp.disabled_at is null
    )
  )
  or exists (
    select 1
    from public.dancer_profiles dp
    where dp.id = dancer_id
      and dp.user_id = auth.uid()
  )
  or public.is_admin()
);

drop policy if exists "posted approved shifts are public" on public.shifts;
create policy "posted approved shifts are public"
on public.shifts
for select
using (
  (
    status = 'posted'
    and exists (
      select 1
      from public.dancer_profiles dp
      where dp.id = dancer_id
        and dp.status = 'approved'
        and dp.is_public = true
        and dp.disabled_at is null
    )
  )
  or exists (
    select 1
    from public.dancer_profiles dp
    where dp.id = dancer_id
      and dp.user_id = auth.uid()
  )
  or public.is_admin()
);

drop policy if exists "approved rankings are public" on public.trending_scores;
create policy "approved rankings are public"
on public.trending_scores
for select
using (
  exists (
    select 1
    from public.dancer_profiles dp
    where dp.id = dancer_id
      and dp.status = 'approved'
      and dp.is_public = true
      and dp.disabled_at is null
  )
  or exists (
    select 1
    from public.dancer_profiles dp
    where dp.id = dancer_id
      and dp.user_id = auth.uid()
  )
  or public.is_admin()
);

drop policy if exists "approved dancer photos are publicly readable" on storage.objects;
create policy "approved dancer photos are publicly readable"
on storage.objects
for select
using (
  bucket_id = 'dancer-photos'
  and exists (
    select 1
    from public.dancer_photos dp
    join public.dancer_profiles d on d.id = dp.dancer_id
    where dp.storage_path = storage.objects.name
      and dp.review_status = 'approved'
      and d.status = 'approved'
      and d.is_public = true
      and d.disabled_at is null
  )
);
