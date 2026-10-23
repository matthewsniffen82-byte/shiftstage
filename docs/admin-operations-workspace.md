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

## Validation and delivery

Focused PostgreSQL tests exercise club-first publication, exclusive and expired claims, stale versions, staff scopes and role changes. API authorization tests cover every admin route's denial boundary plus the staff scope matrix. Component and queue tests cover review details, confirmation and pagination. No E2E or browser journeys are run.
