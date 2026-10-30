# Club manager mobile manual

The 30 October 2026 edition keeps the actual mobile captures from the 29 October, 26-page manager packet and adds eight clearly labeled instructional mockups. The current `manager-guide` download serves `output/pdf/mydancr-operations/MyDancr_Club_Manager_Manual.pdf` through the existing role-checked guide endpoint.

The 35-page manual contains the original 22 topics, first-time page approval, the opened dancer profile, eight example pages and linked contents. Numbered arrows connect pictures to short steps. All 21 original screenshot sources are preserved across 29 crops. Crops are JPEG-compressed without changing the captured UI. The screenshot manifest records their original filenames, crop coordinates, capture date and asset hashes; its page field refers to the original 26-page packet.

## Missing states illustrated

- Opened guest/pass details behind an empty guest list.
- Ride contact and status controls behind an empty queue.
- VIP Confirm request and Decline actions behind an empty queue.
- New dancer profile approval/decline behind an empty queue.
- Media Approve, Reject and Submit review controls where the batch failed to load.
- Table request actions behind an empty queue, shown as successive stages.
- First-publication preview, change request and approval controls, because the captured club was already live.
- Completed offer preview and publishing, where only a blank composer was captured.

Every example is marked `MOCKUP - SAMPLE DATA`. These are simplified native PDF vectors, not actual screenshots. They use fictional names and current control labels checked against the source files listed in `mockups.py`. No live records, approvals, messages or requests were created to prepare them. The actual Website grid screenshot remains and points to Preview website grid; the embedded website itself is not fabricated.

## Build and inspect

Use Python with ReportLab, Pillow, pypdf and pdfplumber; Windows Segoe UI fonts; and Poppler. From the repository root:

```text
python scripts/operations-manual/club-manager-mobile/build.py
pdftoppm -r 100 -png output/pdf/mydancr-operations/MyDancr_Club_Manager_Manual.pdf tmp/pdfs/club-manager-mobile/page
python scripts/operations-manual/club-manager-mobile/validate.py
node --test tests/operations-guides.test.mjs
```

The builder checks content clearance and a PDF size below 4 MB. Validation checks 35 pages, 30 working internal links, eight mockup labels, all screenshot crops and hashes, required action labels, and text bounds. It also prepares paired page images for review. Inspect every final page for readable pictures, correct arrows, spacing and clipping before delivery. Renders and validation metadata go to ignored `tmp/pdfs/club-manager-mobile/`.

This workflow does not use browser journeys or E2E tests. `edition.json` records the source baseline and edition counts. Recheck mockup controls when the corresponding application components change; do not silently convert examples into purported live screenshots.
