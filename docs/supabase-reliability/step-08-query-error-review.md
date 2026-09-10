# Step 8: query reliability and explicit failures

## Delivery prerequisite

Step 7 was pushed as `043d8d83e5cb878cf58f18bc913fb7065f6393fd` and its exact [Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/hpaLd2413GtpwA7Gw87Hvg8AN57g) succeeded. Both health routes, safe auth denials, reset-client checks and all thirty readiness checks passed at 02:06:00–04 UTC on 2026-09-10. Local HEAD and both remote main references matched. Read-only postflight at 02:04:11 UTC verified the exact committed migration ledger SQL, expected function fingerprint, service-only execution, empty search path, three-second lock limit and retained RLS. The guarded transaction preserved 29 accounts/Auth identities, five customer profiles, sixteen dancer profiles, four aliases, thirteen constraints, five policies/triggers, four helper functions, relation/column access and 96 prior migration entries. No real account repair was invoked for testing. The verified migration is now frozen in the history manifest.

## Inspection and first controlled plan

Inspect Supabase call sites across `src` and `app`, including direct awaits, destructured results, Promise.all handling, `.single()` cardinality, optional queries and catch-to-empty behavior. The syntax inventory is a review aid, not a proof that every possible dynamic client call is safe. Keep required mutation acknowledgments and singleton configuration reads strict; do not mechanically replace `.single()`.

The first controlled change addresses TV reads. The personalized Following feed catches authentication and follow-query failures and returns an empty list, then reports a successful feed. Managed video signing ignores a batch-level Storage error, so a whole outage becomes blank playback URLs. The same helper serves the dancer workspace and administrator review queue. Authorized individual missing files still need to remain visible for management, including incomplete uploads and historical records.

Remove the Following catch-to-empty path: no credentials remains the intentional sign-in/empty state; presented invalid credentials and temporary provider/database failures must reach the existing safe API error boundary. Propagate managed signing batch errors and reject an absent batch result. Preserve per-file unavailable placeholders, authorized selection, URL-to-path matching, bounded batches and genuine empty libraries. Add runtime route/workspace fault tests, then run the complete suite, lint, build, standalone TypeScript and read-only production checks. Commit/push/deploy/verify this change before addressing additional Step 8 findings.

## Additional findings to handle separately

The scan found unchecked invoice status, provider-reference and reminder-summary writes in `finance-invoices.ts`. Its provider/database sequence also needs careful recovery analysis: preserving a provider invoice ID before attaching its item can leave a retry on a different branch. Do not merely add a throw that makes an uncertain-write retry unsafe. Separate this finance follow-up and the Step 9 atomicity review from the TV read correction.

Other direct-result candidates include claim-proof cleanup, video upload/import compensation, account-state compensation, optional moderation notifications, counter-notice delivery bookkeeping and redemption first-event timestamps. Review whether each must fail the operation, report partial completion or record a safe cleanup warning. Optional auth catches in cashier redemption and customer activity also need review. Storage bucket policy and orphan-file work remain Step 11, and account deletion semantics remain Step 17. These candidates are not yet marked fixed.

Current inspected account/profile/favorite/schedule primary queries generally capture errors and distinguish legitimate zero rows. The new provisioning gateway, atomic media gateways and shift-update helper already verify acknowledgments. Required payout configuration uses `.single()` intentionally; absence must not invent payment settings. The legacy missing-function provisioning fallback remains explicit compatibility behavior, not a general network-error retry. Hosted fault injection and multi-account sessions remain deferred; production checks must be read-only or unauthenticated denials.

## First correction and regression evidence

The source scan at `043d8d83` identified 798 candidate calls after excluding JavaScript collection constructors: 668 table call sites, 66 RPC calls and 64 Storage calls. It highlighted fifteen standalone table results and two uncaptured Storage errors for manual review. Counts describe syntax candidates, including dynamically configured builders; they are not an assertion that all reads/writes are unsafe or fully verified.

Runtime tests reproduced eleven failing assertions before the TV correction: six Following auth/query cases, four managed-signing cases and the prior test expectation of blank URLs during an outage. After the fix all 37 focused tests passed, including fourteen new cases. They verify verified-account scoping, invalid credentials, timeout/connection failure, authorization/cardinality errors, sanitized responses, genuine empty libraries, absent credentials, public nonpersonalized access, owner/admin signing failure, an absent signing result and failure in a later batch. Existing tests retain per-file missing placeholders, order, metrics, deduplication and 100-path batches. No new mutation, policy, storage permission or database migration is added.

Final TV correction validation on `043d8d83` passed all 3,806 tests with no failures, skips or cancellations, full lint, production build, standalone TypeScript and all thirty live readiness checks. The full suite used three workers after the normal generators; postbuild skipped layout-review population. All 37 focused cases passed. No production media, account, policy or schema was changed. The previously verified Step 7 SQL checksum is frozen without editing or reapplying it. Exact commit push, Vercel success, production feed/error behavior and post-deployment health remain required before the next controlled Step 8 correction.

## Reminder follow-up

The TV correction was deployed and verified at 02:19:36–40 UTC; the complete receipt is in the execution ledger. The next bounded fix is described in `step-08-invoice-reminder-errors.md`. It addresses the two unchecked reminder updates, including terminal-status preservation and an explicit partial-delivery error. The other publishing writes remain open.
