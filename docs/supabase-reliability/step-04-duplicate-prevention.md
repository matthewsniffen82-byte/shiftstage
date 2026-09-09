# Step 4: duplicate and race prevention

## First controlled release: upcoming dates

`createScheduledDancerShift` previously inserted a new row on every request. No database key prevented the same dancer from posting the same date at the same club twice. A double submission or retry after a lost response could therefore create duplicate schedule cards and separate follower-notification events. The edit endpoint could also move a date into an existing posted date.

Migration `20260909183820_prevent_duplicate_scheduled_dates.sql` adds one partial unique index on `(dancer_id, venue_id, shift_date)` where `shift_source = 'scheduled'` and `status = 'posted'`. The schedule UI collects dates, not separate timed shifts at the same club. Drafts, cancelled/completed history, NFC presence and centrally managed demo assignments are excluded. No row, column, policy, function or existing index is removed or rewritten.

The application maps only this index's PostgreSQL `23505` conflict to HTTP 409 with “This upcoming date is already posted at this club.” Other database errors propagate. There is no check-before-insert race, silent success or automatic write retry. A rejected duplicate does not reach the notification broadcast. Existing deterministic notification IDs and ignore-duplicate inserts remain unchanged.

## Production preflight and deployment safety

Read-only preflight at `2026-09-09T18:36:22.915479+00:00` found 53 shifts, zero duplicate posted scheduled-date groups, zero overlapping currently active NFC session groups, zero duplicate photo storage paths and zero case-insensitive dancer slug collisions. All 141 existing unique indexes were valid and ready. The new index and its migration-ledger version were absent, and shifts retained RLS. Only metadata and aggregate counts were returned.

A fresh check at `2026-09-09T19:01:24.907824+00:00` again found 53 shifts and zero conflicts. The active-session check includes scheduled rows that a tap activates in place, as well as NFC presence rows, excluding demo assignments. Inspection of the live activation function confirmed it updates an existing scheduled row or inserts `nfc_presence`; the new index does not block those transitions.

The migration uses an explicit transaction, a three-second lock timeout and a thirty-second statement timeout. A normal unique-index build is appropriate for this measured small table; it briefly blocks writes and aborts on contention. If another request creates a duplicate before the index obtains its lock, PostgreSQL aborts the index creation. Existing rows must not be deleted, merged or reclassified to make it pass. Pause that deployment and review the new conflict instead.

Apply only the exact committed migration to production project `hfmzwadzabmgxkjzmqun`; do not run a blanket `db push` across the known historical ledger gaps. Register only this migration's exact SQL and version in the same transaction. Under the bounded table lock, compare row count and a non-exported data fingerprint before and after, verify RLS and the valid unique index, and verify the stored SQL matches the committed file. Never replay on an uncertain response before checking the ledger and index.

The application remains compatible before the index arrives: it still performs its original insert/update and recognizes the new conflict after database rollout. An application rollback can retain the index, since previous callers already propagate database errors. Prefer retaining this integrity guard. If a later reviewed forward migration must remove it, that change does not require deleting or restoring data; document the temporary loss of duplicate protection rather than silently weakening it.

## Other reviewed duplicate boundaries

| Workflow | Existing protection and review result |
| --- | --- |
| Auth/application and dancer/customer profiles | Account/profile primary and unique keys. Live `provision_app_account_safely` uses insert-on-conflict and locks the account before checking its role; initial dancer slug uses the full user UUID. The legacy fallback confirms a raced profile rather than overwriting it. Lifecycle recovery remains Step 7. |
| Same dancer names and saved profile links | Live `assign_dancer_profile_link` takes a transaction advisory lock before allocating names or reserving aliases. Profile slugs and alias slugs have unique keys. Display names themselves intentionally need not be unique. |
| Favorites, dancer/venue follows and saved deals | Composite primary keys; scoped upsert/insert and duplicate handling prevent repeated relationships. Notification preferences remain explicit writes. |
| Going signals and media likes | Separate partial unique indexes for customer/visitor and photo/video identities enforce the intended relationship cardinality. |
| Venue affiliation and verification | Unique venue/dancer pair; one unused/unrevoked verification token per pair; token digests unique. NFC/profile authorization uses scoped transaction locks. |
| Working Now | Live activation locks the tag and dancer, then takes the dancer-scoped advisory lock before examining active sessions and cooldown. No active duplicate was found. Queued repeats cannot extend the original session. |
| Team invitations and ownership | Unique active membership and pending normalized email/claim keys. Consumed-code workflows use row locks. |
| Redemptions and financial allocations | Live NFC issue/confirm serializes by deal/customer or session and locks redemption rows. Revenue/commission references are unique. Cash-out locks the dancer before request-key and active-batch checks, then locks eligible earnings. Existing financial-race and payout tests remain required. |
| Payment webhooks and notifications | Provider/event key and deterministic notification primary keys prevent duplicate records. External delivery/partial-write recovery still needs the dedicated failure/atomicity review. |
| Analytics | Venue page events have a scoped session/day unique key. Other append-only views/events can legitimately repeat; no blanket uniqueness was added to historical activity. |
| Media | Moderation requests have `(user_id, idempotency_key)` uniqueness and video storage paths are unique. Photo slot selection and replacement still span reads, inserts, removals and storage operations; simultaneous different uploads need a separate controlled investigation before Step 4 is considered complete. No production media was changed. |

## Tests and remaining gates

Eight new in-memory PostgreSQL tests execute the actual migration and application lifecycle with synthetic rows. They cover competing submissions, a lost-response retry, conflicting edits, independent dancers/clubs/dates, cancellation followed by reposting, excluded lifecycle states, unrelated provider failures, and atomic rejection of pre-existing duplicates without data loss. All eight plus five existing shift-boundary tests passed. PGlite queues requests in one embedded instance; it does not reproduce multi-connection Supabase scheduling or historical migration replay.

Validated on source base `a91828a5e223f6161ecae5a1a9503f3d2af31365`, preserving the concurrent account recovery, profile styling and video cleanup changes. All 2,998 full-suite tests passed, along with full lint, explicit TypeScript and the production build. All 30 live readiness checks passed. The complete deployment wrapper also passed on synthetic PostgreSQL rows, including exact committed ledger SQL, unchanged data, retained RLS and rejection of repeat application. The migration's normalized SHA-256 is `1bfb735c395dd0e853246d866f1295a693fef866be6a696eaa99b1b20daa2ea8`.

Production application and exact deployment results are recorded in the execution ledger after commit. This is the first bounded Step 4 release, not completion of all race analysis. The separate media path remains in Step 4 before advancing to Step 5. Step 2's full historical replay remains deferred by the user.
