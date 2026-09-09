# Step 4: retain the selected photo replacement identity

## Bounded change

The browser previously sent a slot and a replace flag. It also looked up the selected photo after asynchronous preparation, when the visible slot might already contain a different photo. A future atomic approval cannot safely infer permission to replace that later occupant. This prerequisite release captures the selected physical photo ID before preparation, forwards it with the upload, checks ownership/current context on the server, and stores add/replace intent in the moderation record.

The server uses the authenticated dancer's profile for the ownership query. An add request cannot smuggle in a replacement target. A missing, malformed, foreign, removed, rejected or differently categorized target fails before private upload or moderation-provider calls. The selected database ID and current sort order are retained; no alternative row is chosen by slot. Avatars retain separate legacy context and do not use gallery replacement intent.

A pending moderation record is not interchangeable with the approved photo beneath its visible slot. The browser requires the selected ID itself to be a physical photo row; it never follows a pending review's image_id to authorize deleting the underlying approved photo. An unmaterialized pending upload must be removed through the existing explicit removal flow before replacement. Previously loaded clients that send a replace flag without an ID receive a refresh instruction. Ordinary additions and the dashboard's upload-only actions continue without an ID.

Existing idempotency results are now checked before replacement ownership and library-capacity checks. A retry of a completed replacement can return its recorded result even though its predecessor was retired or the library filled afterward. This does not retry a failed database write, delete an original, approve a pending record or override a moderation decision.

## Dependency and remaining work

The prerequisite migration `20260909203842` was committed, pushed, applied and verified before this work began. Its verified SQL hash is now frozen in the migration-history manifest. This release adds no migration, changes no database grants/policies and performs no production data repair.

The existing publication handlers still need to switch to `publish_approved_dancer_gallery_photo` in the next controlled release. Merely storing intent does not make the existing slot-based publisher atomic. Automatic approval, retries and administrator decisions must use the stored ID, expected moderation version and committed result, including stale-decision handling and safe post-commit cleanup. Step 4 remains open until those paths are connected and verified.

## Regression coverage

Sixteen new behavior tests execute the server intent resolver, record creation, idempotent upload response, authenticated route and actual browser helper functions. They verify owner isolation, changed/deleted targets, invalid IDs, original database-error propagation, all three metadata modes, a completed retry with a retired target, slot changes during an awaited preparation, pending-review isolation, and request forwarding. Tests use synthetic data and stub external services; no real account, upload or email is used.

All forty focused tests passed, including the existing avatar, account-change and empty-slot cases. Full tests, lint, build, standalone TypeScript, live readiness, exact pushed-commit deployment and post-deployment health remain required before delivery.

Final pre-release validation passed on `bc9a1534101e4922d34d75b331543ef6fabf46cd`, preserving the separate styling changes: all 3,104 tests with zero failures/skips, full lint, production build and standalone TypeScript. The final suite ran with two workers after the normal pretest generators to reduce memory pressure; no test files were omitted. Postbuild skipped layout-review population. Thirty live readiness checks passed. An additional read-only REST check at 2026-09-09T21:54:28Z confirmed that both intent columns are queryable and the publisher appears in the API schema, returning zero private rows and making no writes. The generated live-shell hash is `293e1decd08b9b9e4f1c00f0798d7f6a5ced6396e1df06ac76b0eff8b798346d`. Exact deployment verification follows the commit.

For recovery, keep the verified additive schema and existing intent records. An application rollback must account for any later caller release before reverting the request contract; dropping the columns would discard the selected identities needed by delayed reviews. This release itself performs no photo, account or storage deletion.
