# Issues observed during performance verification

## Mobile profile viewer close control overlaps demo notice

Observed in the deployed Step 4 profile journey at 393 × 852 CSS pixels: the fixed `.mydancr-preview-banner` intercepts pointer input intended for `.profile-media-viewer-close`. The viewer close control is positioned 16px below the safe area and does not account for the banner. The existing Escape handler successfully closes the viewer and releases its media. Playback, hidden-page suspension, same-element resume and manual pause all passed.

This is an existing layout issue: Step 4 changes neither the preview banner nor the close-control CSS. It is recorded separately rather than mixed into the video resource optimization. A future focused fix should place the close control below the notice (including dynamic banner height and safe-area insets) and verify pointer closing at mobile widths. The performance smoke test explicitly uses the supported Escape path; it does **not** claim the mobile pointer-close path passed.
