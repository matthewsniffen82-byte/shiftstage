# MyDancr final adversarial security review

Date: 2026-08-30

Reviewed production baseline: `1ab88414653f132dd8b2123a22a219826706e1da`

Production origin: `https://www.mydancr.com`

Supabase project: `hfmzwadzabmgxkjzmqun`

## Result

The final safe adversarial review found no confirmed critical, high, or medium vulnerability. The deployed application rejected forged and unauthenticated privileged requests, direct public-key access did not expose private rows or storage objects, public response checks found no private-field leakage, and the focused adversarial regression suite passed 60 of 60 tests.

One low-severity least-privilege finding remained at the reviewed baseline: the `authenticated` database role had 57 INSERT, UPDATE, or DELETE grants across 22 tables for operations without a corresponding RLS write policy. RLS failed closed for all 57 operations, so the review did not find a usable write path. The follow-up flow trace classified 56 operations across 21 tables as unnecessary and identified the remaining operation as the intended owner-scoped notification-clearing flow whose DELETE policy was missing.

## Safe test method

The review used read-only repository inspection, deterministic automated tests, read-only production database queries, direct anonymous Supabase reads/RPC calls, and a small number of ordinary HTTP requests. It did not create production accounts, submit real or hostile files to production, mutate production business records, race live financial records, flood endpoints, or perform destructive denial-of-service testing.

Cross-account mutation, hostile upload, race, and high-rate cases were exercised through the committed authorization, validation, transaction, and limiter regression tests. Production checks were limited to safe rejection, response-shape, grant, policy, storage-visibility, and deployment-health probes.

## Required attack matrix

| # | Scenario | Evidence and result |
|---:|---|---|
| 1 | Unauthenticated protected requests | Forged or missing sessions returned 401 for customer favorites, dancer profile, venue profile, admin venue management, and dancer photo deletion. Route-inventory tests require every admin and privileged route to retain its guard. Pass. |
| 2 | User A accessing User B | Ownership helpers dynamically reject unrelated resources; account RLS exposes only `auth.uid()` or admin rows. No production test accounts were created. Pass within safe test scope. |
| 3 | Dancer A modifying Dancer B | Cross-dancer identifiers fail closed in dynamic authorization tests, and final privileged media updates repeat dancer ownership. No live mutation was attempted. Pass within safe test scope. |
| 4 | Venue A modifying Venue B | Cross-venue identifiers fail closed in dynamic authorization tests; venue writes resolve ownership from the authenticated identity. No live mutation was attempted. Pass within safe test scope. |
| 5 | Forged admin role | A forged bearer token plus `role: admin` and `isAdmin: true` returned 401. Admin-route inventory requires authenticated active-admin verification. Public signup metadata cannot provision admin or venue authority. Pass. |
| 6 | Manipulated request body | Forged ownership, role, user, dancer, and venue fields did not bypass authentication. Route tests enforce bounded bodies, explicit validation, and server-derived identities. Pass. |
| 7 | Changed resource IDs | Forged UUID requests returned 401 before mutation; authorization tests reject cross-dancer, cross-venue, and unrelated analytics identifiers. Pass. |
| 8 | Replayed redemption | Redemption rows are locked and only the expected generated state can transition; the retired non-NFC endpoint returned 410. Pass through transaction and state-machine regression evidence. |
| 9 | Simultaneous duplicate redemptions | Cashier NFC issuance uses a stable-identity advisory transaction lock, database uniqueness, and row locks before financial allocation. No production race was launched. Pass within safe test scope. |
| 10 | Fake scan | A fake legacy NFC token returned 410; current NFC tests enforce token, session, tag, body-size, and attribution boundaries. Pass. |
| 11 | Fake commission/referral parameters | Commission recipients and amounts are derived inside locked database functions; browser attribution is stripped or validated against the signed venue, deal, dancer, and shift. Pass. |
| 12 | Malicious upload | Tests reject spoofed containers, MIME mismatches, unsafe dimensions, decompression bombs, wrong storage paths, and out-of-policy video. No hostile production upload was sent. Pass within safe test scope. |
| 13 | Oversized upload | Declared and streamed oversized multipart bodies are rejected before parsing; all image upload routes authenticate before reading the body. Pass. |
| 14 | Dangerous URL | Executable schemes, data URLs, credentials, unrelated hosts, lookalike hosts, encoded redirects, and noncanonical social URLs are rejected by executable tests. Pass. |
| 15 | Excessive request rate | High-risk actions use a private, database-atomic limiter keyed by hashed IP and subject and return 429 with `Retry-After`. Production was not flooded. Pass within safe test scope. |
| 16 | Direct Supabase access with public credentials | The intended anonymous key received 401 for the private rate-limit table and privileged aggregate RPC; `commission_events` and `app_users` returned zero rows. Pass. |
| 17 | Unauthorized storage access | Anonymous listing of `verification-documents` returned an RLS-filtered empty list; an unguessable object read returned 400. All five expected private buckets are present and non-public. Pass. |
| 18 | Excessive pagination | An 81-character city was rejected with 400, a 101-character slug with 404, public lists have finite caps, metric aggregation is bounded, and admin moderation page offsets are capped. Pass. |
| 19 | Hidden/private field enumeration | Production Las Vegas discovery returned 13 dancers and 17 venues with zero forbidden-field matches. Public response tests exclude ownership, contact, QR, payout, and internal lifecycle fields. Pass. |
| 20 | Privilege escalation attempts | Forged admin claims returned 401, browser roles cannot alter account roles, privileged RPCs are not executable by browser roles, and every admin route is inventoried. Pass. |

## Production evidence

- Exact Vercel deployment for the reviewed baseline: success.
- `/api/health`: 200.
- `/`: 200 with CSP, HSTS, `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy, `frame-ancestors 'none'`, and no `unsafe-eval`.
- `/api/public/discovery?city=Las%20Vegas`: 200; 13 dancers, 17 venues, valid nonnegative engagement metrics, and zero forbidden private-field matches.
- Forged customer, dancer, venue, admin, and photo requests: 401.
- Fake legacy NFC and retired non-NFC redemption endpoints: 410.
- Oversized public slug: 404; oversized city: 400.
- Error responses contained zero credential, private-key, stack, or internal-path markers.
- All 75 production `public` tables have RLS enabled.
- The expected private storage buckets are present and not public.
- Browser roles cannot execute the privileged public metric aggregate functions.
- Direct anonymous reads returned no `commission_events` or `app_users` rows.

## Focused automated evidence

The 60-test adversarial subset passed with zero failures. It covered authentication/session handling, role provisioning, IDOR/ownership, privileged route inventory, financial serialization and attribution, NFC request security, bounded multipart handling, image decompression, stored video verification, dangerous URL handling, atomic rate limits, RLS hardening, server-managed storage, public data minimization, resource bounds, and database-function execution grants.

The complete project test, typecheck, lint, and production-build gates must also pass before this review is delivered.

## Residual limitations

- No dedicated staging Supabase project or disposable production-like identity set is available, so production cross-user, cross-dancer, and cross-venue mutation attempts were not performed.
- No hostile or oversized file was uploaded to production.
- No simultaneous financial requests or high-rate traffic were sent to production.
- Provider dashboards and third-party infrastructure were not penetration-tested; their application boundaries were verified through the deployed routes, configuration, signatures, idempotency controls, and regression tests.

These limits are deliberate production-safety constraints, not claims that the corresponding attacks were executed live.

## Follow-up remediation

Migration `202608300006_minimize_authenticated_dml_grants.sql` is the isolated remediation for this finding. It revokes the 56 unused browser-role operations, preserves all legitimate read and support-message privileges, and adds only the authenticated `recipient_id = auth.uid()` DELETE policy required by the existing clear-notifications route.
