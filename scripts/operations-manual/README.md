# MyDancr operations documentation

The 21 October 2026 edition is a complete rewrite. Its prose, layout and screenshots were created from scratch against current application source. No previous manual text or screenshots are inputs. Legacy assets have been retired; earlier editions remain in Git history.

## Deliverables

- 46-page operations manual with 41 procedures, linked contents, role/access guidance, troubleshooting and a release/handover worksheet.
- Four complete role guides: Club Admin (16 pages), Managers and Talent Management (13), Dancers (15), Content Approval Manager (13).
- Four one-page onboarding cheat sheets.
- 50-page complete packet: manual followed by all four sheets, preserving internal contents links.

Final PDFs are in `output/pdf/mydancr-operations/`. The existing role-checked `/api/guides` endpoint serves the same filenames. The catalog in `src/lib/dancr/operations-guides.ts` and the `/guides` page describe this edition. Each PDF must remain below the private response size limit.

## Source and reproducibility

`v2/content.py` is the new editorial source. `v2/build.py` generates all ten PDFs in one pass with ReportLab/Pillow/pypdf. `v2/edition.json` records counts and the application baseline commit. Original capture PNGs and source-file hashes are in `v2/screenshots/manifest.json`.

`v2/capture.cjs` renders actual current React components in isolation with fictional training fixtures. It uses the repository's component markup and styles, suppresses effects, blocks network requests and records arrow target bounds. It does not start the application, log in, submit actions or run browser journeys. These are component screenshots, not live-session captures. The PDFs disclose this on their cover and figure captions. Orange arrows are vector annotations added to the PDFs.

Requirements: repository Node dependencies, Playwright with Edge (or adjust the local capture browser), Python with ReportLab/Pillow/pypdf/pdfplumber, and Poppler. Set `CODEX_NODE_MODULES` to the shared Node modules directory if different from the capture default.

From the repository root:

```text
node scripts/operations-manual/v2/capture.cjs
python scripts/operations-manual/v2/build.py
python scripts/operations-manual/v2/validate.py
python scripts/operations-manual/v2/render.py
node --test tests/operations-guides.test.mjs
```

To recapture selected components, append screenshot IDs to the capture command. Old build/onboarding/packet command paths now delegate to this generator and cannot recreate the retired edition. Temporary layout, validation and rendered QA artifacts go to `tmp/pdfs/operations-manual-v2/`.

Inspect rendered pages for readable screenshots, correct numbered arrows, contents links, text bounds, footer clearance and one-page sheet length. Validation checks every final PDF's counts, text geometry, internal destinations, task coverage, source hashes and packet contents. No E2E tests or automated application journeys are permitted.

## Editorial checks

- Club team and publication: `VenueTeamPanel.tsx`, `VenueDashboardPanels.tsx`, team permission helpers and publication handlers.
- Shift work: `VenueTonightOverview.tsx`, `VenueNfcTagPanel.tsx`, `InternalRoster.tsx`, guest-list, VIP, pickup and contacts panels and handlers.
- Dancer setup: identity/editor components, main/photo/video panels, agreement, age verification, NFC, Working Now, visibility, notification and analytics components and handlers.
- Content review: `VenueMediaReviewPanel.tsx`, media-review handlers, current photo/video rules and publication behavior.
- Platform coordination: table QR and subscription roster components. Club teams coordinate platform-only tasks; they do not gain platform permissions.

The current app does not provide a universal approval gate for every content type. The manual requires recorded pre-publication sign-off for text, branding, offers, embeds and other changes without a technical queue, while explaining the actual pending-media approval workflow. Keep that distinction explicit. Billing data is not connected, club guest-list panels do not admit guests, and the roster menu does not provide an end-check-in button.
