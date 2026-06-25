-- Creates Dancr account/profile records automatically when a Supabase auth user signs up.

create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.unique_dancer_slug(stage_name text, user_id uuid)
returns text
language plpgsql
stable
as $$
declare
  base_slug text;
  candidate text;
  suffix int := 0;
begin
  base_slug := public.slugify(stage_name);

  if base_slug = '' then
    base_slug := 'dancer';
  end if;

  candidate := base_slug;

  while exists (
    select 1
    from public.dancer_profiles
    where slug = candidate
      and dancer_profiles.user_id <> unique_dancer_slug.user_id
  ) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  return candidate;
end;
$$;

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
  stage_name := nullif(trim(coalesce(new.raw_user_meta_data->>'stage_name', display_name, '')), '');
  city_name := nullif(trim(coalesce(new.raw_user_meta_data->>'city', '')), '');

  insert into public.app_users (id, role, display_name, email)
  values (
    new.id,
    requested_role,
    coalesce(display_name, stage_name, split_part(new.email, '@', 1)),
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
      status
    )
    values (
      new.id,
      coalesce(real_name, 'Verification pending'),
      coalesce(stage_name, display_name, 'New Dancer'),
      public.unique_dancer_slug(coalesce(stage_name, display_name, 'New Dancer'), new.id),
      coalesce(city_name, 'Las Vegas'),
      'draft'
    )
    on conflict (user_id) do update set
      real_name = excluded.real_name,
      stage_name = excluded.stage_name,
      city = excluded.city,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop policy if exists "users create own app profile" on public.app_users;
create policy "users create own app profile"
on public.app_users
for insert
with check (id = auth.uid());
