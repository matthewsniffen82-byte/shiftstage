begin;

drop function if exists public.check_in_manager_approved_dancer_from_nfc(uuid, uuid, uuid, jsonb);

revoke all on function public.register_dancer_nfc_enrollment(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.register_dancer_nfc_enrollment(uuid, uuid, uuid, jsonb) to service_role;

revoke all on function public.finalize_pending_dancer_nfc_enrollment(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_pending_dancer_nfc_enrollment(uuid, uuid, jsonb) to service_role;

comment on function public.register_dancer_nfc_enrollment(uuid, uuid, uuid, jsonb) is
  'Stores the first official dressing-room NFC tap, approves an eligible dancer profile and venue affiliation, and checks in a current posted shift.';

comment on function public.finalize_pending_dancer_nfc_enrollment(uuid, uuid, jsonb) is
  'Completes a saved first NFC tap automatically after dancer profile setup and media moderation become eligible.';

comment on table public.venue_dancer_affiliations is
  'Dancer-to-venue relationships activated by official dressing-room NFC taps and required for Working Now and attributed Club Deal commissions.';

notify pgrst, 'reload schema';

commit;
