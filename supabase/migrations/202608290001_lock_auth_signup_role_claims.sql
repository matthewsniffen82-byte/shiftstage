-- Browser-controlled auth metadata may select only public account roles.
-- Privileged account roles require an app-metadata claim written by the
-- service-role account provisioning route. Supabase users cannot write their
-- own raw_app_meta_data through public signup or profile-update APIs.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
  public_role text := lower(trim(coalesce(new.raw_user_meta_data->>'role', '')));
  trusted_role text := lower(trim(coalesce(new.raw_app_meta_data->>'mydancr_provisioned_role', '')));
  display_name text;
  real_name text;
  stage_name text;
  city_name text;
begin
  requested_role := case
    when trusted_role in ('admin', 'venue') then trusted_role::public.user_role
    when public_role in ('customer', 'dancer') then public_role::public.user_role
    else 'customer'::public.user_role
  end;

  display_name := nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
  real_name := nullif(trim(coalesce(new.raw_user_meta_data->>'real_name', '')), '');
  stage_name := nullif(trim(coalesce(new.raw_user_meta_data->>'stage_name', '')), '');
  city_name := nullif(trim(coalesce(new.raw_user_meta_data->>'city', '')), '');

  insert into public.app_users (id, role, display_name, email)
  values (
    new.id,
    requested_role,
    case
      when requested_role = 'dancer' then coalesce(display_name, 'Dancer')
      else coalesce(display_name, split_part(new.email, '@', 1))
    end,
    new.email
  )
  on conflict (id) do update set
    role = excluded.role,
    display_name = excluded.display_name,
    email = excluded.email,
    updated_at = now();

  if requested_role = 'customer' then
    insert into public.customer_profiles (user_id, city)
    values (new.id, coalesce(city_name, 'Las Vegas'))
    on conflict (user_id) do nothing;
  end if;

  if requested_role = 'dancer' then
    insert into public.dancer_profiles (
      user_id,
      real_name,
      stage_name,
      slug,
      city,
      status,
      identity_saved_at
    )
    values (
      new.id,
      coalesce(real_name, 'Verification pending'),
      coalesce(stage_name, ''),
      public.unique_dancer_slug(coalesce(stage_name, ''), new.id),
      coalesce(city_name, ''),
      'draft',
      null
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
