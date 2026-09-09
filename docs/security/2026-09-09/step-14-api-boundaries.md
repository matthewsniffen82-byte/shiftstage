# Step 14 — API authorization and response boundaries

## Confirmed finding and correction

**MEDIUM — Cashier NFC responses disclosed private financial properties.** A successful `/api/nfc/[token]` POST forwarded the entire privileged redemption confirmation to the caller. The current database result includes commission amounts and shares, a dancer payout-eligibility flag, the successful-redemption count, revenue-event and referral-agreement IDs. A valid cashier interaction does not authorize a customer to receive those internal properties. The customer screen uses the success message and does not consume those financial fields.

Read-only production function metadata confirmed this response shape in `confirm_deal_redemption_from_nfc` (body MD5 `d6358c76393b61a27b14b186e1485d54`). The function remains SECURITY DEFINER with its fixed `public, pg_temp` search path and service-only execution; anon/authenticated cannot call it directly. No live redemption, payment or commission was created to demonstrate the leak.

The HTTP boundary now explicitly returns only confirmation status, deal title and venue name. Unexpected nested status objects cannot be serialized as a status. The internal result remains available to the server's existing audit log. The atomic database transaction, ownership/attribution checks, monetary calculations, finance dashboards, public deal copy and visible completion behavior are unchanged. This follows OWASP's guidance to select authorized response properties at the [object-property boundary](https://github.com/OWASP/API-Security/blob/master/editions/2023/en/0xa3-broken-object-property-level-authorization.md).

No database migration or dependency is needed. The correction is confined to one response builder.

## API surface review

The source inventory still contains 116 API route files and 187 exported HTTP handlers. `api-inventory.md` lists the individual routes; the Step 1 list is an inventory, not proof that a direct guard name secures every delegated operation. This review follows service calls and retains the earlier RLS, role, admin, input, CSRF, rate and upload corrections.

| Surface | Existing boundary retained / review result |
| --- | --- |
| Account, auth and recovery: 3 routes | Provider-verified identity, bounded credentials/bodies, explicit account changes, centralized safe errors and durable attempts. Paused-account recovery remains intentionally available; browser role metadata cannot grant administrative access. |
| Administration: 28 routes | All 50 administrative handlers use the centralized active database-admin gate. Existing runtime tests exercise ordinary roles, inactive admins, missing accounts and anonymous callers before privileged work. Private moderation/finance fields remain in the authorized admin surface. |
| Dancer and agent: 23 routes | Database role/capability checks precede private profile, media, schedule, earnings and analytics work. Owned records are selected from verified user identity, and final media writes repeat ownership. Identity-document collection and old check-in paths remain retired. |
| Customer: 8 routes | Own profile/saved records derive identity from the verified session. Favorites, follows, directions and deal saves validate public resource relationships. Visitor going uses the existing bounded, same-origin JSON and rate-limit boundary. Profile writes explicitly construct allowed fields. |
| Venue: 22 routes | Active account plus owner/team permission checks determine the venue; submitted IDs do not establish ownership. Team mutations repeat the authorized venue filter, invitations cannot assign owner, and managed deals/media remain restricted. Signup/access-preview paths have separate public validation and abuse limits. |
| Public discovery: 14 routes | Explicit public mappers, profile/venue publication eligibility, approved media, capped list queries and validated identifiers remain. TV strips server storage fields before adding approved playback URLs; personalized following results remain private. Detailed privacy/harvesting review continues in Steps 26–29. |
| Deals and NFC: 4 routes | The old scanner already maps audit-backed offer snapshots to customer copy; audit/lifecycle/attribution internals do not leave that mapper. Legacy confirmation is HTTP 410. Active NFC tags, selected venue deals, signed dancer attribution and atomic financial issuance remain; this step corrects the active confirmation response leak. |
| Reports, DMCA, support, notifications and events: 6 routes | User-scoped private reads/mutations and explicit write shapes remain. Anonymous reports/events validate target relationships and use bounded inputs/budgets. Notification and support record IDs are coupled to the verified recipient/owner. |
| Cron, Stripe and health: 8 routes | Worker secrets and signed webhook processing remain separate machine boundaries. Health returns only status, without database rows or diagnostics. Dedicated webhook review occurs in Step 20. |

Direct route `select("*")` calls are confined to admin/worker image moderation in the current inventory, behind those privileged boundaries. No direct request-body spread into a database insert/update was found. Domain services still require review of their constructed patches; a client-side or TypeScript type alone is not treated as validation. Public resources intentionally retain IDs needed for links, event targets and ownership-safe operations. This step does not remove legitimate private owner/admin functionality merely because those responses contain more fields than public pages.

## Regression evidence and limits

Eight new runtime tests execute the real NFC HTTP handler against synthetic service boundaries. Three failed before the correction, reproducing the private-field disclosure and nested-value propagation. They now verify identical public receipts with or without a bearer header, exclusion of current and future private properties, an unchanged internal result, preserved customer copy/no-store headers, explicit financial-input selection, and unchanged invalid-session/inactive-tag/rate/domain denials. The focused API/NFC/IDOR/exposure suite passes 39 tests.

Database metadata inspection is read-only. No real account impersonation, production successful tap, financial write, sensitive document read, moderation action or customer-data extraction is performed. Existing synthetic PostgreSQL ownership tests and all application regressions are part of the full release gate. Source/runtime tests and non-destructive live checks do not prove the absence of every API vulnerability.

Previously recorded cross-cutting limits remain queued for their numbered reviews: the legacy QR-event count/insert throttle is not atomic; provider/session architecture and public-media revocation have operational limits; individual privacy and resource decisions need their dedicated reviews. None is weakened by this response-only fix.
