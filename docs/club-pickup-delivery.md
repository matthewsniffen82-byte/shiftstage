# Club Pickup delivery

Club Pickup is private customer-to-verified-venue coordination. The venue decides whether transportation is available and controls its own vehicles and personnel. MyDancr provides communications and customer-referral attribution; this feature creates no financial charges and no driver or dancer conversations.

## Delivery stages

1. Additive domain migration: opt-in venue flag, requests, ordered text messages, immutable events, versioned consent, read receipts, reports and arrival evidence. All new tables start with RLS enabled and no client or service-role grants. Existing features are untouched. Focused PostgreSQL tests verify constraints, default isolation and immutable history.
2. Pending: scoped authorization, atomic commands, status transitions, consent, rate limits and notifications.
3. Pending: authenticated API, customer request flow and realtime conversation.
4. Pending: venue settings/inbox and eligible public CTA.
5. Pending: admin monitoring, reports and objective arrival attribution.
6. Pending: complete validation, mobile verification and focused security review.

## Operations

Apply only the new reviewed migrations, not historical migrations or the recovery baseline. Vercel does not apply SQL. All venues start with pickup disabled; an authorized owner or manager must enable it. Pickup locations and message contents must never enter public discovery payloads, URL parameters, notification bodies or unrelated analytics.

Consent history and audit records are protected from ordinary edits/deletion. A separately reviewed retention process is required before automated purging; this feature does not invent a legal retention period or destroy existing history.
