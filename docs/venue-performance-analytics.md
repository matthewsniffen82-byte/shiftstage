# Venue results and dancer performance

The venue Results workspace uses Tonight, 7 days, 30 days, and All time. The shared period applies to every dancer section and the supporting reports. The 7-day and 30-day periods compare with the immediately preceding interval of identical length. All time includes all available recorded history, with no prior-period comparison or invented history. Tonight shows results so far plus live queues. It uses the existing venue-local Tonight boundary from `getTonightWindow`.

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

## Automatic dancer scores (version 2)

The private venue report shows **Overall Performance**, **Check-in Activity**, **Internal Table Requests**, **VIP Requests**, **Profile Interest**, and **Verified Entry Conversions**. Each score includes its sample evidence; small or partial samples display **Early data**. Search, sort and pagination happen after scoring the complete authorized venue/period report and cannot alter benchmarks or ranks. No manager acknowledgement, completion, arrival or booking-status action is needed to maintain scores.

These are product activity indicators, not validated ratings of talent, reliability, scheduled-shift attendance, revenue or future performance. Appearance and private identity data never enter the formula. Scores stay private to authorized venue staff, are not permanent ratings, and do not change access or staffing.

### Formula

For relative comparisons, points are `100 * value / (value + medianPositive)`. The baseline is the median positive value among qualifying dancers at this club for the same period. At least three qualifying dancers are needed. Typical positive activity scores 50; zero scores zero. Benchmarks can move as other dancers' activity changes.

| Category | Calculation | Overall weight |
| --- | --- | --- |
| Check-in Activity | Relative recorded checked-in hours. Overlapping sessions are merged by the existing work ledger. Tap counts and checkout counts add no points. | 15% |
| Internal Table Requests | Relative requests received during recorded presence divided by recorded hours. Staff acknowledgement/completion/arrival status is ignored. | 25% |
| VIP Requests | 80% relative customer selections + 20% returning-customer share among distinct requesting accounts. Customer-withdrawn requests are excluded from current demand and repeat history; staff decisions are ignored. | 20% |
| Profile Interest | Relative weighted sum of explicitly dancer-and-venue-attributed events: profile opens 1; club opens, follows and completed shares 2; directions, transport, offer clicks and I'm Going signals 3. | 10% |
| Verified Entry Conversions | 100 × redeemed profile-pass claim cohort / profile-pass claims. Both use the same claim cohort and period end. Voided passes are excluded. No peer comparison is required for this absolute percentage. | 30% |

Category scores are rounded to integers from 0 to 100. Overall is the weighted mean of the displayed eligible category scores, with available weights normalized to 100%, rounded again. At least three categories are required; missing or unavailable channels are never zero-filled. The Overall tile shows how many of the five categories contributed. Partial scores are labelled Early data and never ranked against complete scores.

Entry scans remain part of the ordinary door workflow. No POS integration is used. Redemption-date totals can include older passes, so they do not enter the claim-cohort conversion denominator. More profile views cannot dilute entry conversion. Profile interest represents observed activity, not an exposure-adjusted rate.

### Evidence and ranking

| Period | Hours for check-in/table scoring | Table requests during those hours / VIP selections | Profile claims for conversion | Profile-interest actions |
| --- | --- | --- | --- | --- |
| Tonight | 1 | 3 | 3 | 10 |
| 7 days | 2 | 5 | 5 | 20 |
| 30 days | 4 | 10 | 10 | 30 |
| All time | 4 | 10 | 10 | 30 |

Below these minimums, or with missing/malformed required inputs, the category is **Not enough data**. Valid zero conversion remains zero. Samples remain Early data until hours and actions reach twice the period minimum; request/claim samples must reach both twice the minimum and at least 20. These labels describe sample coverage, not statistical certainty.

Rank requires all five categories past Early data, and at least three such dancers at the club. Equal displayed Overall scores share competition rank (1, 1, 3). Partial, early and missing scores remain unranked. These scores are not comparable across different clubs or reporting periods.

### Available automatic signals

VIP scoring aggregates each request/dancer pair once, even with duplicate selection IDs. The original operational VIP counts are preserved alongside scoring-specific counts. A customer withdrawal is identified by cancelled status with the customer as reviewer. Repeat-requester history excludes those withdrawals, stays venue-specific, and does not claim repeat visits. Only aggregate counts leave the database; guest account IDs and contact information do not.

Table request IDs already provide retry deduplication. Their table links do not identify individual guests, so unique and repeat table customers are not invented. General card exposure, saved dancer profiles and repeat admissions are not currently available in the dancer report and do not enter scoring. Existing venue-attributed follows and completed shares contribute when recorded. No new manager forms or confirmations were added. Earlier untracked history is not reconstructed.

## Reliable timing and hours

Migration `20261011232707_venue_performance_channels.sql` records the deployment time in `venue_performance_tracking`. Request triggers preserve the first observed acknowledgement, completion, confirmation, decline and cancellation timestamps. Notes, retries and later edits do not reset those times. Existing missing history stays null. Cancellation alone does not become a response.

Times are medians from request creation to the recorded transition, across requests created in the selected period. Sample counts make partial history visible. A request created before deployment can gain a reliable response timestamp if handled afterward, but historical transitions are never inferred from `updated_at`.

The private work-session ledger starts existing active check-ins at deployment and records future verified presence, expiration, checkout, venue changes and shift deletion. Shift reuse starts a new session after an interruption. Hours are clipped to the selected interval; overlapping sessions for the same dancer and venue are merged. The rate numerator includes only table requests created during those observed intervals. Historical request totals remain available in the authorized aggregates and venue-wide reports. Initial rate coverage will be partial until a complete reporting period has been observed.

Clicks, browser counts, shares and TV results remain in supporting disclosures. “I’m Going” signals are explicitly separate from VIP requests. TV retains the existing confirmed-venue-tag and time-bound attribution rules.

## Attendance and profile conversions

The dancer results extension records explicit, verified check-ins and check-outs in a private event ledger. Expiring presence does not become a check-out. Events survive shift deletion; prior check-in/out events are not reconstructed. The aggregates retain event counts and each dancer's latest recorded check-in within the selected period. The automatic score view uses recorded hours without rewarding repeated taps; venue-wide attendance summaries remain available.

Staff first mark a table request seen, then choose **Mark arrived** or **Didn’t arrive at table**. Mark arrived confirms the dancer actually attended; Complete closes the attended request. Didn’t arrive at table closes it as cancelled and preserves the `no_show` outcome. This is only about acknowledged internal table requests, not shifts or VIP bookings, and is never inferred automatically. These actions require venue staff access and reject stale transitions. Requests remain in the staff inbox after the dancer checks out, within the existing six-hour queue window. Unknown attendance is shown separately. Table attendance rate is arrived / (arrived + no-show), using requests created in the selected period; completed legacy requests never imply arrival.

A **profile conversion** is a dancer-profile admission pass redeemed by staff for entry. Each pass counts once, attributed to its issuing dancer and venue. These are converted passes, not unique people. Voided passes are excluded. Revenue, sales entry and purchase metrics are omitted because there is no club sales/POS feed.

Conversion counts use the redemption date. The claim conversion percentage used by Verified Entry Conversions uses passes claimed in the selected period that converted before its end, divided by all nonvoided profile claims from that period, including expired claims. A null percentage means no qualifying denominator. Dancers can be sorted by Overall, any of the five categories, or name. The underlying channel metrics remain independent.

The additive migration `venue_dancer_results` preserves the previous channel report as `get_venue_performance_channels` and wraps it with these aggregates. All new RPCs are service-only and authorize staff inside the database before writes. Ledgers have RLS and no anonymous or authenticated grants. The new attendance-event trigger is a private definer function; the attendance command is a security invoker with empty search paths.

## Access and rollout

`get_venue_performance_analytics` wraps the existing subscription analytics RPC without replacing it. It is a service-role-only, security-invoker function with an empty search path. The dashboard authorizes venue access before calling it. New tracking tables have RLS, no public/authenticated grants, and service-role read access only. A non-callable definer trigger maintains the private presence ledger when existing shift commands execute.

Deploy the additive migration before the application commit. Verify aggregate output and permissions read-only, run Supabase advisors, then verify Vercel success for the exact application SHA. Unit/component checks use PGlite and in-memory React/service fixtures; no E2E or browser journeys are used.

All-time reporting uses the explicit UTC epoch boundary in the service-only subscription and hair-color RPCs. Ordinary custom ranges retain their existing limits and finite-date validation. Migration `20261013000159_venue_all_time_analytics.sql` preserves attribution, permissions and existing records. The CLI-created migration was aligned to the production migration version returned by Supabase. Security and performance advisors reported no new findings.

Production migration was applied on October 11, 2026 with the Supabase-generated version above; the CLI-created file was aligned to that recorded version. Read-only verification confirmed aggregate output, 498 initially observed work sessions, service-only RPC execution, and denied public ledger reads. Advisors found no new security findings or unindexed foreign keys. Two new indexes initially received informational [unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index); they are retained for dancer foreign-key lookups and venue/time-range request reporting as activity accumulates.

The attendance/conversion extension was applied on October 12, 2026 as `20261012225142_venue_dancer_results.sql`. Production read-only verification confirmed the aggregate response and service-only privileges. Advisors reported no new security findings or unindexed foreign keys. The new dancer lookup index received only an informational [unused-index notice](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index); it is retained for its foreign-key lookup as attendance accumulates.

The automatic scoring inputs migration was applied as `20261013011729_automatic_dancer_score_inputs.sql`. The existing report is retained behind a service-only wrapper that adds withdrawal-aware VIP aggregates without exposing customer identities. Production read-only verification returned the new fields for 96 dancer rows and confirmed public/authenticated execution is denied. Supabase security and performance advisors reported no new findings.
