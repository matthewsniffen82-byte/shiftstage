begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Extend the existing operator-only, login-disabled sample roster to 30.
-- These archived fixtures are not new dancer applications or age verifications.
create or replace function private.is_restored_rhino_sample(p_user uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from auth.users u join public.app_users a on a.id=u.id
  join public.dancer_profiles d on d.user_id=u.id
  join public.venues v on v.id::text=u.raw_app_meta_data->>'demo_venue_id'
  where u.id=p_user and u.deleted_at is null and u.banned_until>now()
   and a.role='dancer' and a.account_state='active'
   and u.raw_app_meta_data->>'dataset_marker'='mydancr-rhino-restored-20261028'
   and u.raw_app_meta_data->>'demo_profile_id'=d.id::text
   and d.slug ~ '^echo-grid-(00[1-9]|0[12][0-9]|030)$'
   and u.email=d.slug||'@synthetic.mydancr.invalid'
   and v.slug='spearmint-rhino' and v.is_active);
$$;
revoke all on function private.is_restored_rhino_sample(uuid) from public,anon,authenticated,service_role;

-- The application server may read this single eligibility result, never Auth
-- rows. Anonymous/authenticated callers cannot invoke the private helper.
create function private.restored_rhino_sample_venue(p_dancer uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select (u.raw_app_meta_data->>'demo_venue_id')::uuid
 from public.dancer_profiles d join auth.users u on u.id=d.user_id
 where d.id=p_dancer and private.is_restored_rhino_sample(d.user_id)
$$;
revoke all on function private.restored_rhino_sample_venue(uuid) from public,anon,authenticated;
grant execute on function private.restored_rhino_sample_venue(uuid) to service_role;

create or replace function private.require_initial_media_batch() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.status='approved' and old.status is distinct from 'approved' then
  if private.restored_rhino_sample_venue(new.id) is not null then return new;end if;
  if not exists(select 1 from public.dancer_media_batches where dancer_id=new.id and state='completed') then
   raise exception 'Submit the final media batch before approving this profile.' using errcode='42501';end if;
 end if;
 return new;
end $$;

create or replace function private.club_media_eligibility(p_venue uuid, p_dancers uuid[])
returns table(dancer_id uuid,approved_photos bigint,approved_videos bigint,has_approved_main boolean,eligible boolean,media jsonb)
language sql stable set search_path='' as $$
 with inventory as materialized (
  select x from jsonb_array_elements(public.club_approved_media(p_venue,p_dancers)) x
 ), counts as (
  select d.id,
   count(distinct x->>'photoId') photos,count(distinct x->>'videoId') videos,
   coalesce(bool_or((x->>'isMain')::boolean) filter(where x->>'photoId' is not null),false) has_main,
   coalesce(jsonb_agg(x) filter(where x is not null),'[]'::jsonb) items
  from (select distinct unnest(p_dancers) id) d left join inventory on x->>'dancerId'=d.id::text group by d.id
 )
 select c.id,photos,videos,has_main,
  has_main and (photos>=3 and videos>=1 or photos>=1 and
   coalesce(private.restored_rhino_sample_venue(c.id)=p_venue,false)),items
 from counts c
$$;

commit;
