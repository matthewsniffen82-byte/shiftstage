# Echo House dashboard samples

The existing authenticated Echo House dashboard opens a clearly labeled, read-only demo presentation. Selection requires both the existing fictional venue ID (`260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af`) and its retained database slug (`talk-of-the-town`) from the authorized dashboard response. The display name is Echo House; `echo-house` is not its stored slug. This identity was verified with a read-only production query. Other venues render their normal dashboard unchanged. The switch returns Echo House to its recorded data and normal controls. Demo mode is local component state, not an account permission or a database setting.

Coverage:
- Tonight: working roster, guest list, VIP requests, rides, shared contacts and attention counts.
- Dancers & tables: eight fictional dancers, six working and two affiliated but off shift, recent table requests and sample sticker inventory.
- Results: all four reporting periods, populated Check-in Activity, Internal Table Requests, VIP Requests, Profile Interest, Verified Entry Conversions and Overall Performance scores for all eight sample dancers, plus venue ranks, admissions, attendance, request outcomes/timing, passes, rides, growth, audience, every customer-action source, hair-color groups and TV attribution. Scores come from the shared scoring formulas and sample activity, rather than hard-coded score values.
- Manage venue: publication, deals and a pending deal request, TV, team and invitations, activity, account, notifications/preferences, support and participation.

`createVenueDashboardDemo` produces repeatable synthetic fixtures for a fixed snapshot time. The period changes sample history and scores while live queue counts remain stable. Sample IDs have a `demo-` prefix; contact addresses use the reserved `.invalid` domain. Avatars may reuse already-authorized public images for the named fictional dancers; absent images fall back to initials. No photo analysis is performed: hair-color groups are synthetic examples too.

Check-in Activity samples include verified check-in days, days with complete dancer checkouts, active visits and tracked hours. Tonight has only one check-in day, so its scores remain Early data and unranked; longer periods contain enough ended days to demonstrate ranks. The checkout sample distinguishes roster record completeness from raw check-in/out event totals.

Demo search, filters, tabs, disclosures, score sorting and period controls work locally. The live venue component is not mounted while samples are displayed. No sample write controls, scanner, outgoing contact links, messages, notifications, authentication tokens or redeemable passes exist. Fixtures never enter Supabase and do not affect actual performance or operational records. The existing parent dashboard may still perform authorized read-only refreshes for identity and roster images.

Validation uses focused fixture/component tests, TypeScript and lint checks. No E2E tests or automated browser journeys.
