# Scroll playback follow-up — September 12, 2026

The previous one-neighbor window released a clip after moving two cards away.
The live six-swipe baseline included a 2,236 ms backward startup with no source
attached. The incoming TV card also waited for 72% visibility before selection;
these are separate buffering and handoff problems.

## Step 1: two ahead and two behind

- Keep the active source and two neighbors in each direction (maximum five).
- Queue the upcoming two clips first after the active clip has enough buffer.
- Keep recent sources during active buffering, pause offscreen players, cancel
  distant work before starting new warmups, and release neighbors when hidden.
- Share the policy across TV and profile viewers. Data Saver retains its existing
  opt-out. Adaptive neighbors still fetch one segment at a time; originals and
  automatic quality selection are unchanged.

Focused buffer, handoff, adaptive, profile-selection, and shell-split checks pass.
With local production shell code and live media under a 4 Mbps / 100 ms mobile
network simulation, the same six swipes took 255, 266, 251, 52, 100, and 268 ms.
Every incoming clip had a decoded buffer before the swipe, including reversals.
These are browser lab results, not physical-device measurements.

The still-to-motion presentation delay during gradual scrolling is measured
separately in the next step; enlarging the buffer does not fix late selection.
