# Didit dancer age verification

The integration uses Didit's hosted V3 User Verification flow. Customers and venue accounts are unaffected. Dancer profile tools and publication require an ID-and-selfie result proving age 18+ after activation. Account settings, support, and deletion remain available.

## Activation

1. Apply only `supabase/migrations/20260917190000_dancer_didit_age_verification.sql`, following the migration-safety procedure. It creates private verification records and seeds enforcement **off** so production accounts are not stranded before Didit is connected. Vercel does not apply SQL.
2. Create a **live** Didit User Verification workflow containing document ID verification, passive liveness and face match. Set the minimum age to **18**, disallow bypassing those checks, and leave optional paid modules and white-label branding off unless deliberately needed. Confirm provider acceptance of the MyDancr business and configure the provider's retention/deletion controls before collecting documents.
3. Set server-only `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, and `DIDIT_WEBHOOK_SECRET` in Vercel Production and redeploy. Use the production site's canonical HTTPS `NEXT_PUBLIC_SITE_URL`. Never prefix credentials with `NEXT_PUBLIC_` or commit them.
4. Register `https://www.mydancr.com/api/didit/webhook` in the live Didit application for `status.updated` notifications. The webhook secret must match that destination. The browser callback is `/dashboard/dancer?age-verification=returned`; browser query parameters never authorize an account.
5. Complete a consenting adult's real ID-and-selfie check while enforcement is off. Confirm that MyDancr shows a verified result, the hosted return works, and Didit's delivery log reports a successful signed webhook. Use synthetic/sandbox data for rejection tests; sandbox decisions cannot authorize production accounts.
6. Once the live connection is proven, call the service-only `public.activate_dancer_age_verification()` function. This enables enforcement for **new and existing dancers** and hides unverified public profiles. It does not fabricate approvals or erase club approvals. Previously approved dancers can turn visibility back on after verifying. Pending profiles still need normal club approval.

Do not mark the integration live before steps 1–6 are finished. Missing credentials never bypass an enabled requirement. Disabling the requirement, if needed for an explicitly approved rollback, does not automatically republish profiles.

## Security and privacy

- Authentication, active dancer role, and the current database decision are checked server-side. A database trigger also blocks unverified profile publication and shift creation, including admin/NFC publication paths.
- Sessions belong to a server-generated attempt identifier. The returned session, workflow and vendor reference must match it. Concurrent starts reuse a session; creation is reserved atomically and limited to three attempts per 24 hours. Refresh requests are rate limited.
- Webhooks require a recent timestamp bound to the signed payload and a constant-time SHA-256 HMAC check (V2 canonical JSON or exact raw bytes). The deprecated envelope-only signature is not accepted.
- Every result is fetched again from Didit's API. The overall decision, ID, liveness and face-match modules must all pass, and an actual document birth date must satisfy the 18+ check. Missing modules, malformed DOBs, mismatched sessions and sandbox results cannot approve a dancer.
- Superseded sessions and stale concurrent responses cannot overwrite current results. Revocation hides the public profile. A returning dancer can request reconciliation if a webhook was delayed.
- The private database stores only the account/attempt/session/workflow references, hosted-session URL while pending, statuses, timestamps and attempt counters. It stores no ID images, selfie, DOB, exact age or raw provider payload. Neither public database roles nor authenticated users can read/write these records directly.
- Didit retains its own identity data under the configured provider agreement/settings. MyDancr's local data minimization does not mean Didit deletes its copies automatically. The existing legal-review packets describe the pre-integration model and need the Didit details incorporated before final legal publication.

## Validation

Run `node --test tests/didit-*.test.mjs` plus relevant account, request-auth and dancer dashboard regressions. Provider URLs, rejected/tampered/replayed webhooks, the eighteenth birthday boundary, incomplete checks, authenticated-role isolation, session reuse, retry limits, dashboard access and publication enforcement are covered without real identity data.

Provider documentation: [create session](https://docs.didit.me/sessions-api/create-session), [retrieve decision](https://docs.didit.me/sessions-api/retrieve-session), [signed webhooks](https://docs.didit.me/integration/webhooks), [data models](https://docs.didit.me/reference/data-models).
