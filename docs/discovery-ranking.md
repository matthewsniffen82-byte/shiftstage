# Discovery ranking

The dancer directory and MyDancrTV rank all eligible candidates in the requested city before pagination. Neither feed has a total profile, video, or page-count cap. The default order is the venue dashboard's rolling 30-day Overall Performance score, descending; ties use dancer ID, then video ID. Scores use each venue's full analytics cohort, not the current page or public subset. Unscored dancers follow scored dancers. No profile is hard-coded above the score order.

The server reads lightweight candidate identities through service-only, UUID-keyset RPCs in batches of 1,000 until an empty batch. It then calculates the complete order and saves a private, two-hour snapshot. Only the requested page receives full cards, photos, metrics, or playback data: up to 100 directory cards or 24 TV videos per request. These are request sizes, not total discovery limits. Venue score reports are shared in a one-minute in-process cache.

Directory Working Now, Not Working Now, and club filters apply before pagination. Changing a filter starts at its globally ranked first page; a late response from the previous filter cannot replace it. Directory pages recheck visibility and current presence, skip revoked profiles, and backfill from the saved order. A club TV page validates its selected videos directly instead of using the old capped club roster.

TV Newest explicitly sorts by publication time. Following limits eligibility to the verified account's complete follow list. A directly linked eligible video remains first. Individual dancer profile media retains its existing pin and publication ordering.

Snapshots are bound to the visitor, page visit, city, venue, filter, and selected video. Later score changes cannot create duplicates or skips while browsing. A new page visit recalculates placement; expired continuations require a fresh ranking. Headerless readers receive a private session cookie. The global-discovery-v1 scope version prevents older, incomplete snapshots from being reused.

## Event integrity and privacy

Events require the issued snapshot, visitor, entity, and position. Public responses contain placement receipts, never private analytics reports or ranking scores. Event positions support feeds beyond 5,000 entries. Existing daily deduplication, follow verification, self-activity exclusion, watch-time checks, and rate limits remain in force. Show less stays retired and cannot remove candidates.

Account/device identifiers are HMAC hashed. Snapshot and event tables retain RLS and service-role-only access. New candidate RPCs use SECURITY INVOKER, an empty search path, and service-role-only execution. Events expire after 30 days; expired snapshots are pruned after one additional day. Pruning remains opportunistic, at most daily per active server instance.

## Validation and delivery

The global_discovery_ranking migration removes the snapshot length constraint, widens event positions, and adds paged candidate RPCs. Apply it before deploying the dependent server code. The original get_discovery_candidates RPC remains for legacy callers; production directory and TV ranking use the new uncapped traversal.

Focused tests exercise the real migration in PGlite, service-only privileges, a highest scorer beyond entry 5,000 appearing first, complete traversal of 5,207 dancers and videos, stable continuation after scores change, filters, revoked visibility, session isolation, expired cursors, and follow lists beyond 1,000 accounts. No E2E tests or automated browser journeys are used.

Production migration: `20261016000448_global_discovery_ranking.sql`, applied to Dancr. The local CLI-created migration was renamed to the version assigned by the production migration ledger. Read-only verification confirmed all 528 currently eligible dancers are candidates, event positions are bigint, both new RPCs are service-only, RLS is retained, and no new security advisories were introduced.
