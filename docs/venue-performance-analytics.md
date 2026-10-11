# Venue results and dancer performance

The venue Results workspace uses Tonight, 7 days, and 30 days. Longer periods compare with the immediately preceding interval of identical length. Tonight shows results so far plus live queues. It uses the existing venue-local Tonight boundary from `getTonightWindow`.

## Results

| Measure | Definition |
| --- | --- |
| Guest-list signups | One `venue_guest_list_entries` record per pass, by signup time. |
| Pass claims | Version 1 admission passes, by generation time. Includes guest-list passes. |
| Verified pass admissions | Redeemed version 1 passes, by redemption time. A claim can be from an earlier period. |
| VIP requests received | One request per ID, by creation time, regardless of how many dancers are selected. |
| Table requests received | One internal table request per ID, by creation time. |
| Pickup requests / requested passengers | Existing shuttle submission receipts and their requested party sizes, with notification copies deduplicated. Neither verifies a ride. |
| New venue followers | Current venue follows created during the period. This is not net growth and excludes dancer follows/favorites. |

VIP and internal status breakdowns use the **current state of requests created in the selected interval**. Previous periods can change as those requests are handled. Confirmed VIP requests do not verify arrival; completed internal requests mean staff marked them complete. Do not sum requests, signups, claims and admissions into a customer count.

Tonight’s live VIP counts use scheduled dates, including requests submitted earlier. The internal queue includes pending/acknowledged requests received in the preceding six hours, matching the operational queue. Guest-list passes awaiting admission are currently valid, unused passes; they do not guarantee attendance.

## Dancer channels

- **Internal:** table requests received and current pending/acknowledged/completed/cancelled states, recorded checked-in hours, requests during those hours, requests per recorded hour, and median acknowledgement/completion times with sample counts.
- **External:** explicitly venue-and-dancer-attributed profile opens, club opens, directions, pass claims, verified admissions, offer/transport clicks and “I’m Going” signals. Generic dancer profile popularity and follower counts are excluded.
- **VIP:** current selections in requests, current pending/confirmed/declined/cancelled states and repeat requesters. A dancer gets one credit per request, even for duplicated legacy selection IDs. A multi-dancer request still counts once in venue totals.
- **All:** displays the channels together with their own labels. Request sorting uses table plus VIP request counts as workload, not distinct customers or an overall performance score.

Repeat VIP requesters are distinct VIP accounts that have an earlier request selecting the same dancer at the same venue. This includes declined/cancelled requests and uses current selections, since pending selections may be edited. This measure never claims repeat visits. Analytics return aggregates only, without guest names, emails, phone numbers, account IDs or browser identifiers.

Dancers are searchable and sortable by requests, completed table requests, verified admissions, or name where applicable. The list paginates locally without truncating database counts. Approved public avatars are fetched in batches; other profiles use initials. Private internal-only photos are not published through analytics.

## Reliable timing and hours

Migration `20261011232707_venue_performance_channels.sql` records the deployment time in `venue_performance_tracking`. Request triggers preserve the first observed acknowledgement, completion, confirmation, decline and cancellation timestamps. Notes, retries and later edits do not reset those times. Existing missing history stays null. Cancellation alone does not become a response.

Times are medians from request creation to the recorded transition, across requests created in the selected period. Sample counts make partial history visible. A request created before deployment can gain a reliable response timestamp if handled afterward, but historical transitions are never inferred from `updated_at`.

The private work-session ledger starts existing active check-ins at deployment and records future verified presence, expiration, checkout, venue changes and shift deletion. Shift reuse starts a new session after an interruption. Hours are clipped to the selected interval; overlapping sessions for the same dancer and venue are merged. The rate numerator includes only table requests created during those observed intervals. Historical request totals are still visible independently. Initial rate coverage will be partial until a complete reporting period has been observed.

Clicks, browser counts, shares and TV results remain in supporting disclosures. “I’m Going” signals are explicitly separate from VIP requests. TV retains the existing confirmed-venue-tag and time-bound attribution rules.

## Access and rollout

`get_venue_performance_analytics` wraps the existing subscription analytics RPC without replacing it. It is a service-role-only, security-invoker function with an empty search path. The dashboard authorizes venue access before calling it. New tracking tables have RLS, no public/authenticated grants, and service-role read access only. A non-callable definer trigger maintains the private presence ledger when existing shift commands execute.

Deploy the additive migration before the application commit. Verify aggregate output and permissions read-only, run Supabase advisors, then verify Vercel success for the exact application SHA. Unit/component checks use PGlite and in-memory React/service fixtures; no E2E or browser journeys are used.

Production migration was applied on October 11, 2026 with the Supabase-generated version above; the CLI-created file was aligned to that recorded version. Read-only verification confirmed aggregate output, 498 initially observed work sessions, service-only RPC execution, and denied public ledger reads. Advisors found no new security findings or unindexed foreign keys. Two new indexes initially received informational [unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index); they are retained for dancer foreign-key lookups and venue/time-range request reporting as activity accumulates.
