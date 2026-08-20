-- Remove the retired hosted age-verification integration and its audit data.

drop table if exists public.age_verification_sessions;
drop type if exists public.age_verification_status;
