# Venue subscription analytics

The Business → Analytics & performance panel reports verified admissions,
directions clicks, pass claims, saved Going signals, unique venue browsers, and
new followers. Tonight, 7-day and 30-day periods include equivalent prior-period
comparisons. Supporting metrics include pickup contact-form requests, requested
passengers, visible venue-card impressions, current followers, and claim-cohort
conversion.

Button reports break down the scroll card, venue detail page and dancer profile.
Each browser action has a unique event ID; delivery retries cannot duplicate it.
Impressions require a card to be at least 50% visible and count once per venue
per page visit. Dancer activity requires an explicit active venue affiliation.
Browser IDs remain inside service-only aggregates. Going signals are intentions,
pickup passengers are requested passengers, and only redeemed admission passes
count as verified admissions.

MyDancr TV reporting includes videos with a confirmed venue tag, without the
public feed's 24-video limit. General dancer affiliation does not include their
other videos. An explicit video-to-club click sets a signed, HTTP-only,
venue-specific attribution cookie for 30 minutes. Subsequent venue directions,
offer and transport clicks can retain that video attribution. Newly issued
passes retain their video credit through redemption; reopening an old pass never
changes it. Video event totals retain the existing per-browser/per-day deduplication.

Button and video-outcome reporting starts at the tracking activation date shown
in the report. Historical clicks are not backfilled or inferred. Subscription
cost per admission is unavailable until an authoritative, period-matched venue
subscription cost is connected; existing dancer subscription records are not used.

The venue dashboard no longer loads referral agreements, referral revenue or
commission invoices. Legacy venue referral-fee and statement endpoints return
410, and finance automation no longer creates/publishes referral invoices or
sends their reminders. Existing financial records and payment reconciliation
remain intact.

Apply both migrations before deploying the application:

- `20260916190000_venue_subscription_analytics.sql`
- `20260916190100_report_current_pickup_receipts.sql`

The second migration uses the current `club_shuttle_requests` receipt table and
counts each receipt once regardless of notification recipient count. Retired
pickup-chat tables remain inaccessible.

Validation covers aggregate deduplication, more than 1,000 events, venue isolation,
current pickup receipts, private aggregate access, signed video attribution,
immutable pass credit, browser event capture, admissions and invoice retirement.
