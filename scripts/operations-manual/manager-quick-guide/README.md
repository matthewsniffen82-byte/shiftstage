# Club manager quick guide

The 29 October 2026 guide is a concise, illustrated alternative to the older manager onboarding manual. The existing `manager-guide` download now serves `MyDancr_Club_Manager_Quick_Guide.pdf`. Older role guides and the combined operations packet remain separate editions.

The ten-page PDF includes nine short procedures and a printable shift checklist. Vector illustrations use sample information and recognizable current control labels. They are intentionally simplified, not screenshots or live customer records. Each page has a PDF bookmark; the checklist links back to the relevant procedure.

## Build and inspect

Use the Codex bundled Python with ReportLab, pypdf and the Windows Segoe UI fonts:

```text
python scripts/operations-manual/manager-quick-guide/build.py
pdftoppm -r 110 -png output/pdf/mydancr-operations/MyDancr_Club_Manager_Quick_Guide.pdf tmp/pdfs/club-manager-guide/page
node --test tests/operations-guides.test.mjs
```

Inspect all ten rendered pages before delivering. The builder checks page count, key instructions, content clearance and response size. Intermediate renders and layout metadata go to the ignored `tmp/pdfs/club-manager-guide/` directory. This workflow uses no browser journeys or E2E tests.

## Editorial sources

Reviewed against the application source on 29 October 2026:

- Navigation and publication: `VenueDashboardPanels.tsx`, `VenueTonightOverview.tsx`.
- Guests, rides and VIP: `VenueGuestListPanel.tsx`, `VenueGuestsPanel.tsx`, `PickupDashboardPanel.tsx`, `VenueVipPanel.tsx`, `VipRequests.tsx`, `venue-operations.ts`.
- Roster and table actions: `VenueNfcTagPanel.tsx`, `InternalRoster.tsx`.
- Profile and media review: `VenueDancerApprovalPanel.tsx`, `VenueMediaReviewPanel.tsx`, `MediaBatchReview.tsx`, `media-limits.ts`.
- Customer offers: `VenueContactsSection.tsx`, `VenueCampaignComposer.tsx`.
- Roles, alerts and help: `venue-team-role-descriptions.ts`, `VenueNotificationSettings.tsx`, `venue-notification-preferences.ts`, `dashboard-help.ts`.
- Results: `VenueValueAnalytics.tsx`.

Keep these distinctions when updating: guest-list status is not an admission action; ride status does not prove entry; media choices need Submit review; club affiliation is separate from full onboarding eligibility; marketing offers do not change the public Club Deal; only the owner manages team invitations and roles. Do not confuse internal guest access duration with dancer check-in duration.
