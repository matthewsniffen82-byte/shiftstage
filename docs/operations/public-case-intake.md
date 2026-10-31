# Public safety and privacy intake

Public entry points:

- `/report-harmful-content/submit`: safety reports and intimate-image removal requests, including location-only reports without an account.
- `/privacy/request`: privacy requests without an account or renewed terms acceptance.
- Profile and media report controls collect a complete report before submission. Homepage controls open the shared safety form with the target selected.

The public receipt shows a random case reference and server receipt time. It confirms intake, not a removal, deletion, identity verification, or email delivery. Requests are stored in `content_reports` and appear in the protected administrator Reports queue. Private intake fields are not available through a public case lookup. No attachments or identity documents are collected.

## Queue handling

The queue shows the contact address, requested action/right, authority, receipt, priority and next-action deadline. Intimate-image requests get a 48-hour deadline from receipt. Underage and trafficking reports get a one-hour initial review target. Other requests get a 24-hour initial review target. Covered California access/correction/deletion requests also record a conditional 45-day response date; staff must determine jurisdiction and applicable deadlines. The initial review target is not an extension or an automated legal determination.

Closing a case requires a decision/follow-up note. `Restrict content and close` changes actual content visibility and records the affected IDs, reviewer and time in one database transaction. A failure rolls everything back. Supported targets are profiles, photos, videos, clubs and shifts. Location-only reports and privacy requests require the reviewer to locate the records and use the relevant controls before resolving the case.

Photo/video restrictions cover every reference to the same stored file and linked photo avatars; existing delivery controls recheck visibility before serving bytes. A private hold prevents reuse/reapproval of the restricted file path. Raw media is not physically deleted by this action. Independently uploaded identical files are not automatically recognized: reviewers must search for them, restrict them and record the result. An existing downloaded copy cannot be recalled.

## Pending operating assignments

- The owner selected `safety@mydancr.com` as the safety-alert inbox. Mailbox/alias provisioning and successful receipt have not been verified.
- Public follow-up remains `support@mydancr.com`, matching the published notices, until the new inbox works.
- Name the primary and backup reviewers, provide coverage, and confirm the safety mailbox/alias is monitored. Creating a case does not yet send an urgent email or a reporter response; the admin queue must be monitored.
- Staff must perform proportionate identity/agent verification where required before disclosure or deletion. Sale/sharing opt-outs and sensitive-use limitation requests are marked as not requiring identity verification.
- Email and postal requests still need manual case entry/handling, preserving their original receipt time; the form receipt trigger is only for newly received web submissions. Automated mailbox ingestion, escalation delivery, case assignment, privacy fulfillment, retention/deletion schedules and vendor evidence remain separate internal work.

DMCA policy, registration and repeat-infringer changes remain on hold. The four supplied internal documents remain private and are not published by this implementation.
