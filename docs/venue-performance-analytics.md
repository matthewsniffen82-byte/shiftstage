# Venue results and dancer performance

The venue Results workspace uses Tonight, 7 days, 30 days, and All time. The shared period applies to activity reports; the dancer score always covers the last seven days. The 7-day and 30-day periods compare with the immediately preceding interval of identical length. All time includes all available recorded history, with no prior-period comparison or invented history. Tonight shows results so far plus live queues. It uses the existing venue-local Tonight boundary from `getTonightWindow`.

## Results

The Results page has six priority tiles: verified entries, claim-cohort pass conversion, VIP requests, table requests, distinct checked-in dancers, and dancer checkout accuracy. Seven expandable sections organize Roster activity, Guest list & entries, VIP demand, Internal table demand, Customer interest, Transportation demand, and Dancer contribution. The final section shows the overall score and eight category scores beside each dancer’s portrait. Customer-action source filters and TV details remain inside Customer interest; additional dancer insights remain available within Dancer contribution.

The `automatic` report extension is computed from existing records, without new manager fields or state transitions. It provides current and equal-length previous period aggregates, plus a separately labelled live roster snapshot. All time returns no automatic previous period; Tonight and All time suppress comparisons in the UI. Count comparisons use percentage change; conversion and checkout rates use percentage-point differences. Empty denominators display a dash, and missing aggregate responses are labelled unavailable.

- **Roster:** distinct dancers with observed presence overlapping the period, merged dancer-hours, tracked Both hours, verified check-in events, dancer-owned checkout events, expired verified visits, and complete/eligible ended check-in days. Checkout accuracy is complete days divided by eligible days; active visits and unknown historic actors are ungraded. Internal-only, external-only, Both and unrecorded modes describe the current verified roster, independent of the selected history window. Both requires agreement between the shift channel and dancer preference.
- **Entries:** guest-list signups, nonvoided admission-pass claims, admissions by redemption date, and redemptions by period end from the same claim cohort. Later redemptions cannot change an earlier period's cohort conversion. The normal entry scan supplies verification.
- **VIP:** submissions count once per request. Distinct customers, repeat venue requesters, dancer selections and requested date/hour distributions exclude customer withdrawals. Each request/dancer pair counts once. Repeat customers require an earlier nonwithdrawn request at the same venue, regardless of which dancer was selected; the separate dancer score retains its same-dancer definition. Approvals/declines never determine demand. Peak requested dates and hours use the venue timezone and requests received within the selected period.
- **Tables:** received requests, requests during the recipient's observed presence divided by merged dancer-hours, most requested dancers, busiest table links and request hours. No guest identity or repeat table customer count is inferred from table links. Staff acknowledgement, completion and attendance do not affect these automatic totals.
- **Interest:** club-page visits and distinct browser sessions, venue-attributed dancer profile opens, active follows created in the period, completed shares/copies, directions and Going signals. Existing source filtering remains available. These signals do not verify arrival.
- **Transport:** submitted pickup requests, requested party size from one matching receipt per request, transport clicks and busiest submission hours. Notification copies do not multiply passengers. No ride completion or arrival is inferred.
- **Dancers:** rolling seven-day overall scores, table/VIP request evidence and dancer-profile verified entry conversions. Raw manual arrival/no-show, manager response/completion and revenue metrics are excluded from this automatic Results presentation; operational tools remain available elsewhere.

Peak lists show up to five groups, sorted by count with stable tie-breaking. Counts stay venue-scoped and aggregate in the database without client row limits. No customer account IDs, browser session IDs or contact data leave the automatic report. Private invoker RPCs inherit the existing service-only venue authorization flow. Tests cover withdrawal and selection deduplication, claim cohorts, local-time peaks, prior/all-time boundaries, presence overlap, receipt deduplication, live/historical separation and denied public access.

Migration `20261013040600_venue_automatic_results.sql` was applied to production. Read-only verification returned all 34 automatic fields for Tonight, 7 days, 30 days and All time, retained 96 current-period dancer rows (97 all-time), confirmed bounded conversion/hours and reconciled live roster counts, and verified that public callers cannot execute the report helpers. Security/performance advisors reported no new findings.

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

## Automatic dancer scores (version 7, server only)

Use the full club cohort over the most recent 168 hours. External check-in time accounts for 30 points; published MyDancr TV videos 20; verified profile-pass conversion, internal table demand, check-in activity and VIP demand 10 each; approved profile photos and profile interest 5 each. The first five eligible videos earn four points apiece; the first five eligible photos earn one apiece. An automatic avatar is not an approved gallery photo.

Only the activity budget (75 points) is normalized when at least three activity categories qualify. Otherwise recorded external time of at least five minutes or earned media credit starts an early score using the original weights. Missing inputs do not earn points. The club report includes the overall and individual category values. Scoring weights and calculations stay on the server.

## Reliable timing and hours

Migration `20261011232707_venue_performance_channels.sql` records the deployment time in `venue_performance_tracking`. Request triggers preserve the first observed acknowledgement, completion, confirmation, decline and cancellation timestamps. Notes, retries and later edits do not reset those times. Existing missing history stays null. Cancellation alone does not become a response.

Times are medians from request creation to the recorded transition, across requests created in the selected period. Sample counts make partial history visible. A request created before deployment can gain a reliable response timestamp if handled afterward, but historical transitions are never inferred from `updated_at`.

The private work-session ledger starts existing active check-ins at deployment and records future verified presence, expiration, checkout, venue changes and shift deletion. Shift reuse starts a new session after an interruption. Hours are clipped to the selected interval; overlapping sessions for the same dancer and venue are merged. The rate numerator includes only table requests created during those observed intervals. Historical request totals remain available in the authorized aggregates and venue-wide reports. Initial rate coverage will be partial until a complete reporting period has been observed.

Clicks, browser counts, shares and TV results remain in supporting disclosures. “I’m Going” signals are explicitly separate from VIP requests. TV retains the existing confirmed-venue-tag and time-bound attribution rules.

## Attendance and profile conversions

The dancer results extension retains check-in/out event counts and each dancer's latest recorded check-in within the selected period. Events survive shift deletion; prior events are not reconstructed. Those raw event counts are not used as proof of a dancer's own checkout: expiry reconciliation and staff actions can also set checkout timestamps. Version 3 uses the work-session provenance ledger to pair dancer checkouts and distinguish expiry, staff checkout and other interruptions. Venue-wide attendance summaries remain available independently.

Staff first mark a table request seen, then choose **Mark arrived** or **Didn’t arrive at table**. Mark arrived confirms the dancer actually attended; Complete closes the attended request. Didn’t arrive at table closes it as cancelled and preserves the `no_show` outcome. This is only about acknowledged internal table requests, not shifts or VIP bookings, and is never inferred automatically. These actions require venue staff access and reject stale transitions. Requests remain in the staff inbox after the dancer checks out, within the existing six-hour queue window. Unknown attendance is shown separately. Table attendance rate is arrived / (arrived + no-show), using requests created in the selected period; completed legacy requests never imply arrival.

A **profile conversion** is a dancer-profile admission pass redeemed by staff for entry. Each pass counts once, attributed to its issuing dancer and venue. These are converted passes, not unique people. Voided passes are excluded. Revenue, sales entry and purchase metrics are omitted because there is no club sales/POS feed.

Conversion counts use the redemption date. The claim conversion percentage used by Verified Entry Conversions uses passes claimed in the selected period that converted before its end, divided by all nonvoided profile claims from that period, including expired claims. A null percentage means no qualifying denominator. Dancers can be sorted by Overall, any of the six categories, or name. The underlying channel metrics remain independent.

The additive migration `venue_dancer_results` preserves the previous channel report as `get_venue_performance_channels` and wraps it with these aggregates. All new RPCs are service-only and authorize staff inside the database before writes. Ledgers have RLS and no anonymous or authenticated grants. The new attendance-event trigger is a private definer function; the attendance command is a security invoker with empty search paths.

## Dancer Results

Dancer Results leads with table requests, VIP requests, returning VIP requesters and verified entries. Returning requesters describe repeat request activity, not repeat visits. New followers remain in Audience growth. Shift requests per hour display Early data until one recorded hour is available.

The check-in activity summary follows the selected club and reporting period. It shows dancer check-ins and checkouts, merged recorded hours, hours on both rosters, checkout accuracy and complete checkout days. Accuracy uses the same ended-day rules as venue scoring: all eligible ended visits on a day must have a dancer checkout before expiry. Active visits and historical visits without known checkout provenance do not earn assumed accuracy credit. Recorded hours can include older observed sessions; Both hours require known mode history.

Club Results show the club’s weekly overall and category scores across all analytics period filters.

Migration `20261018055657_dancer_results_roster_activity.sql` adds roster totals through a service-only invoker wrapper while retaining the existing request report. Production verification confirmed aggregate bounds, club totals and private execution privileges. Supabase advisors reported no new findings. Focused tests cover report windows, checkout provenance, overlapping hours, club scoping, score parity and endpoint ownership; no browser journeys were run.

## Access and rollout

`get_venue_performance_analytics` wraps the existing subscription analytics RPC without replacing it. It is a service-role-only, security-invoker function with an empty search path. The dashboard authorizes venue access before calling it. New tracking tables have RLS, no public/authenticated grants, and service-role read access only. A non-callable definer trigger maintains the private presence ledger when existing shift commands execute.

Deploy the additive migration before the application commit. Verify aggregate output and permissions read-only, run Supabase advisors, then verify Vercel success for the exact application SHA. Unit/component checks use PGlite and in-memory React/service fixtures; no E2E or browser journeys are used.

All-time reporting uses the explicit UTC epoch boundary in the service-only subscription RPC. Ordinary custom ranges retain their existing limits and finite-date validation. Migration `20261013000159_venue_all_time_analytics.sql` preserves attribution, permissions and existing records. The separate hair-color analytics feature was retired by `20261101030000_retire_hair_color_analysis.sql`. The CLI-created migration was aligned to the production migration version returned by Supabase. Security and performance advisors reported no new findings.

Production migration was applied on October 11, 2026 with the Supabase-generated version above; the CLI-created file was aligned to that recorded version. Read-only verification confirmed aggregate output, 498 initially observed work sessions, service-only RPC execution, and denied public ledger reads. Advisors found no new security findings or unindexed foreign keys. Two new indexes initially received informational [unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index); they are retained for dancer foreign-key lookups and venue/time-range request reporting as activity accumulates.

The attendance/conversion extension was applied on October 12, 2026 as `20261012225142_venue_dancer_results.sql`. Production read-only verification confirmed the aggregate response and service-only privileges. Advisors reported no new security findings or unindexed foreign keys. The new dancer lookup index received only an informational [unused-index notice](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index); it is retained for its foreign-key lookup as attendance accumulates.

The automatic scoring inputs migration was applied as `20261013011729_automatic_dancer_score_inputs.sql`. The existing report is retained behind a service-only wrapper that adds withdrawal-aware VIP aggregates without exposing customer identities. Production read-only verification returned the new fields for 96 dancer rows and confirmed public/authenticated execution is denied. Supabase security and performance advisors reported no new findings.
