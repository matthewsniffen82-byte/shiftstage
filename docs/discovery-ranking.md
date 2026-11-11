# Discovery ranking

The dancer directory and MyDancrTV rank all eligible candidates in the requested city before pagination. Neither feed has a total profile, video, or page-count cap. The default order is the rolling 7-day Overall Performance score, descending, using the venue dashboard's category formula; ties use dancer ID, then video ID. Scores use each venue's full analytics cohort, not the current page or public subset. Internal rosters use the same 7-day window for their club. Unscored dancers follow scored dancers. No profile is hard-coded above the score order.

Placement uses a rolling 168-hour window and the server-side [dancer score](venue-performance-analytics.md). Club Results show the overall score and eight category scores. Public feeds use the overall score for ordering. A version change invalidates prior scoring caches and discovery snapshots.

During a verified Internal shift, “Switch to Both” explicitly makes the approved profile public and retains the internal roster. The authenticated owner route calls the service-only `enable_dancer_shift_both` transaction, which rechecks account, profile, age verification, club access, active presence and recorded check-in provenance. Mode changes and publication commit together; shift expiry and NFC cooldown never change. Existing mode-history triggers start external credit at the switch, with no backdating. Repeated requests are idempotent and do not undo a subsequent Incognito choice. A ranking-progress read failure leaves shift management and checkout available.

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
