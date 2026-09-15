# Club Pickup delivery

Club Pickup is private customer-to-verified-venue coordination. The venue decides whether transportation is available and controls its own vehicles and personnel. MyDancr provides communications and customer-referral attribution; this feature creates no financial charges and no driver or dancer conversations.

## Delivery stages

1. Additive domain migration: opt-in venue flag, requests, ordered text messages, immutable events, versioned consent, read receipts, reports and arrival evidence. All new tables start with RLS enabled and no client or service-role grants. Existing features are untouched. Focused PostgreSQL tests verify constraints, default isolation and immutable history.
2. Scoped authorization and atomic commands: active customers, published venues with active venue owners, and their active managers only. Staff/dancer accounts are excluded. RLS protects reads; direct writes are revoked even for service clients. Commands derive identity from the session. Consent gates message access. Status changes serialize with sends and preserve immutable events. Generic in-app notifications use the existing inbox without revealing location/text. Request/message retries are idempotent, and limits are enforced in PostgreSQL. Supabase Realtime publishes only RLS-protected requests and messages.
3. Authenticated API: bounded request bodies and explicit field allowlists, session-derived identities, no-store responses, paginated inbox/messages/events and scoped unread counts/settings queries. Three focused API/domain/database tests, scoped ESLint and TypeScript passed. Customer UI and realtime conversation follow in the next stage.
4. Pending: venue settings/inbox and eligible public CTA.
5. Pending: admin monitoring, reports and objective arrival attribution.
6. Pending: complete validation, mobile verification and focused security review.

## Operations

Apply only the new reviewed migrations, not historical migrations or the recovery baseline. Vercel does not apply SQL. All venues start with pickup disabled; an authorized owner or manager must enable it. Pickup locations and message contents must never enter public discovery payloads, URL parameters, notification bodies or unrelated analytics.

Consent history and audit records are protected from ordinary edits/deletion. A separately reviewed retention process is required before automated purging; this feature does not invent a legal retention period or destroy existing history.

## Release evidence

- Domain commit `3d568bd1`: two PostgreSQL domain tests and migration inventory passed; pushed to main, Vercel success confirmed. Migration `20260914190000` rehearsed with rollback, then applied and recorded atomically in production; seven new tables have RLS.
- Security commands: five PostgreSQL integration tests cover role isolation, current membership/account checks, consent, anti-spoofing, immutable audit, idempotency, rate limits, status transitions, cancellation, expiry and disabled pickup. Existing frontend/data paths are unchanged in these first two stages.
- Security commit `c1c297e7`: pushed to main and Vercel success confirmed. Migration `20260914191000` rehearsed with rollback, then applied and recorded atomically; seven select policies and private Realtime publication enabled.
- Requests expire after 12 hours. Expiry is evaluated on authorized inbox/detail reads and new requests, with bounded cleanup. Reported arrivals remain evidence even if coordination expires; they never become verified arrivals without an objective signal.
- Realtime uses the existing Supabase dependency and [RLS-filtered Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes). Chat clients will also reconcile after reconnect; notifications do not carry sensitive message contents.
