create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.app_users(id) on delete set null,
  target_type text not null default 'profile',
  target_id uuid,
  target_label text not null,
  reason text not null,
  details text,
  status text not null default 'open',
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint content_reports_status_check check (status in ('open', 'resolved', 'removed'))
);

create index if not exists content_reports_status_created_idx on public.content_reports(status, created_at desc);
create index if not exists content_reports_target_idx on public.content_reports(target_type, target_id);

alter table public.content_reports enable row level security;

drop policy if exists "users create content reports" on public.content_reports;
create policy "users create content reports" on public.content_reports for insert with check (
  reporter_id is null or reporter_id = auth.uid() or public.is_admin()
);

drop policy if exists "admins manage content reports" on public.content_reports;
create policy "admins manage content reports" on public.content_reports for all using (public.is_admin()) with check (public.is_admin());
