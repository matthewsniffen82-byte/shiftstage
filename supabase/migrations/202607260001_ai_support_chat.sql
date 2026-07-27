alter table public.support_threads
  add column if not exists escalation_status text not null default 'none',
  add column if not exists escalation_category text,
  add column if not exists escalation_reason text,
  add column if not exists escalation_priority text,
  add column if not exists escalated_at timestamptz,
  add column if not exists assigned_admin_id uuid references public.app_users(id) on delete set null,
  add column if not exists ai_reply_count integer not null default 0,
  add column if not exists last_ai_response_id text,
  add column if not exists last_ai_replied_at timestamptz;

alter table public.support_threads
  drop constraint if exists support_threads_escalation_status_check,
  add constraint support_threads_escalation_status_check
    check (escalation_status in ('none', 'pending', 'escalated', 'resolved'));

alter table public.support_threads
  drop constraint if exists support_threads_escalation_priority_check,
  add constraint support_threads_escalation_priority_check
    check (escalation_priority is null or escalation_priority in ('low', 'normal', 'high', 'urgent'));

alter table public.support_messages
  alter column sender_id drop not null,
  add column if not exists sender_kind text not null default 'human',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.support_messages
  drop constraint if exists support_messages_sender_kind_check,
  add constraint support_messages_sender_kind_check
    check (sender_kind in ('human', 'ai', 'system'));

alter table public.support_messages
  drop constraint if exists support_messages_sender_identity_check,
  add constraint support_messages_sender_identity_check
    check (sender_kind <> 'human' or sender_id is not null);

create table if not exists public.support_ai_runs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  trigger_message_id uuid references public.support_messages(id) on delete set null,
  response_message_id uuid references public.support_messages(id) on delete set null,
  provider_response_id text,
  model text not null,
  outcome text not null,
  escalation_category text,
  escalation_priority text,
  escalation_reason text,
  confidence numeric,
  moderation jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists support_threads_escalation_last_idx
  on public.support_threads(escalation_status, escalation_priority, last_message_at desc);

create index if not exists support_ai_runs_thread_created_idx
  on public.support_ai_runs(thread_id, created_at desc);

alter table public.support_ai_runs enable row level security;

drop policy if exists "admins read support ai runs" on public.support_ai_runs;
create policy "admins read support ai runs"
  on public.support_ai_runs
  for select
  using (public.is_admin());
