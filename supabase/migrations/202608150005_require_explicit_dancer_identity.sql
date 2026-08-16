-- A dancer profile is intentionally incomplete until the dancer saves a stage name.
-- Auth metadata and account display names must never complete onboarding implicitly.

alter table public.dancer_profiles
  add column if not exists identity_saved_at timestamptz;

comment on column public.dancer_profiles.identity_saved_at is
  'Set only when the dancer explicitly saves a valid stage name and city.';

alter table public.dancer_profiles
  drop constraint if exists dancer_profiles_stage_name_check;

alter table public.dancer_profiles
  add constraint dancer_profiles_stage_name_check
  check (
    length(trim(stage_name)) = 0
    or length(trim(stage_name)) between 2 and 40
  );

update public.dancer_profiles
set identity_saved_at = coalesce(approved_at, updated_at, created_at)
where identity_saved_at is null
  and status in ('pending_review', 'approved');

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
  display_name text;
  real_name text;
  stage_name text;
  city_name text;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'role', 'customer')::public.user_role;
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
