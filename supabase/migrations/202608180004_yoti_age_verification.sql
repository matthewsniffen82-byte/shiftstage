-- Privacy-minimized Yoti age-verification audit records for the hosted 18+ gate.
-- MyDancr never stores a date of birth, exact age, identity document, or selfie.

create type public.age_verification_status as enum (
  'pending',
  'passed',
  'failed',
  'cancelled',
  'expired',
  'error'
);

create table public.age_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null unique,
  yoti_session_id_hash text unique,
  client_fingerprint_hash text not null,
  status public.age_verification_status not null default 'pending',
  provider_status text not null default 'CREATING',
  method text,
  minimum_age smallint not null default 18 check (minimum_age >= 18),
  failure_code text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  purge_after timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint age_verification_sessions_yoti_hash_check check (
    yoti_session_id_hash is null or yoti_session_id_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint age_verification_sessions_fingerprint_hash_check check (
    client_fingerprint_hash ~ '^[0-9a-f]{64}$'
  )
);

create index age_verification_sessions_rate_limit_idx
  on public.age_verification_sessions (client_fingerprint_hash, created_at desc);
create index age_verification_sessions_retention_idx
  on public.age_verification_sessions (purge_after);

alter table public.age_verification_sessions enable row level security;
revoke all on public.age_verification_sessions from anon, authenticated;
grant all on public.age_verification_sessions to service_role;

comment on table public.age_verification_sessions is
  'Pseudonymous pass/fail audit for hosted Yoti age checks; excludes DOB, exact age, IDs, and biometric media.';
