# Step 9: connect versioned administrator decisions

Foundation `4ca036bb9ee3ec039e06bc9c20a70278b6af6834` is pushed with matching main references and successful [exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/BxVv3Y5f7xcDixQCFgf4A3pV7Bhf). Its exact committed SQL was applied while preserving existing records, six access records, 100 column catalog rows, twenty constraints, fourteen indexes, seven policies, two triggers, 119 public functions and 101 prior ledger entries. Read-only verification at 06:18:09 UTC confirmed function/source hashes and service-only execution. Both health routes, protected administrator/account denials and thirty readiness checks passed at 06:19:45–47 UTC.

## Inspected caller plan

Keep the applied migration frozen. Expose an explicit target/review snapshot only in administrator responses, with social updated time retained at its original precision. Select a pending review before completed history. The reviewer submits that loaded snapshot with the decision; signed-in identity remains server-derived. Missing legacy snapshots require refreshing the approval queue. Never reconstruct an expected snapshot by re-reading current content during submission, which would hide stale-page conflicts.

Replace the separate photo/summary/history/audit writes with one checked RPC. Validate the returned target, decision, audit/review identifiers, timestamps and next version before reporting success. Preserve active-photo uniqueness conflicts and safe permission/input/transient error mappings. Do not retry automatically or compensate by deleting history. Repeated old snapshots conflict after commit; a new deliberate decision uses the returned snapshot or a newly loaded one.

The UI keeps the returned version for another deliberate decision on the same loaded item. A changed loaded version supersedes that cache. It validates the receipt rather than falling back to the requested status when data is missing. Existing expanded-section behavior is retained.

After a confirmed decision, optional notification storage is acknowledged and delivery remains best effort. Missing/failed notification acknowledgments or thrown delivery errors return a saved decision with a notification warning and sanitized diagnostics. They do not cause another decision, deletion or hidden resend. Existing provider counts of zero can reflect disabled/unconfigured delivery and are not an exactly-once delivery guarantee.

## Tests, deployment and remaining limits

Use native database-backed endpoint/helper/mapper tests and the actual UI review handler. Cover active administrator identity, stale content/reviews, lost committed responses, timestamp precision, malformed receipts, local version replacement, existing position conflicts, optional notification failures and legacy missing-version refresh. Replace obsolete tests for the deleted direct-write path while retaining native index/publication tests.

Run full suite, lint, build, standalone TypeScript, migration guard, readiness and read-only frozen dependency checks. Commit/push this caller only, verify exact Vercel success and production health. No migration reapplication or production administrator decision is permitted as a test.

The expected-version check protects this content-decision entry point. Wider whole-profile review, admin content deletion, inactive review retirement and external-notification recovery remain separate audit work. Public social visibility and account/profile publication rules remain unchanged.

## Validation before delivery

All 82 focused checks passed, including 52 new native database-backed endpoint/helper/mapper/UI-handler cases. Full validation passed 4,620 automated tests, lint, production build, standalone TypeScript, migration guard and thirty live readiness checks. The five obsolete direct-write caller cases were replaced with atomic caller conflict/error coverage; native index/publication tests remain. Postbuild skipped layout-review population.

Read-only dependency/schema checks at 06:31:33–36 UTC retained the frozen decision, social-save, queue and ledger hashes, service-only access, RLS and aggregate data counts. No migration was reapplied and no production decision or notification was created. Exact push, Vercel success and deployed health remain required.
