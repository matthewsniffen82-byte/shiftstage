# Club Pickup delivery

Club Pickup is private customer-to-verified-venue coordination. The venue decides whether transportation is available and controls its own vehicles and personnel. MyDancr provides communications and customer-referral attribution; this feature creates no financial charges and no driver or dancer conversations.

## Delivery stages

1. Additive domain migration: opt-in venue flag, requests, ordered text messages, immutable events, versioned consent, read receipts, reports and arrival evidence. All new tables start with RLS enabled and no client or service-role grants. Existing features are untouched. Focused PostgreSQL tests verify constraints, default isolation and immutable history.
2. Scoped authorization and atomic commands: active customers, published venues with active venue owners, and their active managers only. Staff/dancer accounts are excluded. RLS protects reads; direct writes are revoked even for service clients. Commands derive identity from the session. Consent gates message access. Status changes serialize with sends and preserve immutable events. Generic in-app notifications use the existing inbox without revealing location/text. Request/message retries are idempotent, and limits are enforced in PostgreSQL. Supabase Realtime publishes only RLS-protected requests and messages.
3. Authenticated API: bounded request bodies and explicit field allowlists, session-derived identities, no-store responses, paginated inbox/messages/events and scoped unread counts/settings queries. Three focused API/domain/database tests, scoped ESLint and TypeScript passed.
4. Customer request form, consent, real-time text chat, structured status controls, reporting, private inbox and venue settings built under `/pickups`. Existing login flows return to the requested pickup page. Chats reconcile on reconnect and recover missed history. Long history is paginated. Local retries preserve IDs; account changes clear private content and close subscriptions.
5. Eligible public venue CTA, customer/venue dashboard request previews, admin monitoring entry point and notification navigation added. A computed public availability boolean rechecks actual publication/owner state without exposing account or pickup data. Existing discovery queries carry this boolean with no additional browser requests. Admin inbox filters by venue/status/date; chat includes paginated event history, reports, attribution and append-only admin notes.
6. Arrival attribution observes existing confirmed NFC deal redemptions. It requires the same signed-in customer, same venue, one unambiguous accepted request and an arrival within the request window. Anonymous, unconfirmed, suspicious, cancelled and ambiguous signals do not receive automatic attribution. Reversals append history and mark attribution disputed. Both participants can record independent reported arrivals. No new redemption, commission, invoice or financial charge is created.
7. Focused security review complete: command authorization is rechecked after request locks, disputed arrival evidence survives completion, and read receipts advance when returning to the latest messages. Nine security/attribution PostgreSQL tests and both mobile browser emulations passed, including 60-message reconnect recovery. Final project-wide validation follows.

## Operations

Apply only the new reviewed migrations, not historical migrations or the recovery baseline. Vercel does not apply SQL. All venues start with pickup disabled; an authorized owner or manager must enable it. Pickup locations and message contents must never enter public discovery payloads, URL parameters, notification bodies or unrelated analytics.

Consent history and audit records are protected from ordinary edits/deletion. A separately reviewed retention process is required before automated purging; this feature does not invent a legal retention period or destroy existing history.

### Customer, venue and admin operation

- An active customer opens an enabled venue page, chooses **Request Club Pickup**, supplies location/party size/optional notes, accepts the monitored-chat notice and submits. The request and consent are recorded atomically. Refreshes/retries return the same request; another active request to that venue is reused.
- Venue owners and authorized managers open **Pickup Requests** from the existing dashboard. **Club Pickup settings** enables the service only for an eligible published venue. Each manager accepts the conversation notice before reading or sending messages. They can accept/decline, mark venue vehicle dispatched/arriving, confirm arrival, complete, cancel or mark no-show through permitted transitions.
- Customers retain their own inbox, status, messages, cancellation/report controls and arrival confirmation. Dancer accounts and venue staff without management authorization cannot access these conversations.
- Admins open **Pickup monitoring** from the existing admin dashboard. Venue/status/date filters, complete paginated conversation/history, reports, IDs and arrival evidence are available. Intervention uses an append-only admin note; there is no message editing or participant impersonation.
- Existing in-app notifications link directly to the authorized conversation and include no location/message text. Unread counts and reconnect reconciliation recover missed updates. This version does not add external push/email or an unattended escalation service.

### Deployment configuration

No new environment variables or manual Supabase dashboard edits are required. The six migrations were applied and recorded using the existing authenticated deployment access, including private Realtime publication. Production catalog verification found all six versions and seven RLS-protected pickup tables. All venue flags remain disabled. An owner/manager must opt in before customers can request pickup.

### Main implementation files

- `app/pickups/`: request flow, account gate, chat, inbox, status, consent, reporting, admin audit and scoped mobile styles.
- `app/api/pickups/` and `src/lib/dancr/pickup-*.ts`: authenticated bounded APIs, eligibility, role/status types, validation, realtime lifecycle and notification links.
- `app/dashboard/PickupDashboardPanel.tsx`, customer/venue dashboard panels, `DashboardShared.tsx`, and `app/admin/AdminClient.tsx`: existing dashboard/inbox integration.
- Public discovery/venue APIs, `src/lib/dancr/public.ts`, four canonical live-shell fragments and their generated output: computed availability/CTA and notification navigation only.
- `supabase/migrations/20260914190000_*` through `20260914195000_*`: domain, secure commands, inbox queries, public availability, NFC attribution and hardening.
- `tests/pickup-*.test.mjs`, PostgreSQL fixtures, mobile UI runner and public smoke runner: focused regression coverage. Existing dashboard fixture declarations and schema security inventory recognize the new deferred panel and literal RLS loop.

## Final validation record

The full existing test command was run after `npm run pretest`, using `node --test --test-concurrency=2 tests/*.test.mjs` to bound memory. It executed **9,683 tests: 9,664 passed and 19 failed**. Eighteen failures were independently reproduced in a detached checkout of pre-feature commit `d448aaeb12f6d668946b80b507e5d71fcf575728`, running only the failing files. Those unrelated assertions were left unchanged.

The single new failure was the source-only schema inventory not recognizing RLS enabled by a literal SQL loop. The inventory now recognizes that exact form; all three schema security checks passed on retest. Actual PostgreSQL pickup tests also verify the resulting RLS flags and access isolation. The full suite was not repeatedly rerun after this focused correction.

Pre-existing failing files (18 assertions total):

| File | Failures |
| --- | ---: |
| `brand-color-system.test.mjs` | 2 |
| `cors-boundaries.test.mjs` | 1 |
| `dancer-dashboard-control-center.test.mjs` | 1 |
| `dancer-discovery-header-layout.test.mjs` | 1 |
| `dancer-media-identity-moderation.test.mjs` | 1 |
| `dancer-media-pins.test.mjs` | 1 |
| `dancer-photo-luminosity.test.mjs` | 1 |
| `home-mobile-feed.test.mjs` | 1 |
| `home-tv-card-experience.test.mjs` | 1 |
| `profile-actions-compact.test.mjs` | 1 |
| `profile-media-card-feed.test.mjs` | 1 |
| `public-loading-runtime.test.mjs` | 1 |
| `site-aesthetic.test.mjs` | 2 |
| `video-moderation.test.mjs` | 2 |
| `video-playback-control-neutrality.test.mjs` | 1 |

Whole-project TypeScript (`tsc --noEmit --incremental false`) and `npm run lint` passed. The typecheck script embeds the full suite, so its equivalent TypeScript phase was run directly to avoid executing the same 9,683 tests twice. Changed files also passed focused ESLint.

`npm run build` passed, including migration/source validation, compilation, type validation and the public-build security check (295 files). Postbuild confirmed that demo population was skipped. The final Android/iPhone synthetic component checks passed at 320/393/1280px with no runtime errors. The locally served production build passed the read-only Android smoke: all three pickup endpoints deny signed-out access with 401/no-store, gates show sign-in, missing venue fails closed, and discovery returns 17 venues/14 dancers without pickup details. The iPhone production-bundle smoke runs over deployed HTTPS because WebKit correctly upgrades the local production HTTP assets under the existing security policy.

Final verification disabled pickup sign-in link prefetching, avoiding unnecessary background loading of the homepage/login shell. The public smoke script records the existing iPhone homepage `interactive-widget` unsupported-hint notice separately; it does not suppress other console or runtime errors.

## Release evidence

- Domain commit `3d568bd1`: two PostgreSQL domain tests and migration inventory passed; pushed to main, Vercel success confirmed. Migration `20260914190000` rehearsed with rollback, then applied and recorded atomically in production; seven new tables have RLS.
- Security commands: five PostgreSQL integration tests cover role isolation, current membership/account checks, consent, anti-spoofing, immutable audit, idempotency, rate limits, status transitions, cancellation, expiry and disabled pickup. Existing frontend/data paths are unchanged in these first two stages.
- Security commit `c1c297e7`: pushed to main and Vercel success confirmed. Migration `20260914191000` rehearsed with rollback, then applied and recorded atomically; seven select policies and private Realtime publication enabled.
- API commit `84bd7e50`: pushed and Vercel success confirmed. Inbox query migration `20260914192000` rehearsed, applied and recorded atomically.
- UI commit `c9ce421f`: pushed and Vercel success confirmed. Entry-point validation: three pickup/availability tests, existing venue profile/discovery/role-loading tests and all 16 customer progressive-loading tests passed. The source-extraction test manifest and dynamic-import mock now include the new deferred dashboard panel.
- Integration commit `fd5fea04`: pushed and Vercel success confirmed. Availability migration `20260914193000` rehearsed, applied and recorded. Server-role REST verified the computed field; existing anonymous column restrictions remain unchanged.
- Attribution: four PostgreSQL tests passed, including trusted NFC matching, excluded signals, manual confirmations and reversal/ambiguity handling. The migration rehearsed successfully against the production schema with rollback. Android/WebKit synthetic UI flows passed again after the arrival display addition.
- Attribution commit `ef8a45f7`: pushed and Vercel success confirmed. Migration `20260914194000` applied and recorded atomically. Hardening migration `20260914195000` also rehearsed, applied and recorded; focused ESLint and diff checks passed.
- Hardening commit `fb06c38d`: pushed and Vercel success confirmed. Focused security review is in `docs/club-pickup-security-review.md`.
- `node scripts/test-club-pickup-ui.mjs` passed on Android Chrome and iPhone/WebKit emulation at 320/393/1280px. It mounts the actual React components with synthetic HTTP/realtime fixtures. Request submission, same-ID retry, incoming message reconciliation, plain-text XSS handling, consent, cancellation, reports, venue status, settings and logout cleanup passed with zero runtime errors. This is not a physical-device or live authenticated websocket certification.
- Requests expire after 12 hours. Expiry is evaluated on authorized inbox/detail reads and new requests, with bounded cleanup. Reported arrivals remain evidence even if coordination expires; they never become verified arrivals without an objective signal.
- Realtime uses the existing Supabase dependency and [RLS-filtered Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes). Chat clients will also reconcile after reconnect; notifications do not carry sensitive message contents.
