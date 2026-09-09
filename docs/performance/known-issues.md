# Issues observed during performance verification

## Resolved: mobile profile viewer close control overlaps demo notice

Observed in the deployed Step 4 profile journey at 393 × 852 CSS pixels: the fixed `.mydancr-preview-banner` intercepts pointer input intended for `.profile-media-viewer-close`. The viewer close control is positioned 16px below the safe area and does not account for the banner. The existing Escape handler successfully closes the viewer and releases its media. Playback, hidden-page suspension, same-element resume and manual pause all passed.

This is an existing layout issue: Step 4 changes neither the preview banner nor the close-control CSS. It is recorded separately rather than mixed into the video resource optimization. A future focused fix should place the close control below the notice (including dynamic banner height and safe-area insets) and verify pointer closing at mobile widths. The performance smoke test explicitly uses the supported Escape path; it does **not** claim the mobile pointer-close path passed.

Step 12 addresses this issue as part of mobile navigation/resource validation. The complete cause includes `isolation: isolate !important` on the media section, which traps the viewer below both the demo notice and the profile title bar. The section releases isolation only while a viewer is open, and the normal public viewer uses the existing notice inset; native fullscreen is excluded. Its smoke test now requires actual touch closing. Exact deployed matrix results are recorded in the Step 12 delivery archive after release.

Verified fixed at `a57946ce35d7d1544917ee3d041179ddccb934d4` with Vercel success: all six Chromium/WebKit mobile configurations received the close touch, completed eight workflow phases, and released video resources. The separate profile test passed pause/resume on the same element, manual-pause preservation and touch closing. All three dashboard roles passed. The final matrix had no uncaught runtime errors or browser diagnostics; earlier WebKit canceled-navigation diagnostics remain in its baseline artifacts.
