# Step 12 — realtime and subscription lifecycle

## Inspection and production impact

The application currently creates no Supabase Realtime channels or subscriptions. A source scan of `app`, `src`, `public`, scripts, migrations and the live shell found no application `channel`, `subscribe`, `postgres_changes`, websocket, EventSource or channel-removal call. The architecture-audit script contains the search expression itself and is not a subscription caller.

Read-only production metadata at 15:03:43 UTC on 2026-09-10 shows the managed `supabase_realtime` publication exists, has `all_tables=false`, and publishes zero tables. There are zero logical replication slots, including zero active logical slots. The managed `realtime` schema exists. This does not assert the provider's Realtime service is disabled, or infer that Broadcast/Presence cannot operate from publication metadata alone; absence of application subscriptions is established separately by the source review.

The installed `@supabase/supabase-js` is 2.108.2. Its client constructs a Realtime client object, while a channel subscription connects its socket. MyDancr's browser upload client is a singleton; server and admin clients are separately constructed with session persistence, auto-refresh and URL session detection disabled. Supabase HTTP transport remains bounded and does not replay mutations.

## Existing refresh behavior

The application uses HTTP reads and local browser events for dashboard freshness. `DancerTvStudio` polls only while videos are processing or under review, skips hidden pages, prevents an overlapping refresh and removes its timer/visibility listener on cleanup. It uses an abort controller and request sequence to suppress stale load results. `VenueNfcTagPanel` refreshes visible pages every thirty seconds, deduplicates loads, removes the interval/listener and aborts pending loads/actions on unmount. `DancerShiftManager` loads through the dashboard request boundary and aborts/increments its request sequence on cleanup.

Temporary loss of a Realtime websocket cannot block these flows because they create none. HTTP/provider failures, broader background workers and network recovery still need their scheduled Step 19 review. Existing abort/session tests are not a claim that every browser timer or reconnect scenario has been exhaustively tested on a physical device.

## Controlled implementation and tests

No subscription, publication, policy or application client change is warranted. Do not introduce Realtime merely to have something to harden. Add three actual-factory/installed-SDK regression cases: browser, ordinary server and privileged server construction must open no socket or HTTP request, create zero channels, retain disabled secondary-session settings, and preserve browser singleton versus per-call server isolation. Synthetic configuration and transport tripwires prevent production contact in these tests.

All 27 focused client/session cleanup tests pass, including the three new cases. This verifies local construction behavior with the installed SDK, not a hosted Realtime connection or a cross-tab end-to-end test. Run the entire suite, lint, production build, standalone TypeScript, migration guard and read-only readiness before the exact commit/push/deployment/health gate.

## Future enablement and rollback

If a feature later needs Realtime, review that feature's public/private payloads and RLS, its narrow publication membership, one subscription per mounted consumer, teardown on unmount/account change, duplicate reconnect prevention and a bounded HTTP fallback. Test stale events after logout/account replacement and lost/reconnected sockets before release. No subscription token or private record should appear in logs.

No production schema or settings are changed in this step. Rollback removes the documentation/tests commit; no database or data restoration is needed. Reconnect and unsubscribe implementation changes are not applicable to the current application because no such subscription lifecycle exists.
