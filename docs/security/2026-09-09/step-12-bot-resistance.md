# Step 12 — Automated submission resistance

## Findings and corrections

**MEDIUM — Venue signup bursts could exceed the daily submission limit.** The existing hourly request counter was atomic, but the three-submission/IP/day check counted saved rows separately from creating a manager login and saving the request. Simultaneous valid requests could see the same old count, create extra logins and enter the approval queue.

The service now reserves a daily atomic budget after field/credential validation, the rolling count and duplicate checks, and before creating a manager login. Both counter dimensions bind to the trusted IP, keeping the existing three-per-IP allowance without imposing an additional daily email/account limit. The route passes its actual Request to the service. Existing hourly email/IP limits, honeypot handling, confirmation requirements and failed-insert cleanup remain.

**MEDIUM — Copyright-notice bursts could bypass count-then-save throttles and send extra email.** Separate IP/hour and claimant-email/day counts did not serialize admission. Concurrent notices could all pass before any notice was saved, each triggering a confirmation email and moderation work.

Valid notices now reserve atomic hourly and daily budgets before persistence or email. The existing five/IP/hour and three/email/day rolling checks remain. Atomic hourly limits are five/IP and three/email; daily limits are 120/IP (five times 24 hours) and three/email. The public handler returns the existing safe copyright-throttle message with HTTP 429 and Retry-After. Validation and honeypot failures do not consume these new reservation budgets. Valid attempts that reach the reservation can consume capacity even if a subsequent provider operation fails, preventing repeated expensive retries from bypassing admission.

Both fixes use the existing private, service-only counter reviewed in Step 11. They do not add paid services, a CAPTCHA, a new dependency, a schema migration or a UI redesign.

## Stronger existing controls retained

- Support already uses `create_support_message_safely`: active database role checks, one per-user advisory lock, twelve human messages/minute, idempotent request IDs, atomic thread/message/notification writes and duplicate-content checks. The older separate count is only a missing-function compatibility fallback. The Step 11 coverage note is clarified accordingly; no redundant limiter replaces this stronger implementation.
- Live support-function SQL tokens match the reviewed `202609070004_atomic_support_messages.sql` body (live MD5 `a550f07fb32c6edd3f9401902d4802e1`; formatting/comments differ). Its fixed search path and service-only execution grants remain.
- Read-only live grants confirm anon/authenticated lack INSERT/UPDATE access to venue requests and support tables, including authenticated column grants. Copyright cases have authenticated table privileges, but INSERT/UPDATE policies require `is_admin()`; uploader access is SELECT only. Ordinary clients cannot skip the submission services by writing those records directly.
- Venue and copyright honeypots, provider email confirmation, account/role authorization, Step 11 login/recovery limits, media upload budgets and existing moderation remain. No blanket challenge is added to browsing or signup. The media-processing boundary receives Step 13's review.
- Public discovery caching, bounded parameters and visible-profile eligibility remain. Dedicated harvesting/resource reviews occur in Steps 28–29; public profiles are not made private merely to frustrate scraping.

## Validation and operational limits

Fourteen new runtime tests execute the real submission services and handlers with synthetic provider/database boundaries. A fixture deliberately lets simultaneous legacy counts all see zero: before the fixes, the 11-case initial set had seven failures. Afterward, a 20-request burst admits three venue submissions or five copyright notices, with no extra manager creations, database writes or emails. Twelve different synthetic IPs targeting one claimant email admit only three notices. Tests also cover normal submissions, rolling-window denials, validation, honeypots, fail-closed backend errors and both routes' 429/Retry-After responses.

The complete suite passes 2,873 tests after integrating the independent moderation SDK loading update, including Step 11's isolated PostgreSQL counter tests. A fixture reproducing stale counts is not a multi-connection production load test. Live checks use metadata and empty invalid requests; no production signup, email delivery, notice, support message, bot traffic or real-user rate-limit exhaustion is generated.

Distributed clients can still attempt public provider authentication and vary both network and subject identities. Application limits complement provider controls rather than replacing them. Dedicated CAPTCHA/advanced edge protection remains an optional deployment decision if observed abuse warrants it; none is purchased or enabled here. The legacy missing-function fallbacks remain weaker than the atomic prerequisites, which production readiness verifies.
