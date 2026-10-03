# Dancer profile visit hierarchy

The existing direct profile and live-shell overlay now use the same reading order:
name, city, live venue, Free Entry, Going, Follow/Share, activity metrics, media.
The report and close controls retain their own row above the name. Existing
handlers, eligibility, attribution, queries, media loading and navigation remain
unchanged. The dashboard editor preview is excluded from the new layout rules.

The hero uses a 58/42 split, adjusted to 52/48 below 400px so longer names and
club names fit. Follow/Share and Going retain 44px touch targets; Free Entry is
48px. Profile-only mobile navigation is 56px instead of 72px. Gallery clearance
includes the existing safe-area and preview-banner offsets.

## Validation

- Changed TSX files and the new regression test pass ESLint with no warnings.
- Live-shell assembly, JavaScript/CSS validation and `git diff --check` pass.
- Application TypeScript passes with the existing untracked `tmp/` QA scripts
  excluded through a temporary config. The unmodified whole-workspace config
  includes those scripts and reports their existing type errors.
- 73 focused tests pass: visit hierarchy, action states/counts/auth, report,
  share feedback, media sharing/playback, internal profiles, overlay return
  behavior and bottom navigation.
- The broader historical profile-layout audit has the same 21 failing tests
  before and after this change, with no new failures. These tests reference
  previous layouts, removed external social links and older schedule markup.
- An additional sharing-reliability audit has two existing mock failures:
  QR-image failure/retry and alias-query filtering. The QR loader function and
  alias-query source are unchanged by this task.

## Isolated component visual review

Rendered current profile markup and styles at 360, 375, 390, 430 and 1280px.
Covered live and inactive profiles, long dancer/club names, and selected
Follow/Going states. The direct profile uses server-rendered existing components;
the overlay uses its existing markup functions. External data/services are
stubbed only in the temporary fixtures; media requests are blocked.

No text clipping, overlapping controls or horizontal panel overflow was found.
The final gallery row clears the mobile dock by at least 16px when fully
scrolled. Portrait and gallery crop rules, aspect ratios and three columns are
unchanged. The small-phone width adjustment prevents mid-word breaks in the
long-name fixture. No application server, browser journey, production interaction
or E2E test was run. Actual device safe-area rendering and network-backed actions
were not exercised; their existing code and focused regression coverage remain
intact.
