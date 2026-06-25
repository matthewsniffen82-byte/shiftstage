# Backend Roadmap

## Phase 1: Foundation

- Supabase schema and RLS policies.
- Environment variables.
- Storage buckets.
- Seed data for Las Vegas demo.
- Public approved profile reads.

## Phase 2: Auth

- Customer login and signup.
- Dancer login and signup.
- Admin login.
- Role-based routing.
- Account disable/delete flows.

## Phase 3: Dancer Approval

- Real name capture.
- Stage name capture.
- Photo uploads.
- ID/selfie verification status.
- Admin review.
- Public profile hidden until approved.

## Phase 4: Payments

- Stripe checkout for dancer subscription.
- Subscription starts only after approval.
- Stripe webhook updates subscription status.
- Customer portal for billing.

## Phase 5: Shifts

- Approved dancer can create, edit, cancel shifts.
- Venue and local timezone saved per shift.
- Tonight logic:
  - Dancer appears in Tonight starting 12:01 AM local city time on the shift date.
  - Dancer remains in Tonight until the shift ends, including overnight shifts.
- Upcoming shifts sort by nearest shift.
- Venue pages show upcoming dancer shifts at that venue.

## Phase 6: Customer Actions

- Follow dancer.
- Follow venue.
- Notifications on/off.
- Going Tonight.
- Going to Upcoming Shift.
- Request directions.
- Favorites.

## Phase 7: Analytics

- Profile views.
- Schedule views.
- Direction requests.
- Social clicks.
- Notification sends and opens.
- Going signals.
- Followers gained.
- Club performance.
- Weekly reports.

## Phase 8: Trending

- Calculate trending score from real activity:
  - profile views
  - schedule views
  - followers gained
  - favorites
  - direction requests
  - going signals
  - notification opens
  - social clicks
- Store city rank.
- Send ranking milestone notifications:
  - #1 Trending
  - entered Top 10
  - moved up 3+ spots
  - first time trending
  - biggest mover

