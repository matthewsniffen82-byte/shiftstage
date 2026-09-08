-- Assign stage-name links once, retaining every previous link for existing shares.
begin;

create table public.dancer_profile_slug_aliases (
  slug text primary key,
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index dancer_profile_slug_aliases_dancer_idx on public.dancer_profile_slug_aliases(dancer_id);
alter table public.dancer_profile_slug_aliases enable row level security;
revoke all on public.dancer_profile_slug_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.dancer_profile_slug_aliases to service_role;

create function public.assign_dancer_profile_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  base_slug text;
  candidate text;
  suffix integer := 1;
begin
  -- Serialize assignments, including reservations of old links.
  perform pg_catalog.pg_advisory_xact_lock(7682451001::bigint);
  if new.slug ~ '^dancer(-[0-9]+|-[0-9a-f]{8}(-[0-9]+)?|-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
    and (tg_op = 'INSERT' or new.slug = old.slug) then
    base_slug := trim(both '-' from left(public.slugify(new.stage_name), 70));
    if base_slug <> '' and base_slug <> 'dancer' then
      candidate := base_slug;
      while exists (select 1 from public.dancer_profiles where slug = candidate and id <> new.id)
         or exists (select 1 from public.dancer_profile_slug_aliases where slug = candidate and dancer_id <> new.id) loop
        suffix := suffix + 1;
        candidate := base_slug || '-' || suffix::text;
      end loop;
      new.slug := candidate;
    end if;
  end if;

  if exists (select 1 from public.dancer_profile_slug_aliases where slug = new.slug and dancer_id <> new.id) then
    raise exception 'Profile link is already assigned' using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' and old.slug is distinct from new.slug then
    insert into public.dancer_profile_slug_aliases(slug, dancer_id)
      values (old.slug, new.id) on conflict (slug) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.assign_dancer_profile_link() from public, anon, authenticated;
create trigger assign_dancer_profile_link
before insert or update of stage_name, slug on public.dancer_profiles
for each row execute function public.assign_dancer_profile_link();

-- The trigger changes only generated placeholders and leaves established links alone.
update public.dancer_profiles set stage_name = stage_name
where slug ~ '^dancer(-[0-9]+|-[0-9a-f]{8}(-[0-9]+)?|-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
  and coalesce(trim(stage_name), '') <> '';

commit;
