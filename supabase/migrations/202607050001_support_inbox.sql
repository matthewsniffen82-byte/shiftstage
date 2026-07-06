alter type public.notification_type add value if not exists 'support_message';

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  user_role public.user_role not null,
  subject text not null,
  status text not null default 'open',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  sender_id uuid not null references public.app_users(id) on delete cascade,
  sender_role public.user_role not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists support_threads_user_last_idx on public.support_threads(user_id, last_message_at desc);
create index if not exists support_threads_status_last_idx on public.support_threads(status, last_message_at desc);
create index if not exists support_messages_thread_created_idx on public.support_messages(thread_id, created_at asc);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

create policy "users read own support threads" on public.support_threads for select using (user_id = auth.uid() or public.is_admin());
create policy "users create own support threads" on public.support_threads for insert with check (user_id = auth.uid() or public.is_admin());
create policy "users update own support threads" on public.support_threads for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy "users read own support messages" on public.support_messages for select using (
  exists (select 1 from public.support_threads st where st.id = thread_id and st.user_id = auth.uid())
  or public.is_admin()
);
create policy "users create own support messages" on public.support_messages for insert with check (
  exists (select 1 from public.support_threads st where st.id = thread_id and st.user_id = auth.uid())
  or public.is_admin()
);
