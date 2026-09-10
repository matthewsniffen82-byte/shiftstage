# Step 20: webhook delivery security

## Inspection and first bounded release

Step 19 completed before this work: implementation `508bf4b89804a5b403cb6bb12fcdfc24c4db6b27`, immutable record `b8f3f254ddea427252cef528cffb7b118f5330ed`, both pushed with exact Vercel success. The record's deployment Aso3ydXuUbWWCMtp6YaRwvKzAPJC passed live health, authorization denial, callback, fifteen header and thirty readiness checks at 00:59 UTC on 2026-09-10. Read-only verification retained the database boundaries.

The runtime has one external provider webhook, `/api/stripe/webhook`. The former hosted identity-verification webhook is absent and has an explicit removal regression. Scheduled callbacks use a separate constant-time bearer-secret check. Other payout providers remain unsupported rather than accepting unsigned callbacks.

Keep the existing Stripe controls: exact raw-byte verification through the official SDK, a five-minute signature tolerance, a one-megabyte streamed/declared body limit, supported-event allowlist, service-only database claims, provider/event uniqueness, private RLS event ledger and safe error metadata. No webhook secret, provider body, bank details or complete financial payload is logged. No browser/session-based CSRF or CORS substitute is added to this signed server callback.

## Confirmed finding

**MEDIUM — unfinished deliveries acknowledged as completed duplicates.** The atomic claim returns false for both a processed event and an unexpired processing lease. The handler previously acknowledged both with HTTP 200. If a worker crashes and Stripe redelivers during its existing ten-minute lease, the successful duplicate response can suppress further retry before the event becomes reclaimable. This requires a genuine signed delivery; it is not an unsigned payment-forgery finding.

The application now accepts only explicit boolean claim results. A false claim reads only `processing_status`, scoped to the exact provider/event pair, and acknowledges only `processed`. In-flight, failed, missing, unreadable and unrecognized states return the existing generic HTTP 500, retaining provider retry. True claims keep the existing processors. Finalization now requires a returned record ID; a zero-row/unconfirmed update cannot report delivery success. No immediate automatic retry, financial mutation, credential change, lease change or database migration is added.

## Evidence and validation

Read-only production inspection captured the existing claim definition, MD5 `a59ee6e538a8ff65dd2731f3bc89ebb6`: SECURITY DEFINER, pinned public search path, qualified table references, service execution only. The event ledger has RLS and no browser write grants; aggregate inspection found no stored provider events. Payment, payout-completion and release functions also deny both browser roles. No account, invoice or payout rows were read or mutated for this audit.

The new runtime tests exercise the actual route and claim/finalization gateway, the real Stripe SDK with a synthetic secret, and the captured SQL in isolated PostgreSQL. They cover signed bytes including Unicode, signature spoofing and expiry, body limits, supported/unsupported events, completed duplicates, an overlapping worker, crash/reclaim, failed resubmission, wrong-provider/event isolation, malformed claim results, unconfirmed finalization, sanitized failures and browser denial. Financial processors are stubs: these tests deliberately do not move money. PGlite serializes database requests; this proves the application interleaving and SQL states, not a multi-connection hosted database stress test. The captured function contains CRLF in its body; the fixture normalizes only line endings, producing definition MD5 `01f6affe019c165528e9198595526479`. Direct normalized-source comparison and the native definition fingerprint both verify this, rather than treating the different byte hash as a changed function.

Against the original gateway, 20 of the initial 50 runtime cases failed for the demonstrated acknowledgment defects; the same cases passed after the fix. The pre-fix run changes only source loaded inside a test subprocess. No production bypass or test flag enters application code. Additional identity-isolation and exact-function checks follow, along with the complete suite, lint, TypeScript, build, push and deployment verification.

Final candidate validation on `b8f3f254ddea427252cef528cffb7b118f5330ed` passed all 3,577 tests without failures, skips or cancellations, including 53 new runtime/PostgreSQL checks; the focused webhook set passed all 65 checks. Uncached lint, standalone TypeScript, production build and eight native browser checks also passed without JavaScript errors. All 137 frozen migrations remain unchanged and postbuild skipped demo population. Exact push, deployment and live denial/health verification are required before the next bounded Step 20 change.

## Remaining Step 20 review

This first release addresses delivery acknowledgments only. Event ordering still requires separate validation: invoice failure snapshots can overwrite a newer paid state; subscription/account snapshots need examination against current provider state and record identity. Payout completion after a committed-but-unacknowledged financial mutation also needs an idempotent state review. No claim is made that these business processors are now transactional or order-independent. Keep Step 20 open, and deliver any further proven fix separately before Step 21. Provider dashboard configuration and real test-mode delivery have not been verified; no signed production event is generated for testing.

Provider references: [Stripe webhook delivery, duplicates and ordering](https://docs.stripe.com/webhooks), [signature verification and raw-body requirements](https://docs.stripe.com/webhooks/signature). Stripe can retry with a new delivery signature; freshness and event-ID deduplication serve different purposes. No new paid infrastructure is introduced.
