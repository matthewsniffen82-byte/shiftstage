begin;

alter table public.shifts
  drop constraint if exists shifts_shift_source_check;

alter table public.shifts
  add constraint shifts_shift_source_check
  check (shift_source in ('scheduled', 'nfc_presence', 'demo_locked'));

alter table public.shifts
  drop constraint if exists shifts_demo_locked_no_nfc_or_commission_check;

alter table public.shifts
  add constraint shifts_demo_locked_no_nfc_or_commission_check
  check (
    shift_source <> 'demo_locked'
    or (
      nfc_tag_id is null
      and nfc_last_tapped_at is null
      and commission_tracking_started_at is null
      and commission_tracking_stopped_at is null
    )
  );

create index if not exists shifts_demo_locked_active_idx
  on public.shifts (dancer_id, venue_id)
  where shift_source = 'demo_locked'
    and status = 'posted'
    and checked_out_at is null;

comment on column public.shifts.shift_source is
  'scheduled for a dancer-posted venue/date, nfc_presence for a six-hour dressing-room tap, or demo_locked for an explicitly managed fictional Demo Mode assignment.';

comment on constraint shifts_demo_locked_no_nfc_or_commission_check on public.shifts is
  'Demo Mode Working Now assignments cannot impersonate NFC taps or participate in commission tracking.';

notify pgrst, 'reload schema';

commit;
