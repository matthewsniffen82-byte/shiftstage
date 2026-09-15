# Club Pickup focused security review

The initial account-only review below is supplemented by [Guest pickup chat](guest-pickup-chat.md), which documents scoped guest capabilities and their validation.

Scope: the new pickup database, API, request/chat/inbox components, dashboard links, realtime lifecycle and NFC referral observer. Existing financial calculations, driver/transportation dispatch, dancer features and unrelated security policies were not changed.

## Access and identity

- Active authenticated customers see only their requests. Active venue owners/managers see only authorized venues' requests. Staff and dancer roles are excluded. Active admins have audit access; they cannot send as a customer/venue or edit messages/events.
- Every command derives its actor from `auth.uid()`. Field allowlists reject supplied customer/sender/attribution fields. RLS also applies to direct REST reads and Supabase Realtime.
- All new tables have RLS; no direct inserts/updates/deletes are granted to browser or service-role clients. Security-definer functions have fixed search paths, explicit execute grants and internal helpers inaccessible to clients.
- Messages require per-user, per-request versioned consent. Reports are visible only to the reporter and admins. Admin notes/events are admin-only. Venue names identify venue messages in the UI.
- Mutation commands lock the request, validate allowed transitions and expected state, and recheck authorization after lock waits. A partial unique index prevents simultaneous active requests for the same customer/venue. Message UUID retries and request UUID retries cannot change content or impersonate another actor.

## Privacy and lifecycle

- Pickup text and location remain in private no-store API responses. Public APIs receive only a computed availability boolean; they never receive pickup locations or conversations. Notification bodies contain generic text and a validated private request link.
- Messages and audit metadata render as text, without HTML insertion. No chat images, calls, phone sharing controls, driver accounts or dancer participants were added.
- Chats use a dedicated temporary realtime client. Navigation/account changes unsubscribe; revoked-access responses clear conversation data. Refresh/reconnect reconciles from the authorized API rather than trusting event payloads. Long disconnects reset to a contiguous history page, with older pages available.
- Server limits bound request creation, message sends, pagination and body sizes. Consent/report retries are unique. Expiration is scoped and bounded; disabling pickup preserves existing authorized conversation access.
- Notifications use the existing in-app inbox. New messages are coalesced for 60 seconds per recipient/request while an unread pickup notification exists. No external push/email delivery or separate notification architecture was introduced in V1.

## Attribution and findings fixed

- Only an existing confirmed, non-suspicious NFC redemption with a known customer and matching venue can provide objective evidence. Matching requires exactly one accepted request within its time window. Anonymous, mismatched, unaccepted, cancelled and ambiguous referrals are excluded.
- Reported arrival and objective arrival are separate evidence sources. Evidence/history is immutable and never produces a new fee or financial charge. Redemption reversals append evidence history and mark attribution disputed.
- Fixed: later completion could replace `arrival_disputed` with an unverified outcome. The hardening migration preserves both verified and disputed outcomes during status changes.
- Fixed: read markers did not advance when the reader scrolled back to the latest messages. The chat now updates markers on scroll/visibility; repeated positions avoid unnecessary database updates.

## Validation and operational limits

Focused PostgreSQL tests execute the actual migrations with synthetic roles/rows. They cover cross-customer/cross-venue reads, consent, disabled accounts/revoked membership, spoofing, immutable audit, valid/stale/invalid transitions, duplicate requests/messages, limits, cancellation, expiry and attribution. Real React components are exercised in Android Chrome and iPhone/WebKit emulation with synthetic HTTP/realtime fixtures, including plain-text XSS handling, retries, reconnect history, settings and logout cleanup.

This does not certify physical-device keyboard behavior, cellular delivery, independent live database sessions racing, or end-to-end delivery between two real authenticated mobile users. Verify those with designated venue/customer test accounts before enabling a venue operationally. Existing in-app notifications are the V1 delivery channel; external push/email and unattended escalation for unanswered pickups are follow-ups. A reviewed retention schedule, legal hold process and controlled privacy-request handling are needed before automated deletion; immutable history is not silently purged by this feature.
