# Step 10: indexes and query performance

Step 9 closed with `91d03c844192203a9c787f4701914b9bd01c7d23`. Its [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/EHrwTx1VPAgydYpnstCAiyi4wE3D) succeeded; main references matched and health, authorization and thirty readiness checks passed at 10:44:13–16 UTC on 2026-09-10.

## Read-only audit

The 10:45:32 UTC PostgreSQL 17.6 catalog contains 79 public tables and 271 indexes, all valid and ready. The structural foreign-key scan identifies 108 of 195 foreign keys without an unconditional leading index; this is a review list, not a requirement to add 108 indexes. Nullable audit references, partial indexes and small/unused operational tables need individual query evidence.

Fifteen representative SELECT plans cover discovery, slug lookup, schedules, Working Now, owner/public TV, raw/aggregated video events, notifications, support, follows, profile views, affiliations, invoice items and venue ownership. These use synthetic identifiers and EXPLAIN without ANALYZE. They establish available access paths, not production latency or high-volume cardinality. No private records or statement-cache query text are captured.

Existing indexes cover the important ownership/slug and dancer/video/time/thread relationships. Public city discovery uses ILIKE, so its ordinary city btree is not a general case-insensitive lookup guarantee. Directory joins can still hydrate substantial historical related data. These need measured pagination/query-shape work rather than a speculative pile of indexes. The largest observed table estimate is only 1,817 TV events; estimates differ from the later exact count.

Two structurally equivalent pairs merit separate confirmation: `venues_owner_user_id_idx` is covered by its unique owner key, and `club_invoice_items_revenue_idx` is covered by the newly delivered unique revenue key. Retain both for this first release; do not remove constraint-backed indexes.

Prior application performance work already batches media signing and public ranking/card metrics. Preserve those improvements, privacy filters and outage behavior.

## First controlled change: bounded video metric aggregation

The owner/venue workspace helper currently selects raw `mydancr_tv_events` rows for the selected videos and past thirty days, then reduces them in JavaScript. There is no pagination. A PostgREST row cap can therefore silently undercount active accounts, and transport volume grows with activity rather than the displayed videos.

Read-only capture at 10:49:45 UTC found 1,974 event rows, eight columns, six constraints, three indexes, no triggers and intact RLS. The new function name is absent. The existing `(video_id, occurred_at DESC)` index is available; the representative small-result planner also selected the existing daily unique video/event/session/date index. No new index is justified for this aggregate.

Add an unused, service-only, security-invoker read function. Accept at most 100 selected video IDs and a bounded recent cutoff, deduplicate IDs, group counts inside PostgreSQL and return one JSON object. Preserve all twelve event types and existing lower-bound inclusion. Return no viewer IDs, sessions, timestamps or private event rows. The one-row response avoids a row cap even when an account has many events. The application helper stays unchanged until the function is deployed and verified in its own release.

Native tests must cover more than 1,000 events, exact counts, zero events, multiple videos/types, repeated IDs, boundary timestamps, scoped results, invalid/bounded parameters and browser-role denial. Check the aggregate plan against the existing index on synthetic data. Do not claim independent hosted concurrency, throughput benchmarks or a universal latency improvement from these tests.

A read-only HEAD request at 10:55:43 UTC requested at most 1,500 event rows and returned `Content-Range: 0-999/1974`. No private rows were retrieved. This confirms the deployed 1,000-row cap; it does not establish which current account, if any, has already reached it.

All 35 native tests pass. They count 5,500 events exactly, return 1,200 metric groups in one response row, preserve the lower-bound timestamp and reject browser execution. A selective aggregate over 10,000 synthetic events uses an existing index without forcing the planner. Transaction/repeated-ledger/schema-drift deployment rehearsals pass. Migration `20260910105400` has normalized SHA-256 `3f34dfe88471cca6c2bf78a15ee1a3fe2eca465494841fe636883ac6a6fdc9f5`; expected function MD5 is `f7c115daa49ec58ad85ff8cdd4d65e12`. The caller remains unchanged pending this foundation's full release gates.

Run full tests, lint, production build, standalone TypeScript, migration guard and readiness. Rehearse exact application, repeat rejection and schema-drift rejection. Apply only committed additive SQL with data/access/catalog/dependency/ledger preservation checks; verify the function and server schema before switching the caller. No event writes, schema replacement, index deletion, new paid service or production analytics mutation is part of this release.

Full foundation validation passed all 5,280 automated tests without failures, skips or cancellations, lint, production build, standalone TypeScript, migration guard and thirty live readiness checks. Postbuild skipped population. Exact commit/push, committed-source rehearsal, guarded application, read-only security/preservation/API verification and successful Vercel/health gates remain required before caller integration.

## Delivered aggregate and caller

The foundation was delivered as `ab0a1078d928b2397593d03d7f410bdf1ff52ece`; migration `20260910105400` is applied and frozen. The caller was delivered as `b35a7b15bd42117571d7bc9bafbf3544736d7413`. Both exact deployments succeeded, with the latest health/readiness checks passing at 11:22:18–20 UTC. See `step-10-tv-metric-caller.md` for the 5,320-test validation, exact-count and malformed-response coverage. Owner/venue metrics now use bounded aggregate receipts rather than capped raw event rows.

## Final index decision and limits

The second inspection confirmed the two ordinary indexes are exact duplicates without dependencies. `step-10-redundant-indexes.md` defines their guarded removal, preservation checks, native tests and rollback. Both covering unique constraints remain mandatory. This final performance release does not add speculative indexes or change existing public visibility, city matching, schedule timing, favorites or Working Now behavior.

The 108 structural foreign-key flags do not justify blanket indexes: the inventory includes nullable historical/audit references and partial indexing, and all currently inspected critical query paths have usable indexes or appropriate small-table plans. Production-scale latency, directory relation growth and case-insensitive city search remain measurement/pagination work, not proven regressions in this inspection. Preserve these as growth-monitoring recommendations for the final report. Step 16 owns the existing local-time profile-view day boundary; Step 21 owns expanded hosted/load regression when a disposable environment is available.

Step 10 can close after this index migration's complete validation, exact committed deployment, preservation checks, retained query-plan verification and Vercel/health gates. Storage reliability is the next numbered step; do not begin it before those gates pass.
