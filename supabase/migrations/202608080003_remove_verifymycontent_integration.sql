begin;

drop table if exists public.dancer_identity_verifications cascade;

alter table public.dancer_profiles
  drop constraint if exists dancer_profiles_identity_provider_check;

alter table public.dancer_profiles
  drop column if exists identity_provider,
  drop column if exists identity_verified_at;

commit;
