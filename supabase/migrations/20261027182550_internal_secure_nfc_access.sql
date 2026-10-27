begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.internal_nfc_tags (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null unique references public.internal_roster_links(id) on delete cascade,
  uid text not null unique check (uid ~ '^04[0-9A-F]{12}$'),
  encrypted_keys text not null,
  status text not null default 'staged' check (status in ('staged','active','disabled')),
  generation uuid not null default gen_random_uuid(),
  last_counter integer not null default 0 check (last_counter between 0 and 16777215),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.app_users(id),
  check (status <> 'active' or verified_at is not null)
);
create index internal_nfc_tags_created_by on public.internal_nfc_tags(created_by);
alter table public.internal_nfc_tags enable row level security;
revoke all on public.internal_nfc_tags from public, anon, authenticated;
grant select, insert, update, delete on public.internal_nfc_tags to service_role;

-- Only the server calls this after verifying the SUN cryptogram. The row lock
-- makes accepting a counter and recording the test atomic across all instances.
create function public.consume_internal_nfc_tap(p_id uuid, p_generation uuid, p_counter integer)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare t public.internal_nfc_tags; l public.internal_roster_links;
begin
  select * into t from public.internal_nfc_tags where id=p_id for update;
  if not found or t.generation <> p_generation or t.status='disabled' then
    raise exception 'NFC_UNAVAILABLE' using errcode='42501';
  end if;
  if p_counter is null or p_counter <= t.last_counter or p_counter > 16777215 then
    raise exception 'NFC_REPLAY' using errcode='40001';
  end if;
  select * into l from public.internal_roster_links where id=t.link_id and active and kind='table' for share;
  if not found then raise exception 'NFC_UNAVAILABLE' using errcode='42501'; end if;
  if t.status='active' and not exists (
    select 1 from public.venues v join public.app_users u on u.id=v.owner_user_id
    where v.id=l.venue_id and v.is_active and u.role='venue' and u.account_state='active'
  ) then raise exception 'NFC_UNAVAILABLE' using errcode='42501'; end if;
  update public.internal_nfc_tags set last_counter=p_counter, verified_at=coalesce(verified_at,clock_timestamp()) where id=t.id;
  return jsonb_build_object('status',t.status,'link',l.id,'token',l.token,'generation',t.generation);
end;
$$;
revoke all on function public.consume_internal_nfc_tap(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.consume_internal_nfc_tap(uuid,uuid,integer) to service_role;
comment on table public.internal_nfc_tags is 'Service-only NTAG 424 DNA provisioning and monotonic SUN counters. Keys are encrypted by the application; no public policies.';
commit;
