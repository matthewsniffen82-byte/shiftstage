# Admin operations workspace

The six owner sections remain Home, Approvals, People, Clubs, Billing and Tools.

Home starts with exact counts for media ready for final review, media waiting over 24 hours, file preparation stalled for over 30 minutes, and unpublished club pages. Detailed operations, analytics and activity are available below. Home counts refresh every minute and after successful actions.

The selected club carries into dancer management, media approval, guest and ride operations, the opened club account (including table QR codes and embeds), tap sticker inventory and the billing roster. Club and workspace selections are remembered per signed-in account in session storage. Opened workspaces retain their controls and scroll positions. Global search locates dancers, clubs, account emails and table labels without exposing table access tokens.

## Staff access

Existing admins retain Owner permissions. Owners can change another active admin's workspace role under Tools → Staff permissions. This does not create new staff accounts or send invitations.

| Role | Landing and permissions |
| --- | --- |
| Owner | All six sections and staff permissions |
| Content reviewer | Media review, claims, decisions and history |
| Support | Support inbox, replies and account search |
| Billing | Club subscription roster; payment data still requires the existing billing integration |

Permissions are checked against the database on every request. Scoped staff cannot use legacy admin RLS policies or owner helper functions to bypass the API. Self-demotion is disabled, preserving an owner able to manage access. Successful staff changes are recorded in the admin audit log.

## Media review

Uploads remain private through file preparation, club review and MyDancr final approval. AI moderation is not used. Final media approval continues to honor profile publication and onboarding eligibility.

Approvals separates media into Ready for MyDancr, Waiting on club, File preparation and Decision history. Filter by selected club, dancer or club name, photo/video and waiting age. Totals are exact database counts. Thirty-item pages load continuously with a stable cursor; approving items does not shift the next page or skip uploads.

Selecting a ready upload claims it for that reviewer. Claims last ten minutes and renew every minute while the review is visible. Leaving the item releases the claim; abandoned claims expire. The database prevents another reviewer from committing a competing decision and rejects outdated upload versions. A failed decision leaves the current item in view.

The detail panel shows a full preview, video controls, caption where present, club reviewer/time/notes, and the club and MyDancr decision history. Choose a rejection reason and optionally add a note. Approval or rejection advances only after the server confirms the matching decision. Use Alt+A to approve, Alt+R to focus rejection reasons, and Alt+N for the next item outside text fields. Unsaved notes are retained when switching workspaces; changing the selected item prompts before discarding notes.

Queue totals refresh every 30 seconds without replacing the selected upload, notes or loaded list. Refresh queue explicitly retrieves the latest ordered items. Guest operation refreshes also retain the last visible rows while data loads. Hidden tabs do not claim review items.

The audit ledger records club and MyDancr decisions, reviewer identity and label, notes, timestamps and the reviewed version. Existing recorded decisions are included; decisions not recorded by older software cannot be reconstructed.

## Safety and privacy operations

Owner-only entry: `/admin?alert=compliance_case`, or Tools → Safety & privacy. The four supplied internal documents remain private. This workspace implements their case handling and operational evidence controls; it does not certify compliance or replace human execution of procedures.

Daily operation:

1. Check urgent, unassigned and overdue cases; assign a primary owner and a distinct backup with access. Record off-hours coverage in Reviewers & coverage.
2. For safety cases, restrict supported content immediately when justified. Review independently uploaded copies and downstream destinations; record findings. Do not collect reported media in the case notes.
3. For privacy cases, record jurisdiction, applicable deadline, requester authority and proportionate verification. Opt-out and sensitive-use limitation requests start with verification not required. Perform fulfillment in the responsible systems and record response evidence. Record any extension's reason and notice before changing the response deadline.
4. Enter requests received elsewhere with their original receipt and source reference. Do not re-enter an existing request to reset its clock.
5. Complete notices, decision/action time, verification-material disposal when applicable, retention trigger and follow-up before closure. Use a linked new case for appeals or later corrections.
6. Review shared-inbox alert receipts and failed deliveries. Alerts are operational prompts, not proof that someone reviewed the case. Keep daily and off-hours human coverage.

The records are service-only tables with owner-authorized APIs, bounded text fields, revision checks and append-only action metadata. Database restrictions remain effective if an old client tries to bypass closure requirements. No attachments or raw verification files are supported. Data-map seeds come from the actual production schema; fields about deletion, access reviews and external systems remain unverified until supported by evidence.

### Internal gap disposition (October 30, 2026)

| Audit items | Implemented control | Remaining operating evidence or work |
| --- | --- | --- |
| IG29, CS04, CS28 | Private assignment, deadlines, authority/verification, notices, decision, retention trigger, follow-up, related-case fields and closure checks | Name/train primary and backup, record actual responses and daily reviews; no automatic privacy fulfillment |
| CS05, CS12 | Safety inbox alerts using existing retryable outbox; original external receipt; earlier NCII target; fixed 48-hour cap; due-soon and hourly overdue reminders | Named out-of-hours coverage and legal escalation; confirm actual inbox receipt on a real alert |
| CS13 | Immediate atomic content restriction with same-file/derivative holds, case remains open, restriction evidence survives closure | Staff search for independently uploaded copies; no automatic perceptual duplicate finder |
| DR01–03, DR21–22 | Production schema inventory drafts, policy adoption records, minimal deletion ledger, preserved original trigger, hold/release evidence | Map Storage/Auth, vendor workspaces, logs, exports, devices and backups; verify actual retention jobs and restored-data handling |
| DR10, DR11, DR14, DR15 | Proposed retention entries (180 days / 13 months / 24 months / 3 years) clearly marked draft | Approve or revise periods and scope, then implement and validate destructive jobs; no production purge enabled |
| DR20 | System-by-system deletion confirmations, adopted-policy requirement, failure/retry notes, backup evidence and active-hold completion guard | Actual application/vendor/storage/cache/export/backup deletion execution and confirmation remain manual |
| VR02 | Vendor register for operative contracts, legal entity, workspace, region, subprocessors, access, retention/security and evidence | Obtain signed agreements/DPA acceptance and actual provider configuration/deletion evidence; public policy links alone are insufficient |
| VR10 | Authorized-domain/destination, permission, revocation and cache evidence register | Supply approved destinations/model; verify or implement domain enforcement and downstream revocation accordingly |
| IG07 | Signed club-order evidence register separates operator/authority, agreement and completed order versions, prices and dates | Supply actual signed orders and missing commercial details; this register does not create assent or implement club-facing e-signature |
| CS19, CS23 | No changes | DMCA remains on hold at the user's request |

Needed from the owner: primary/backup names and coverage; retention approver and adoption decisions; operative vendor contracts and account/configuration evidence; approved embed destinations and receiving parties; completed club operator, pricing and pilot/subscription details. Do not mark draft records verified merely because the form is complete. No bulk deletion is authorized solely by the proposed schedule.

### Focused checks

Focused PostgreSQL tests exercise club-first publication, exclusive and expired claims, stale versions, staff scopes and role changes. API authorization tests cover every admin route's denial boundary plus the staff scope matrix. Component and queue tests cover review details, confirmation and pagination. No E2E or browser journeys are run.
