-- Slots 31–60 belong to the operator-managed archived portrait roster.
create or replace function private.is_restored_rhino_sample(p_user uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists (
    select 1
    from auth.users u
    join public.app_users a on a.id = u.id
    join public.dancer_profiles d on d.user_id = u.id
    join public.venues v on v.id::text = u.raw_app_meta_data->>'demo_venue_id'
    where u.id = p_user and u.deleted_at is null and u.banned_until > now()
      and a.role = 'dancer' and a.account_state = 'active'
      and u.raw_app_meta_data->>'dataset_marker' = 'mydancr-rhino-restored-20261028'
      and u.raw_app_meta_data->>'demo_profile_id' = d.id::text
      and u.email = d.slug || '@synthetic.mydancr.invalid'
      and v.slug = 'spearmint-rhino' and v.is_active
      and (
        d.slug ~ '^echo-grid-(00[1-9]|0[12][0-9]|030)$'
        or (
          d.slug ~ '^echo-grid-(03[1-9]|0[45][0-9]|060)$'
          and u.raw_app_meta_data->>'demo_operation' = 'mydancr-archived-portraits-20261109'
        )
      )
  )
$$;
