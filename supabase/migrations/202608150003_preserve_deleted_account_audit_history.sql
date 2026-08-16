-- Keep completed audit timestamps and statuses when their actor deletes an
-- account. The actor foreign keys use ON DELETE SET NULL, so these checks must
-- allow a historical event to remain after its user reference is cleared.

begin;

alter table public.venue_claim_codes
  drop constraint if exists venue_claim_codes_used_pair_check,
  add constraint venue_claim_codes_used_pair_check check (
    used_at is not null or used_by is null
  ),
  drop constraint if exists venue_claim_codes_revoked_pair_check,
  add constraint venue_claim_codes_revoked_pair_check check (
    revoked_at is not null or revoked_by is null
  );

alter table public.venue_dancer_affiliations
  drop constraint if exists venue_dancer_affiliations_revoke_pair_check,
  add constraint venue_dancer_affiliations_revoke_pair_check check (
    (status = 'active' and revoked_at is null and revoked_by_user_id is null)
    or (status = 'revoked' and revoked_at is not null)
  );

alter table public.venue_dancer_verification_tokens
  drop constraint if exists venue_dancer_verification_tokens_used_pair_check,
  add constraint venue_dancer_verification_tokens_used_pair_check check (
    used_at is not null or used_by_user_id is null
  );

commit;
