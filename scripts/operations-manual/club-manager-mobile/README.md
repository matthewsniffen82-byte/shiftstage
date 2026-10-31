# Club manager mobile manual

The 30 October 2026 edition replaces all eight instructional mockups with actual application captures using saved training records. The `manager-guide` download serves `output/pdf/mydancr-operations/MyDancr_Club_Manager_Manual.pdf` through the existing role-checked guide endpoint.

The 34-page manual contains 22 topics, the opened dancer profile, first-time page approval, eight populated action pages and linked contents. The separate action-screen index has been removed. Numbered arrows connect screenshots to short steps. There are 31 original screenshot sources across 39 crops. The 29 October overview captures remain, with references to the populated 30 October action screens.

## Populated action screens

- Opened guest/pass details.
- Ride contact and status controls.
- Pending VIP request confirmation and decline.
- New dancer profile approval and decline.
- Media choices and enabled Submit review.
- Table request menus at New, Seen and Arrived stages.
- First-publication preview, change request and approval controls.
- Completed offer preview, audience count and publishing control.

Every new action page is marked `ACTUAL SCREEN - TRAINING DATA`. `live_screens.py` supplies the instructions and crop coordinates; `screenshots/live-manifest.json` records original and cropped asset hashes. Original screenshots are retained beside their crops. PDF embedding uses JPEG compression without redrawing the UI. The earlier `mockups.py` and `illustrations.py` are historical sources and are not imported by this edition.

## Training records

The user authorized populating the demo account and identified `demodancer@mydancr.com` (Kelly) for the new-dancer screen. The dataset marker is `mydancr-manual-captures-20261030`.

`scripts/prepare-manual-capture-accounts.mjs` creates isolated synthetic accounts without invitations. `scripts/seed-manual-capture-records.sql` inserts guarded training records at the existing demo club and a private Manual Training Club. `scripts/complete-manual-training-review.sql` completes only Kelly's private-club media batch, preserves existing profile/check-ins/affiliations, and suppresses its training email within the transaction. Both SQL scripts were rehearsed with rollback before execution. These are explicit preparation utilities, not migrations or application startup seeds.

Kelly was already age verified. A marked training NFC enrollment was staged at the private club; no physical tap or new age verification was claimed. Profile approval remains pending. The existing club remains live, and Manual Training Club remains unpublished. The offer stays a draft; guest admission, VIP confirmation, ride dispatch and customer messages were not triggered. Trigger-created deliveries for newly inserted training requests were removed before the seed transaction committed. The temporary private-club login was retired after capture with `--retire-login`; training records remain. No credentials are committed.

## Build and inspect

Use Python with ReportLab, Pillow, pypdf and pdfplumber; Windows Segoe UI fonts; and Poppler. From the repository root:

```text
python scripts/operations-manual/club-manager-mobile/import_live_captures.py tmp/manual-live-captures
python scripts/operations-manual/club-manager-mobile/build.py
pdftoppm -r 100 -png output/pdf/mydancr-operations/MyDancr_Club_Manager_Manual.pdf tmp/pdfs/club-manager-mobile/page
python scripts/operations-manual/club-manager-mobile/validate.py
node --test tests/operations-guides.test.mjs
```

The import step is only needed when adding fresh browser captures. Existing committed assets suffice for rebuilding. The builder checks content clearance and a PDF size below 4 MB. Validation checks 34 pages, 22 working internal links, eight actual-training labels, zero mockups, screenshot crops and hashes, required action labels, and text bounds. It prepares paired page images for visual review. Inspect every final page for readable pictures, correct arrows, spacing and clipping before delivery. Renders and validation metadata go to ignored `tmp/pdfs/club-manager-mobile/`.

Live browser actions were used to prepare the requested screenshots. No E2E tests were run. `edition.json` records the application source baseline and edition counts.
