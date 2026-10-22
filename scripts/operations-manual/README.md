# Operations documentation

The manual, four role onboarding guides and four one-page cheat sheets are generated from `content.json`, the page layout, and 26 cropped regions of real app screenshots. Arrows are vector callouts drawn in the PDF, not changes to the app interface. `screenshots/sources.json` records the original capture filenames and crop coordinates. Captures from earlier layouts are labeled; unavailable controls are described as text references.

Edition: 21 October 2026, revision 5. Source baseline: `25813c6c0`.

From the repository root, using Python with ReportLab, Pillow, pypdf and pdfplumber:

```text
python scripts/operations-manual/build.py
python scripts/operations-manual/onboarding.py
python scripts/build-operations-packet.py
python scripts/operations-manual/validate.py
```

Outputs remain in `output/pdf/mydancr-operations/`, behind the existing role-checked guides endpoint. The complete packet contains the manual and four cheat sheets. The four longer role guides remain separate downloads. Temporary layout/validation reports go to `tmp/pdfs/operations-manual/`.

After editing, render every changed PDF with Poppler and inspect all pages. Check screenshot arrows against the numbered steps, footer clearances, one-page cheat sheet length, and PDF links. Keep every PDF below the existing private download response limit. Run the focused `tests/operations-guides.test.mjs` tests before delivery. Do not use E2E tests or automated browser journeys.

## Editorial sources

- Role access, venue publication and team: `VenueDashboardPanels.tsx`, `VenueTeamPanel.tsx`, `venue-team-role-descriptions.ts`.
- Requests, admission, VIP, rides and contacts: their venue dashboard panels and API handlers. Contacts distinguish visit details from club email/text subscriptions.
- Dancer setup and media: `DancerProfileWorkspace.tsx`, `DancerProfileEditor.tsx`, `DancerPhotoPanel.tsx`, `DancerTvStudio.tsx`, `dancer-submission-media.ts` and the upload/review handlers.
- Media approval: `VenueMediaReviewPanel.tsx`, `/api/venue/media-reviews`, and current photo/video rules. Reviewer is an assigned owner/manager, not a separate permission role.
- Embedded grids and TV: `VenueWebsiteGrid.tsx`, `VenueTvPanel.tsx`, `public/venue-grid-embed.js` and `docs/venue-working-now-embed.md`. Prefer current code if older documentation differs.
- Refresh: public discovery sync, `InternalRoster.tsx`, `DashboardClient.tsx`, `useVenueOperations.ts`, `VipDashboard.tsx` and the embed script.

The pre-publication sign-off procedure for text/branding is an operating policy. The manual explicitly distinguishes that policy from the technical hold on pending dancer media; it must not claim a universal product-wide approval gate.
