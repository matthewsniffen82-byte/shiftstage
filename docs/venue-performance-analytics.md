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

## Dancer scores (version 1)

The private venue report displays exactly four scores per dancer: **Overall**, **Check-in activity**, **Requests**, and **Profile results**. There is no expanded list of raw dancer metrics or Internal / External / VIP tab strip. A collapsed calculation disclosure explains the formula, current-period sample requirements and limitations. Avatar, stage name and overall venue rank accompany the four scores.

These are initial product activity indicators, not validated measures of talent, reliability, scheduled-shift attendance, sales or future performance. No appearance, hair-color classification, private identity data or guest contact information enters the formula. Existing data and venue-wide operational reports are retained.

### Formula

A relative component is `100 * value / (value + medianPositive)`, using the median of positive values among qualifying dancers in the complete authorized venue report for the same period. Zero scores zero, a typical positive value scores 50, and larger values approach 100. At least three qualifying dancers are required for each comparison; equal activity does not give everyone 100.

- **Check-in activity:** 35% relative verified check-in count + 65% relative recorded hours. Check-outs and last check-in timestamps do not add points or penalize an ongoing shift.
- **Requests:** 70% table activity + 30% VIP activity when both qualify. Table activity is 60% marked-completed / received requests + 40% relative requests during recorded presence / recorded hours. VIP activity is 70% relative request selections + 30% relative repeat-requester counts. If only one channel has sufficient data and peers, it supplies the request score; a missing channel is not counted as zero.
- **Profile results:** 60% profile-pass cohort conversion percentage + 25% relative redeemed profile passes / recorded actions + 15% weighted action mix. Action weights are profile opens 1, club opens 2, directions 3, transport 3, offer clicks 4, and "I'm Going" 4. The action-mix percentage is weighted actions divided by four times total actions.
- **Overall:** 45% Requests + 40% Profile results + 15% Check-in activity. All three category scores must exist. Overall weights are never redistributed around a missing category.

Each category is rounded to an integer from 0 to 100. Overall is computed from these displayed category scores and rounded again, so the formula matches what staff see. Verified hours adjust table demand; recorded action counts adjust redemption activity. These are observed opportunity proxies, not full exposure adjustment: VIP impressions and total profile exposure are not available. Larger raw workloads are not a substitute for stronger conversion or completion rates.

### Evidence and ranking

| Period | Verified hours for check-in/table scoring | Table or VIP requests for that channel | Profile pass claims | Profile actions |
| --- | --- | --- | --- | --- |
| Tonight | 1 | 3 | 3 | 10 |
| 7 days | 2 | 5 | 5 | 20 |
| 30 days | 4 | 10 | 10 | 30 |
| All time | 4 | 10 | 10 | 30 |

Profile scoring requires both the claim and action minimum. Check-in scoring requires recorded check-in data even if the count is zero for an ongoing session. Negative, nonfinite, missing or inconsistent required data remains unscored. Missing data and insufficient samples show **Not enough data**, not zero.

Overall rank is assigned only with at least three fully scored dancers at the club. Ranking is by the displayed overall score, descending. Equal scores share a competition rank (1, 1, 3), never a name-based tiebreak. Unscored dancers remain unranked; small overall cohorts can show category/overall scores without claiming a meaningful club rank.

Search, sort and pagination run only after scoring the entire authorized period report and cannot alter benchmarks or ranks. Sort choices are the four scores and name, with missing scores last. Default sort is Overall. The list paginates locally without truncating database counts. Approved public avatars are retained; other profiles use initials. No scores are exposed to public profiles or dancer accounts, stored as permanent ratings, or used to change access or staffing.

Repeat VIP requesters remain distinct accounts with an earlier same-dancer request at this club, including declined/cancelled requests. These are requests, not verified repeat visits. Completed table requests use current status of requests received in the selected period, not completion date. Profile conversion percentage uses the claim cohort; redeemed-pass activity uses entry date. Older untracked history is never reconstructed.


## Reliable timing and hours

Migration `20261011232707_venue_performance_channels.sql` records the deployment time in `venue_performance_tracking`. Request triggers preserve the first observed acknowledgement, completion, confirmation, decline and cancellation timestamps. Notes, retries and later edits do not reset those times. Existing missing history stays null. Cancellation alone does not become a response.

Times are medians from request creation to the recorded transition, across requests created in the selected period. Sample counts make partial history visible. A request created before deployment can gain a reliable response timestamp if handled afterward, but historical transitions are never inferred from `updated_at`.

The private work-session ledger starts existing active check-ins at deployment and records future verified presence, expiration, checkout, venue changes and shift deletion. Shift reuse starts a new session after an interruption. Hours are clipped to the selected interval; overlapping sessions for the same dancer and venue are merged. The rate numerator includes only table requests created during those observed intervals. Historical request totals remain available in the authorized aggregates and venue-wide reports. Initial rate coverage will be partial until a complete reporting period has been observed.

Clicks, browser counts, shares and TV results remain in supporting disclosures. “I’m Going” signals are explicitly separate from VIP requests. TV retains the existing confirmed-venue-tag and time-bound attribution rules.

## Attendance and profile conversions

The dancer results extension records explicit, verified check-ins and check-outs in a private event ledger. Expiring presence does not become a check-out. Events survive shift deletion; prior check-in/out events are not reconstructed. The aggregates retain event counts and each dancer's latest recorded check-in within the selected period. The four-score dancer view uses recorded check-ins and hours without displaying the raw event counts or timestamps; venue-wide attendance summaries remain available.

Staff first mark a table request seen, then choose **Mark arrived** or **Didn’t arrive at table**. Mark arrived confirms the dancer actually attended; Complete closes the attended request. Didn’t arrive at table closes it as cancelled and preserves the `no_show` outcome. This is only about acknowledged internal table requests, not shifts or VIP bookings, and is never inferred automatically. These actions require venue staff access and reject stale transitions. Requests remain in the staff inbox after the dancer checks out, within the existing six-hour queue window. Unknown attendance is shown separately. Table attendance rate is arrived / (arrived + no-show), using requests created in the selected period; completed legacy requests never imply arrival.

A **profile conversion** is a dancer-profile admission pass redeemed by staff for entry. Each pass counts once, attributed to its issuing dancer and venue. These are converted passes, not unique people. Voided passes are excluded. Revenue, sales entry and purchase metrics are omitted because there is no club sales/POS feed.

Conversion counts use the redemption date. The claim conversion percentage used by Profile results uses passes claimed in the selected period that converted before its end, divided by all nonvoided profile claims from that period, including expired claims. A null percentage means no qualifying denominator. Dancers can be sorted by Overall, Check-in activity, Requests, Profile results or name. The underlying channel metrics remain independent.

The additive migration `venue_dancer_results` preserves the previous channel report as `get_venue_performance_channels` and wraps it with these aggregates. All new RPCs are service-only and authorize staff inside the database before writes. Ledgers have RLS and no anonymous or authenticated grants. The new attendance-event trigger is a private definer function; the attendance command is a security invoker with empty search paths.

## Access and rollout

`get_venue_performance_analytics` wraps the existing subscription analytics RPC without replacing it. It is a service-role-only, security-invoker function with an empty search path. The dashboard authorizes venue access before calling it. New tracking tables have RLS, no public/authenticated grants, and service-role read access only. A non-callable definer trigger maintains the private presence ledger when existing shift commands execute.

Deploy the additive migration before the application commit. Verify aggregate output and permissions read-only, run Supabase advisors, then verify Vercel success for the exact application SHA. Unit/component checks use PGlite and in-memory React/service fixtures; no E2E or browser journeys are used.

All-time reporting uses the explicit UTC epoch boundary in the service-only subscription and hair-color RPCs. Ordinary custom ranges retain their existing limits and finite-date validation. Migration `20261013000159_venue_all_time_analytics.sql` preserves attribution, permissions and existing records. The CLI-created migration was aligned to the production migration version returned by Supabase. Security and performance advisors reported no new findings.

Production migration was applied on October 11, 2026 with the Supabase-generated version above; the CLI-created file was aligned to that recorded version. Read-only verification confirmed aggregate output, 498 initially observed work sessions, service-only RPC execution, and denied public ledger reads. Advisors found no new security findings or unindexed foreign keys. Two new indexes initially received informational [unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index); they are retained for dancer foreign-key lookups and venue/time-range request reporting as activity accumulates.

The attendance/conversion extension was applied on October 12, 2026 as `20261012225142_venue_dancer_results.sql`. Production read-only verification confirmed the aggregate response and service-only privileges. Advisors reported no new security findings or unindexed foreign keys. The new dancer lookup index received only an informational [unused-index notice](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index); it is retained for its foreign-key lookup as attendance accumulates.
