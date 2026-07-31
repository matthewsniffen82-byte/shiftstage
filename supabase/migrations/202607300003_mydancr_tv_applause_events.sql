-- Record a lightweight, privacy-safe MyDancr TV reaction without creating
-- a saved-video collection or exposing viewer identity publicly.

alter table public.mydancr_tv_events
  drop constraint if exists mydancr_tv_event_type_check;

alter table public.mydancr_tv_events
  add constraint mydancr_tv_event_type_check check (
    event_type in (
      'impression',
      'engaged_view',
      'completed',
      'profile_click',
      'venue_click',
      'shift_click',
      'follow',
      'going',
      'reminder',
      'applause',
      'share',
      'report'
    )
  );
