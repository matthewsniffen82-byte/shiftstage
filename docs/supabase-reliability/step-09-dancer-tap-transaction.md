# Step 9: atomic dancer tap entry point

## Inspected issue

At 08:11 UTC on September 10, 2026, read-only production capture confirmed that `register_dancer_nfc_enrollment` commits the enrollment, profile activation and affiliation. `src/lib/dancr/nfc.ts::registerDancerFromNfc` then separately calls `activate_dancer_shift_from_nfc`. Failure or response loss between these RPCs can report a failed tap after profile/affiliation changes are already committed, with no Working Now session.

The three existing definitions are preserved: registration MD5 `4538192ca3b4ace22327817f336dcef8`, affiliation-from-NFC `bf4ce004c0490aa8df9c24fd9f9dcaa4`, and shift activation `55969db7996b137d4455dc1d9eaec463`. They are service-only functions. Registration calls affiliation but does not start Working Now. The actual tap caller is responsible for that second operation.

## Narrow plan

Add an unused service-only, security-invoker transaction wrapper that calls these existing functions in the same order. An incomplete setup keeps the existing pending enrollment behavior. A completed enrollment proceeds to Working Now inside the same transaction; a failure rolls back both operations. Preserve returned current-club/active-session/cooldown semantics, six-hour windows, twelve-hour interval between eligible starts, ownership, public visibility gates and event history. Validate the required result shape before returning success. Use a bounded lock timeout and explicit parameter validation.

Do not alter deferred enrollment completion after profile setup: an earlier saved tap is not a fresh check-in. Do not rewrite existing publication or scheduling rules. Capture target schema and dependencies for local PostgreSQL regression tests; report synthetic projections explicitly. Test first activation, incomplete setup, existing session, cooldown, denied accounts/tags and rollback after either half. Existing hosted concurrent-session tests remain deferred.

Run complete validation, commit/push only the unused foundation, apply the exact guarded additive migration with preservation checks, then verify exact deployment and health. Only afterward replace the two-call application entry point in a separate release. No production tap, profile activation, check-in, payout or notification will be created as a test. Recovery keeps the additive function unused or rolls back its caller; never delete records or reverse user state as compensation.

## Focused validation

All 44 native SQL tests pass. The fixture retains all 177 columns, 77 constraints, fifty indexes, seven enums and eight original triggers on eleven captured target tables. Auth identity keys, profile-link aliases, club deals and venue team members are synthetic peripheral projections. The real registration, affiliation, presence and deferred-completion function definitions are loaded and hash-checked.

Tests reproduce partial activation in the old separate calls, then prove rollback of the combined path at profile, affiliation, enrollment, notification, shift and tap-event failures. They also cover pending setup, media review gates, rejected/disabled profiles, ineligible accounts/tags, non-extending repeat taps, cross-club cooldown, a fresh session after cooldown, existing scheduled-date reuse, malformed receipts, browser-role denial and unchanged deferred completion. Queued local calls are serialized by the local engine, not independent hosted sessions.

The guarded migration application, repeated-ledger rejection and schema-drift rehearsals pass. Trigger comparisons retain complete definitions and use stable table/name ordering because local table OIDs differ. Existing nested function hashes are checked before application; no historical SQL is replayed.

All 4,928 automated tests, lint, production build, standalone TypeScript, migration guard and thirty readiness checks passed. The application still uses its existing entry point. Exact push, committed additive SQL application, preservation/permission checks, Vercel success and deployed health remain required before caller integration. Existing concurrent overlap with deferred enrollment completion can still require a retry after a database lock conflict; this wrapper provides bounded locking and full rollback, not a claim that every legacy lock order has been redesigned.
