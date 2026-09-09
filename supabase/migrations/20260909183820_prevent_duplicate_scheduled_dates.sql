-- One posted upcoming date per dancer and club. This date-only schedule is
-- separate from NFC presence, demo assignments, drafts and cancelled history.
-- Preflight: 53 shift rows, zero conflicting groups on 2026-09-09.
-- No row is changed or deleted. Abort on conflicts or a busy table.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create unique index shifts_one_posted_scheduled_date_idx
  on public.shifts (dancer_id, venue_id, shift_date)
  where shift_source = 'scheduled' and status = 'posted';

comment on index public.shifts_one_posted_scheduled_date_idx is
  'Prevent duplicate posted upcoming dates; preserve NFC presence and inactive schedule history.';
commit;
