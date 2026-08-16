-- Preserve operational history without preventing a user from deleting the
-- authentication identity that owns their app_users row.

begin;

alter table public.venue_claim_codes
  alter column created_by drop not null,
  drop constraint if exists venue_claim_codes_created_by_fkey,
  add constraint venue_claim_codes_created_by_fkey
    foreign key (created_by) references public.app_users(id) on delete set null;

alter table public.venue_dancer_affiliations
  alter column approved_by_user_id drop not null,
  drop constraint if exists venue_dancer_affiliations_approved_by_user_id_fkey,
  add constraint venue_dancer_affiliations_approved_by_user_id_fkey
    foreign key (approved_by_user_id) references public.app_users(id) on delete set null;

alter table public.venue_dancer_affiliation_events
  alter column actor_user_id drop not null,
  drop constraint if exists venue_dancer_affiliation_events_actor_user_id_fkey,
  add constraint venue_dancer_affiliation_events_actor_user_id_fkey
    foreign key (actor_user_id) references public.app_users(id) on delete set null;

alter table public.nfc_tags
  alter column created_by_user_id drop not null,
  drop constraint if exists nfc_tags_created_by_user_id_fkey,
  add constraint nfc_tags_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users(id) on delete set null;

alter table public.venue_team_invitations
  alter column invited_by_user_id drop not null,
  drop constraint if exists venue_team_invitations_invited_by_user_id_fkey,
  add constraint venue_team_invitations_invited_by_user_id_fkey
    foreign key (invited_by_user_id) references public.app_users(id) on delete set null;

alter table public.venue_nfc_support_requests
  alter column requested_by_user_id drop not null,
  drop constraint if exists venue_nfc_support_requests_requested_by_user_id_fkey,
  add constraint venue_nfc_support_requests_requested_by_user_id_fkey
    foreign key (requested_by_user_id) references public.app_users(id) on delete set null;

commit;
