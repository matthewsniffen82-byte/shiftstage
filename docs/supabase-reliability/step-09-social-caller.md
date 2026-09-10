# Step 9: connect atomic social-link saves

Foundation `3c8571816c4d80f7692c39bde8a7d78c00d2fb7f` is pushed with matching main references and successful [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/9d4gAzznHw66h9Ym1JUgs15pQXZB). The committed migration was applied without changing existing records, five access records, 87 column catalog rows, eighteen constraints, thirteen indexes, six policies, two triggers, 118 existing public functions or 100 historical ledger entries. Read-only verification at 05:50:01 UTC confirmed source/function hashes, service-only invoker access and the unchanged nested queue. Production health, protected route denials and thirty readiness checks passed at 05:51:27–29 UTC.

## Inspected plan

Freeze the applied migration. Replace profile PATCH's separate social read/upsert/enqueue/deactivation sequence with a single checked RPC. Preserve current platform filtering and URL/handle normalization. Convert blank or explicitly inactive form entries to canonical inactive records, omit unsubmitted platforms, and supply dancer and actor identities from authenticated server state. Strip extra client fields. Explicit requested platforms supplement all changed links inside SQL.

Validate the dancer identity and integer change/review counts in the returned receipt, returning only its public count fields. Map permission, missing-profile, invalid-input and transient/uncertain failures safely through existing profile error handling. Never fall back to separate writes, delete compensation or hidden retries. A later identical user submission is safe; clients should refresh after uncertain saves rather than resubmitting old content automatically.

Keep photo enqueue, identity/media saves, publication, public social visibility and moderation rules outside this narrow change. Existing social caller tests are replaced by native transaction-backed caller coverage; retain the photo queue and social queue SQL coverage. Tests must cover all five platforms, URL restrictions, authenticated ownership, inactive/empty/omitted links, selected review lists, queued failures, lost committed responses and malformed acknowledgments.

## Delivery and rollback

Run the complete suite, lint, build, standalone TypeScript, migration guard and thirty readiness checks. Verify frozen deployed source/function/queue hashes and server API exposure read-only. Commit/push only this caller release and verify its exact Vercel success and production health. No production profile is edited for testing. If caller rollback is required, keep the additive SQL in place; note that the former separate-write behavior would return until corrected.

Administrator decision/version/history races remain the next independent Step 9 boundary. Last-write-wins behavior after a newer intentional edit, inactive/deleted target review retirement and non-social profile transactions are not claimed fixed here.

## Validation before delivery

All 96 focused checks passed, including 42 new actual profile-helper/RPC cases backed by local PostgreSQL. Full validation passed 4,519 tests, lint, production build, standalone TypeScript, migration guard and thirty live readiness checks. The two obsolete separate social-queue caller cases were replaced with native atomic-save coverage; photo queue and social enqueue SQL checks remain. Postbuild skipped layout-review population.

Read-only dependency checks at 05:56:36–37 UTC confirmed the frozen migration/function/queue hashes, service-only access, RLS, server RPC exposure and unchanged aggregate counts. No migration was reapplied and no production profile was edited. Exact push, Vercel success and production health remain required.
