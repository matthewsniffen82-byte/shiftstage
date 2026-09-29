begin;

create table public.web_push_subscriptions (
  endpoint_hash text primary key check (endpoint_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.app_users(id) on delete cascade,
  endpoint text not null check (length(endpoint) between 20 and 2048),
  p256dh text not null check (length(p256dh) = 87),
  auth text not null check (length(auth) = 22),
  vapid_public_key text not null check (length(vapid_public_key) = 87),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index web_push_subscriptions_user on public.web_push_subscriptions(user_id);
alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.web_push_subscriptions to service_role;

-- Confirmed browser deliveries are retained across table-request queue retries.
create table public.web_push_receipts (
  delivery_id uuid not null,
  endpoint_hash text not null references public.web_push_subscriptions(endpoint_hash) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (delivery_id, endpoint_hash)
);
create index web_push_receipts_age on public.web_push_receipts(delivered_at);
alter table public.web_push_receipts enable row level security;
revoke all on public.web_push_receipts from public, anon, authenticated;
grant select, insert, delete on public.web_push_receipts to service_role;

create function public.save_web_push_subscription(p_user_id uuid, p_endpoint_hash text, p_endpoint text, p_p256dh text, p_auth text, p_vapid_public_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('web_push:' || p_user_id::text, 0));
  if not exists (select 1 from public.app_users where id = p_user_id and account_state = 'active') then
    raise exception 'Active account required';
  end if;
  if not exists (select 1 from public.web_push_subscriptions where endpoint_hash = p_endpoint_hash and user_id = p_user_id)
     and (select count(*) from public.web_push_subscriptions where user_id = p_user_id) >= 12 then
    return false;
  end if;
  insert into public.web_push_subscriptions(endpoint_hash, user_id, endpoint, p256dh, auth, vapid_public_key)
  values(p_endpoint_hash, p_user_id, p_endpoint, p_p256dh, p_auth, p_vapid_public_key)
  on conflict(endpoint_hash) do update set user_id = excluded.user_id, vapid_public_key = excluded.vapid_public_key, updated_at = now()
  where web_push_subscriptions.endpoint = excluded.endpoint
    and web_push_subscriptions.p256dh = excluded.p256dh and web_push_subscriptions.auth = excluded.auth;
  return found;
end;
$$;
revoke all on function public.save_web_push_subscription(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.save_web_push_subscription(uuid,text,text,text,text,text) to service_role;

commit;
