begin;

-- This migration only prepares the PII-free VerifyMy data model. It deliberately
-- does not change profile visibility or revoke the current automatic approvals.
-- A future VerifyMy cutover must be performed separately when
-- DANCR_IDENTITY_VERIFICATION_MODE is changed to verifymy.

create table if not exists public.dancer_identity_verifications (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null unique references public.dancer_profiles(id) on delete cascade,
  user_id uuid not null unique references public.app_users(id) on delete cascade,
  provider text not null default 'verifymy_content',
  provider_session_id text not null unique,
  status text not null default 'pending',
  last_error_code text,
  verified_at timestamptz,
  redacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dancer_identity_provider_check check (provider = 'verifymy_content'),
  constraint dancer_identity_status_check check (
    status in ('pending', 'started', 'expired', 'failed', 'approved')
  ),
  constraint dancer_identity_no_client_secret check (provider_session_id not like '%_secret_%')
);

comment on table public.dancer_identity_verifications is
  'PII-free VerifyMyContent state. Stores only an opaque provider verification reference, status, safe reason code, and timestamps.';
comment on column public.dancer_identity_verifications.provider_session_id is
  'Opaque VerifyMyContent verification ID. Never store hosted URLs, identity attributes, reports, document images, or selfies.';

alter table public.dancer_identity_verifications enable row level security;

drop policy if exists "dancers read own identity token status" on public.dancer_identity_verifications;
create policy "dancers read own identity token status"
on public.dancer_identity_verifications
for select
using (user_id = auth.uid() or public.is_admin());

grant select on public.dancer_identity_verifications to authenticated;

alter table public.dancer_profiles
  add column if not exists identity_provider text,
  add column if not exists identity_verified_at timestamptz;

alter table public.dancer_profiles
  alter column real_name drop not null;

-- MyDancr no longer collects or retains legal identity fields. Verification
-- documents remain the provider's responsibility; the companion purge job
-- removes legacy storage objects that cannot be deleted transactionally here.
update public.dancer_profiles
set real_name = null
where real_name is not null;

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'real_name'
where id in (select user_id from public.dancer_profiles)
  and coalesce(raw_user_meta_data, '{}'::jsonb) ? 'real_name';

delete from public.approval_reviews
where review_type like 'verification_document:%';

alter table public.dancer_profiles
  drop constraint if exists dancer_profiles_identity_provider_check;
alter table public.dancer_profiles
  add constraint dancer_profiles_identity_provider_check
  check (identity_provider is null or identity_provider = 'verifymy_content');

commit;
