# Public safety and privacy intake

Public entry points:

- `/report-harmful-content/submit`: safety reports and intimate-image removal requests, including location-only reports without an account.
- `/privacy/request`: privacy requests without an account or renewed terms acceptance.
- Profile and media report controls collect a complete report before submission. Homepage controls open the shared safety form with the target selected.

The public receipt shows a random case reference and server receipt time. It confirms intake, not a removal, deletion, identity verification, or email delivery. Requests are stored in `content_reports` and appear in the protected administrator Reports queue. Private intake fields are not available through a public case lookup. No attachments or identity documents are collected.

## Queue handling

The queue shows the contact address, requested action/right, authority, original receipt, priority and next-action deadline. Intimate-image requests have an earlier 24-hour internal target and a fixed 48-hour removal deadline from original receipt. Underage and trafficking reports get a one-hour initial review target. Other requests get a 24-hour initial review target. Covered California access/correction/deletion requests also record a conditional 45-day response date; staff must determine jurisdiction and applicable deadlines. The initial review target is not an extension or an automated legal determination.

Use Site Admin → Tools → Safety & privacy (`/admin?alert=compliance_case`) for assignment, backup, jurisdiction, verification, deadlines, notices, closure and related-case references. Closure requires an active owner, triage, decision, notices, follow-up and retention trigger; safety cases require copy-review evidence, while privacy cases require authority, verification outcome and extra-verification-material disposal records. Closed cases are read-only; create a linked follow-up for an appeal or correction. Workflow edits use revision checks to reject stale saves.

`Restrict content; keep case open` changes actual content visibility immediately without waiting for closure paperwork. It records the affected IDs, reviewer and time in one database transaction. A failure rolls everything back. Supported targets are profiles, photos, videos, clubs and shifts. Location-only reports and privacy requests require the reviewer to locate the records and use the relevant controls before resolving the case. The older Reports queue's combined restriction/closure action now also requires the completed case record.

Photo/video restrictions cover every reference to the same stored file and linked photo avatars; existing delivery controls recheck visibility before serving bytes. A private hold prevents reuse/reapproval of the restricted file path. Raw media is not physically deleted by this action. Independently uploaded identical files are not automatically recognized: reviewers must search for them, restrict them and record the result. An existing downloaded copy cannot be recalled.

## Pending operating assignments

- The owner selected `safety@mydancr.com` and confirmed it receives email on October 30, 2026. The existing minute-based email worker queues case alerts to this inbox, with due-soon alerts and hourly overdue escalation reminders. Alerts include a reference, deadline and private queue link, not case details or media. The existing leased outbox handles retries and records provider acceptance/failure; acceptance does not prove mailbox delivery or human response.
- Public follow-up remains `support@mydancr.com`, matching the published notices. No automatic reporter response is sent by this implementation.
- Name the primary and backup reviewers, daily/off-hours coverage and escalation lead. Active Owner administrators and staff explicitly assigned the Safety & privacy role can access the case workflow. Only owners manage the operational registers. The current named assignments and outstanding training/backup details are maintained privately in Reviewers & coverage.
- Staff must perform proportionate identity/agent verification where required before disclosure or deletion. Sale/sharing opt-outs and sensitive-use limitation requests are marked as not requiring identity verification.
- Email and postal requests can be entered through the private external-request form. It preserves the actual earlier receipt and source evidence; neither clarification nor entry restarts the clock. There is no automatic mailbox ingestion.
- Vendor, data inventory, proposed retention, preservation hold, deletion fulfillment, authorized destination and signed-order registers are available in the same private workspace. Seeded entries are drafts; no signature, contract review, adoption, actual deletion or vendor confirmation is inferred. The deletion ledger requires an adopted policy, evidence for all system categories, and a released linked hold before completion. It does not execute cross-system deletion.

DMCA policy, registration and repeat-infringer changes remain on hold. The four supplied internal documents remain private and are not published by this implementation.
